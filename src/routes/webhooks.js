export async function registerWebhookRoutes(app) {
  app.post('/webhooks/shopify', async (req, reply) => {
    // Placeholder: later we verify HMAC + idempotency + call Fishbowl
    app.log.info({ headers: req.headers }, 'Received Shopify webhook');
    return reply.code(200).send({ ok: true });
  });
}
