import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { request } from 'undici';

const envFile = '.env.demo';

const procs = [];
let exiting = false;

function shutdownAll() {
  if (exiting) return;
  exiting = true;
  for (const p of procs) {
    try {
      p.kill('SIGINT');
    } catch {}
  }
}

const childEnv = {
  ...process.env,
  DOTENV_CONFIG_PATH: envFile,
};

function spawnNode(label, args) {
  const child = spawn(process.execPath, args, {
    env: childEnv,
    stdio: 'inherit',
  });
  procs.push(child);
  child.on('exit', (code, signal) => {
    console.log(`[${label}] exited with code ${code ?? 'null'}${signal ? ` (signal ${signal})` : ''}`);
    if (!exiting) {
      shutdownAll();
      process.exit(code ?? 1);
    }
  });
  return child;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForOk(url, { timeoutMs = 15000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const { statusCode } = await request(url, { method: 'GET' });
      if (statusCode >= 200 && statusCode < 300) return true;
    } catch {}
    await sleep(300);
  }
  return false;
}

async function sendWebhook({ orderNumber, eventId }) {
  const port = Number(childEnv.PORT || 3000);
  const url = childEnv.WEBHOOK_URL || `http://127.0.0.1:${port}/webhooks/shopify`;
  const secret = childEnv.SHOPIFY_WEBHOOK_SECRET || 'demo-secret';
  const topic = 'orders/fulfilled';
  const shopDomain = childEnv.SHOPIFY_SHOP_DOMAIN || 'demo.myshopify.com';

  const payload = {
    id: Number(orderNumber),
    order_id: Number(orderNumber),
    order_number: Number(orderNumber),
    admin_graphql_api_id: `gid://shopify/Order/${orderNumber}`,
    tracking_number: '1Z999AA10123456784',
    tracking_company: 'UPS',
  };

  const body = JSON.stringify(payload);
  const hmac = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('base64');

  const { statusCode, body: resBody } = await request(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Hmac-Sha256': hmac,
      'X-Shopify-Topic': topic,
      'X-Shopify-Shop-Domain': shopDomain,
      'X-Shopify-Event-Id': eventId,
    },
    body,
  });
  const text = await resBody.text();
  return { statusCode, text };
}

console.log('--- Demo: Shopify → Bridge → Fishbowl (mock) ---');
console.log(`Using env file: ${envFile}`);
console.log('Starting mock Fishbowl + bridge server...');

const fishbowlMock = spawnNode('fishbowl-mock', ['tools/mock-fishbowl.js']);
const server = spawnNode('bridge', ['src/server.js']);

const okFishbowl = await waitForOk('http://127.0.0.1:2456/health');
const okServer = await waitForOk(`http://127.0.0.1:${childEnv.PORT || 3000}/health`);

if (!okFishbowl || !okServer) {
  console.log('Failed to start demo services. Check logs above.');
  shutdownAll();
  process.exit(1);
}

console.log('Services are up. Sending a fulfilled webhook (success)...');
const eventId = `demo-event-${Date.now()}`;
const r1 = await sendWebhook({ orderNumber: 1001, eventId });
console.log('Webhook #1 response:', r1.statusCode, r1.text);

console.log('Sending the same webhook again (dedupe should skip)...');
const r2 = await sendWebhook({ orderNumber: 1001, eventId });
console.log('Webhook #2 response:', r2.statusCode, r2.text);

console.log('Sending a webhook that forces Fishbowl failure (order 9999)...');
const r3 = await sendWebhook({ orderNumber: 9999, eventId: `demo-event-${Date.now()}-fail` });
console.log('Webhook #3 response:', r3.statusCode, r3.text);

console.log('\nDemo complete.');
console.log('Press Ctrl+C to stop the servers.');
console.log('Tip: GET http://127.0.0.1:2456/__mock/requests to see what the mock Fishbowl received.');

function shutdown() {
  shutdownAll();
}

process.on('SIGINT', () => {
  shutdownAll();
  process.exit(0);
});
process.on('SIGTERM', () => {
  shutdownAll();
  process.exit(0);
});

// Keep parent alive
// eslint-disable-next-line no-constant-condition
while (true) {
  await sleep(1000);
}
