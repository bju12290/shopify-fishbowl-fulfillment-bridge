import crypto from 'node:crypto';
import { verifyShopifyWebhook } from '../shopify/webhookVerify.js';

function safeJsonParse(buffer) {
  const text = buffer.toString('utf8');
  return JSON.parse(text);
}

function renderTemplate(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(vars[key] ?? ''));
}

// Minimal CSV line parser (supports quoted values + escaped quotes "").
function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        const next = line[i + 1];
        if (next === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ',') {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function deriveEventId({ headerEventId, topic, shopDomain, rawBody, fallbackSeed }) {
  if (headerEventId) return headerEventId;
  if (fallbackSeed) return `${topic ?? 'unknown'}:${fallbackSeed}`;
  const sha = crypto.createHash('sha256').update(rawBody).digest('hex');
  return `${shopDomain ?? 'unknown'}:${topic ?? 'unknown'}:sha256:${sha}`;
}

export async function registerWebhookRoutes(app) {
  app.post('/webhooks/shopify', async (req, reply) => {
    // With our server content-type parser, req.body is a Buffer.
    const rawBody = req.body;
    if (!Buffer.isBuffer(rawBody)) {
      return reply.code(400).send({ ok: false, error: 'Expected raw body buffer' });
    }

    const hmac = req.headers['x-shopify-hmac-sha256'];
    const topic = req.headers['x-shopify-topic'];
    const shopDomain = req.headers['x-shopify-shop-domain'];
    const headerEventId = req.headers['x-shopify-event-id'];

    const valid = verifyShopifyWebhook({
      rawBody,
      hmacHeader: typeof hmac === 'string' ? hmac : null,
      secret: app.config.SHOPIFY_WEBHOOK_SECRET,
    });
    if (!valid) {
      app.log.warn({ topic, shopDomain }, 'Rejected webhook: invalid HMAC');
      return reply.code(401).send({ ok: false });
    }

    let payload;
    try {
      payload = safeJsonParse(rawBody);
    } catch (err) {
      app.log.warn({ err, topic, shopDomain }, 'Rejected webhook: invalid JSON');
      return reply.code(400).send({ ok: false, error: 'Invalid JSON' });
    }

    const orderNumber = payload.order_number ?? payload.orderNumber ?? payload.name ?? null;
    const fallbackSeed = payload.admin_graphql_api_id ?? payload.order_id ?? payload.id ?? orderNumber;
    const eventId = deriveEventId({
      headerEventId: typeof headerEventId === 'string' ? headerEventId : null,
      topic: typeof topic === 'string' ? topic : null,
      shopDomain: typeof shopDomain === 'string' ? shopDomain : null,
      rawBody,
      fallbackSeed,
    });

    const { reserved, existing } = app.idempotency.reserve({
      eventId,
      topic: typeof topic === 'string' ? topic : null,
      shopDomain: typeof shopDomain === 'string' ? shopDomain : null,
      orderNumber: orderNumber ? String(orderNumber) : null,
    });
    if (!reserved) {
      // Already seen → acknowledge so Shopify stops retrying.
      app.log.info({ eventId, status: existing.status, topic, orderNumber }, 'Duplicate webhook; acking');
      return reply.code(200).send({ ok: true, dedup: true });
    }

    // --- Core workflow ---
    try {
      // 1) Confirm fulfillment status in Shopify
      const orderId = payload.order_id ?? (typeof topic === 'string' && topic.startsWith('orders/') ? payload.id : null);
      const orderGid = payload.admin_graphql_api_id && String(payload.admin_graphql_api_id).includes('Order/')
        ? payload.admin_graphql_api_id
        : null;

      const { name, displayFulfillmentStatus } = await app.shopify.getOrderFulfillmentStatus({
        orderId,
        orderGid,
      });

      const isFulfilled = displayFulfillmentStatus === 'FULFILLED';
      if (!isFulfilled) {
        app.log.info(
          { eventId, topic, orderNumber: orderNumber ?? name, displayFulfillmentStatus },
          'Order not fulfilled in Shopify; ignoring'
        );
        app.idempotency.markSucceeded(eventId);
        return reply.code(200).send({ ok: true, ignored: true });
      }

      // 2) Trigger Fishbowl fulfillment import
      const headers = app.config.FISHBOWL_IMPORT_HEADERS.split(',').map((s) => s.trim()).filter(Boolean);
      const trackingNumber =
        payload.tracking_number ??
        payload.trackingNumber ??
        (Array.isArray(payload.tracking_numbers) ? payload.tracking_numbers[0] : null) ??
        '';
      const carrier = payload.tracking_company ?? payload.carrier ?? '';
      const shipDate = new Date().toISOString().slice(0, 10);

      const vars = {
        orderNumber: String(orderNumber ?? name ?? ''),
        trackingNumber: String(trackingNumber ?? ''),
        carrier: String(carrier ?? ''),
        shipDate: String(shipDate),
      };

      const renderedRow = renderTemplate(app.config.FISHBOWL_IMPORT_ROW_TEMPLATE, vars);
      const row = parseCsvLine(renderedRow);
      if (row.length !== headers.length) {
        throw new Error(
          `Fishbowl import mapping mismatch: headers=${headers.length} values=${row.length}. ` +
            `Check FISHBOWL_IMPORT_HEADERS and FISHBOWL_IMPORT_ROW_TEMPLATE.`
        );
      }

      await app.fishbowl.login();
      try {
        await app.fishbowl.runImportCsv(app.config.FISHBOWL_FULFILLMENT_IMPORT_NAME, headers, row);
      } finally {
        await app.fishbowl.logout();
      }

      app.log.info({ eventId, orderNumber: vars.orderNumber }, 'Fishbowl fulfillment completed');
      app.idempotency.markSucceeded(eventId);
      return reply.code(200).send({ ok: true });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      app.log.error({ err, eventId, topic, orderNumber }, 'Webhook processing failed');

      app.idempotency.markFailed(eventId, errorMessage);
      await app.notifier.notifyFishbowlFailure({
        orderNumber: String(orderNumber ?? 'unknown'),
        eventId,
        topic: typeof topic === 'string' ? topic : null,
        shopDomain: typeof shopDomain === 'string' ? shopDomain : null,
        errorMessage,
      });

      // Respond 200 so Shopify doesn't retry forever (policy choice).
      return reply.code(200).send({ ok: true, error: 'Fishbowl fulfillment failed (alerted)' });
    }
  });
}
