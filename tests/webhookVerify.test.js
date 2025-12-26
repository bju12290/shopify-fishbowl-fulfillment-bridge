import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { verifyShopifyWebhook } from '../src/shopify/webhookVerify.js';

test('verifyShopifyWebhook: accepts a valid signature', () => {
  const secret = 'shpss_test_secret';
  const body = Buffer.from(JSON.stringify({ id: 123, status: 'fulfilled' }), 'utf8');

  const hmac = crypto.createHmac('sha256', secret).update(body).digest('base64');

  assert.equal(verifyShopifyWebhook({ secret, rawBody: body, hmacHeader: hmac }), true);
});

test('verifyShopifyWebhook: rejects an invalid signature', () => {
  const secret = 'shpss_test_secret';
  const body = Buffer.from(JSON.stringify({ id: 123, status: 'fulfilled' }), 'utf8');

  assert.equal(verifyShopifyWebhook({ secret, rawBody: body, hmacHeader: 'not-a-real-signature' }), false);
});
