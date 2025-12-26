import crypto from 'node:crypto';

/**
 * Shopify signs webhooks with base64(HMAC_SHA256(rawBody, secret)).
 */
export function verifyShopifyWebhook({ rawBody, hmacHeader, secret }) {
  if (!rawBody || !Buffer.isBuffer(rawBody)) return false;
  if (!hmacHeader || typeof hmacHeader !== 'string') return false;
  if (!secret) return false;

  const computed = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('base64');

  // timingSafeEqual requires equal length buffers.
  const a = Buffer.from(hmacHeader, 'utf8');
  const b = Buffer.from(computed, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

