import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createIdempotencyStore } from '../src/store/idempotency.js';

const noopLogger = {
  child: () => noopLogger,
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

test('idempotency: reserve -> duplicate -> succeeded roundtrip', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'idempo-'));
  const store = createIdempotencyStore({ dataDir: tmp, logger: noopLogger });

  try {
    const first = store.reserve({
      eventId: 'evt-1',
      topic: 'orders/fulfilled',
      shopDomain: 'demo.myshopify.com',
      receivedAt: new Date('2025-01-01T00:00:00Z').toISOString(),
    });
    assert.equal(first.isDuplicate, false);

    const second = store.reserve({
      eventId: 'evt-1',
      topic: 'orders/fulfilled',
      shopDomain: 'demo.myshopify.com',
      receivedAt: new Date('2025-01-01T00:00:01Z').toISOString(),
    });
    assert.equal(second.isDuplicate, true);
    assert.equal(second.status, 'processing');
    assert.equal(second.responseJson, null);

    store.markSucceeded({ eventId: 'evt-1', responseJson: { ok: true } });

    const third = store.reserve({
      eventId: 'evt-1',
      topic: 'orders/fulfilled',
      shopDomain: 'demo.myshopify.com',
      receivedAt: new Date('2025-01-01T00:00:02Z').toISOString(),
    });
    assert.equal(third.isDuplicate, true);
    assert.equal(third.status, 'succeeded');
    assert.deepEqual(third.responseJson, { ok: true });
  } finally {
    store.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
