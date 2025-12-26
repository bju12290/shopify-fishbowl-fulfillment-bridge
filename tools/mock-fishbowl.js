import 'dotenv/config';
import Fastify from 'fastify';

const port = Number(process.env.FISHBOWL_MOCK_PORT || 2456);
const host = process.env.FISHBOWL_MOCK_HOST || '127.0.0.1';

const failSet = new Set(
  String(process.env.FISHBOWL_MOCK_FAIL_ORDER_NUMBERS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
);

const app = Fastify({ logger: true });

// Parse CSV as string
app.addContentTypeParser('text/csv', { parseAs: 'string' }, (req, body, done) => done(null, body));

const state = {
  logins: [],
  imports: [],
  lastToken: 'mock-token',
};

app.get('/health', async () => ({ ok: true, mock: 'fishbowl', port }));

app.get('/__mock/requests', async () => ({
  logins: state.logins,
  imports: state.imports,
}));

app.post('/api/login', async (req, reply) => {
  const payload = req.body || {};
  state.logins.push({ at: new Date().toISOString(), payload });
  return reply.code(200).send({ token: state.lastToken });
});

app.post('/api/logout', async (req, reply) => {
  return reply.code(204).send();
});

function getBearerToken(req) {
  const auth = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/.exec(auth);
  return m?.[1] || null;
}

function parseCsvOrderNumber(csvText) {
  const lines = String(csvText || '').trim().split(/\r?\n/);
  if (lines.length < 2) return null;
  const headers = lines[0].split(',').map((s) => s.replace(/^"|"$/g, '').trim());
  const values = lines[1].split(',').map((s) => s.replace(/^"|"$/g, '').trim());
  const idx = headers.findIndex((h) => h.toLowerCase() === 'ordernumber' || h.toLowerCase() === 'order_number');
  if (idx >= 0) return values[idx] || null;
  return values[0] || null;
}

app.post('/api/import/:name', async (req, reply) => {
  const token = getBearerToken(req);
  if (!token || token !== state.lastToken) {
    return reply.code(401).send({ message: 'Unauthorized (mock)' });
  }

  const importName = req.params.name;
  const contentType = String(req.headers['content-type'] || '');

  let orderNumber = null;
  let detail = null;

  if (contentType.includes('text/csv')) {
    const csvText = req.body;
    orderNumber = parseCsvOrderNumber(csvText);
    detail = { csv: csvText };
  } else {
    // JSON body: typically [ [headers...], [row...], ... ]
    const body = req.body;
    if (Array.isArray(body) && Array.isArray(body[1])) {
      const headers = body[0] || [];
      const row = body[1] || [];
      const idx = headers.findIndex((h) => String(h).toLowerCase() === 'ordernumber');
      orderNumber = idx >= 0 ? String(row[idx] ?? '') : null;
    }
    detail = { json: body };
  }

  const record = {
    at: new Date().toISOString(),
    importName,
    contentType,
    orderNumber,
    detail,
  };
  state.imports.push(record);

  if (orderNumber && failSet.has(String(orderNumber))) {
    return reply.code(500).send({ message: `Mock failure for order ${orderNumber}` });
  }

  return reply.code(200).send({
    ok: true,
    mock: true,
    importName,
    orderNumber,
    receivedAt: record.at,
  });
});

try {
  await app.listen({ port, host });
  app.log.info({ host, port }, 'Mock Fishbowl listening');
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
