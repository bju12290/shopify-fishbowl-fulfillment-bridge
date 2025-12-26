import 'dotenv/config';
import Fastify from 'fastify';

import { registerHealthRoutes } from './routes/health.js';
import { registerWebhookRoutes } from './routes/webhooks.js';

const buildVersion = process.env.APP_VERSION || 'dev';

const app = Fastify({
  logger: true,
});

app.decorate('buildVersion', buildVersion);

await registerHealthRoutes(app);
await registerWebhookRoutes(app);

const port = Number(process.env.PORT || 3000);
const host = '0.0.0.0';

try {
  await app.listen({ port, host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
