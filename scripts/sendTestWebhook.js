import 'dotenv/config';
import crypto from 'node:crypto';
import { request } from 'undici';
import fs from 'node:fs';

function argValue(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return fallback;
  const next = process.argv[idx + 1];
  if (!next || next.startsWith('--')) return fallback;
  return next;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

const port = Number(process.env.PORT || 3000);
const url = argValue('--url', process.env.WEBHOOK_URL || `http://127.0.0.1:${port}/webhooks/shopify`);
const secret = process.env.SHOPIFY_WEBHOOK_SECRET || 'demo-secret';

const topic = argValue('--topic', 'orders/fulfilled');
const shopDomain = argValue('--shop', process.env.SHOPIFY_SHOP_DOMAIN || 'demo.myshopify.com');
const eventId = argValue('--eventId', `demo-event-${Date.now()}`);
const orderNumber = argValue('--orderNumber', '1001');

let payload;
const payloadFile = argValue('--payloadFile', null);
if (payloadFile) {
  payload = JSON.parse(fs.readFileSync(payloadFile, 'utf8'));
} else {
  payload = {
    id: Number(orderNumber),
    order_id: Number(orderNumber),
    order_number: Number(orderNumber),
    admin_graphql_api_id: `gid://shopify/Order/${orderNumber}`,
    tracking_number: '1Z999AA10123456784',
    tracking_company: 'UPS',
  };
}

const body = JSON.stringify(payload);
const hmac = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('base64');

const headers = {
  'Content-Type': 'application/json',
  'X-Shopify-Hmac-Sha256': hmac,
  'X-Shopify-Topic': topic,
  'X-Shopify-Shop-Domain': shopDomain,
  'X-Shopify-Event-Id': eventId,
};

if (hasFlag('--print')) {
  console.log('POST', url);
  console.log('Headers:', headers);
  console.log('Body:', body);
}

const { statusCode, body: resBody } = await request(url, {
  method: 'POST',
  headers,
  body,
});

const text = await resBody.text();
console.log('Status:', statusCode);
console.log('Response:', text || '(empty)');
