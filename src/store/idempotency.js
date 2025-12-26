import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

function now() {
  return Date.now();
}

function parseJsonMaybe(value) {
  if (value == null) return null;
  if (typeof value !== 'string' || value.length === 0) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeRow(row) {
  if (!row) return null;
  return {
    ...row,
    responseJson: parseJsonMaybe(row.responseJson),
  };
}

/**
 * Small idempotency store for Shopify webhooks (at-least-once delivery).
 * Uses a single SQLite file under dataDir.
 */
export function createIdempotencyStore({ dataDir }) {
  if (!dataDir) throw new Error('dataDir is required');
  fs.mkdirSync(dataDir, { recursive: true });

  const dbPath = path.join(dataDir, 'idempotency.sqlite');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS webhook_events (
      eventId TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      topic TEXT,
      shopDomain TEXT,
      orderNumber TEXT,
      responseJson TEXT,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      lastError TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_webhook_events_orderNumber ON webhook_events(orderNumber);
  `);

  const reserveStmt = db.prepare(`
    INSERT INTO webhook_events (eventId, status, topic, shopDomain, orderNumber, createdAt, updatedAt)
    VALUES (@eventId, 'processing', @topic, @shopDomain, @orderNumber, @ts, @ts)
  `);

  const getStmt = db.prepare(
    'SELECT eventId, status, topic, shopDomain, orderNumber, responseJson, createdAt, updatedAt, lastError FROM webhook_events WHERE eventId = ?'
  );

  const succeedStmt = db.prepare(
    `UPDATE webhook_events SET status='succeeded', responseJson=@responseJson, updatedAt=@ts WHERE eventId=@eventId`
  );

  const failStmt = db.prepare(
    `UPDATE webhook_events SET status='failed', lastError=@lastError, updatedAt=@ts WHERE eventId=@eventId`
  );

  return {
    /**
     * Reserve an eventId for processing. If already seen, returns reserved=false and the existing row.
     */
    reserve({ eventId, topic, shopDomain, orderNumber }) {
      const existing = normalizeRow(getStmt.get(eventId));
      if (existing) {
        return {
          reserved: false,
          isDuplicate: true,
          existing,
          // flatten useful fields for convenience (tests/readability)
          ...existing,
        };
      }

      reserveStmt.run({ eventId, topic, shopDomain, orderNumber, ts: now() });

      return {
        reserved: true,
        isDuplicate: false,
        status: 'processing',
        responseJson: null,
      };
    },

    /**
     * Mark an event as succeeded.
     * Accepts either:
     *  - markSucceeded(eventId)
     *  - markSucceeded({ eventId, responseJson })
     *  - markSucceeded(eventId, responseJson)
     */
    markSucceeded(eventIdOrObj, maybeResponseJson) {
      let eventId = eventIdOrObj;
      let responseJson = maybeResponseJson ?? null;

      if (eventIdOrObj && typeof eventIdOrObj === 'object') {
        eventId = eventIdOrObj.eventId;
        responseJson = eventIdOrObj.responseJson ?? null;
      }

      const payload = responseJson == null ? null : JSON.stringify(responseJson);
      succeedStmt.run({ eventId, responseJson: payload, ts: now() });
    },

    /**
     * Mark an event as failed.
     * Accepts either:
     *  - markFailed(eventId, errorMessage)
     *  - markFailed({ eventId, errorMessage })
     */
    markFailed(eventIdOrObj, errorMessage) {
      let eventId = eventIdOrObj;
      let msg = errorMessage;

      if (eventIdOrObj && typeof eventIdOrObj === 'object') {
        eventId = eventIdOrObj.eventId;
        msg = eventIdOrObj.errorMessage;
      }

      failStmt.run({
        eventId,
        lastError: msg?.slice(0, 4000) ?? 'Unknown error',
        ts: now(),
      });
    },

    close() {
      db.close();
    },
  };
}
