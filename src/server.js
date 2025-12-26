import 'dotenv/config';
import Fastify from 'fastify';

import { loadConfig } from './config.js';
import { buildLoggerOptions } from './utils/logger.js';
import { createIdempotencyStore } from './store/idempotency.js';
import { ShopifyClient } from './shopify/client.js';
import { MockShopifyClient } from './shopify/mock.js';
import { FishbowlClient } from './fishbowl/client.js';
import { createEmailNotifier } from './notify/email.js';

import { registerHealthRoutes } from './routes/health.js';
import { registerWebhookRoutes } from './routes/webhooks.js';

let config;
try {
  config = loadConfig(process.env);
} catch (err) {
  // eslint-disable-next-line no-console
  console.error(err.message);
  process.exit(1);
}

const app = Fastify({
  logger: buildLoggerOptions({ level: config.LOG_LEVEL }),
  bodyLimit: 5 * 1024 * 1024,
});

app.decorate('config', config);
app.decorate('buildVersion', config.APP_VERSION);

// Shopify webhook verification requires the exact raw bytes.
// We parse JSON bodies as Buffer so handlers can verify HMAC before JSON.parse.
for (const ct of ['application/json', 'application/*+json']) {
  app.addContentTypeParser(
    ct,
    { parseAs: 'buffer' },
    (req, body, done) => done(null, body)
  );
}

const idempotency = createIdempotencyStore({ dataDir: config.DATA_DIR });
app.decorate('idempotency', idempotency);

const shopify =
  config.SHOPIFY_MODE === 'mock'
    ? new MockShopifyClient({
        defaultFulfillmentStatus: config.SHOPIFY_MOCK_DEFAULT_FULFILLMENT_STATUS,
        logger: app.log,
      })
    : new ShopifyClient({
        shopDomain: config.SHOPIFY_SHOP_DOMAIN,
        accessToken: config.SHOPIFY_ACCESS_TOKEN,
        apiVersion: config.SHOPIFY_API_VERSION,
        logger: app.log,
      });
app.decorate('shopify', shopify);


const fishbowl = new FishbowlClient({
  baseUrl: config.FISHBOWL_BASE_URL,
  username: config.FISHBOWL_USERNAME,
  password: config.FISHBOWL_PASSWORD,
  appName: config.FISHBOWL_APP_NAME,
  appDescription: config.FISHBOWL_APP_DESCRIPTION,
  appId: config.FISHBOWL_APP_ID,
  logger: app.log,
});
app.decorate('fishbowl', fishbowl);

const notifier = createEmailNotifier({
  smtpHost: config.SMTP_HOST,
  smtpPort: config.SMTP_PORT,
  smtpUser: config.SMTP_USER,
  smtpPass: config.SMTP_PASS,
  fromEmail: config.ALERT_FROM_EMAIL,
  toEmail: config.ALERT_TO_EMAIL,
  logger: app.log,
});
app.decorate('notifier', notifier);

app.addHook('onClose', async () => {
  idempotency.close();
});

await registerHealthRoutes(app);
await registerWebhookRoutes(app);

const port = config.PORT;
const host = '0.0.0.0';

try {
  await app.listen({ port, host });
  app.log.info({ port, host, version: config.APP_VERSION }, 'Server listening');
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
