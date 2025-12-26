export function buildLoggerOptions({ level = 'info' } = {}) {
  // Fastify uses pino under the hood; this just gives us sane defaults.
  return {
    level,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-shopify-hmac-sha256"]',
        'req.headers["x-shopify-access-token"]',
      ],
      remove: true,
    },
  };
}

