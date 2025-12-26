import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

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
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      lastError TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_webhook_events_orderNumber ON webhook_events(orderNumber);
  `);

  const now = () => Date.now();

  const getStmt = db.prepare(
    'SELECT eventId, status, topic, shopDomain, orderNumber, createdAt, updatedAt, lastError FROM webhook_events WHERE eventId = ?'
  );

  const reserveStmt = db.prepare(`
    INSERT INTO webhook_events (eventId, status, topic, shopDomain, orderNumber, createdAt, updatedAt)
    VALUES (@eventId, 'processing', @topic, @shopDomain, @orderNumber, @ts, @ts)
  `);

  const succeedStmt = db.prepare(
    `UPDATE webhook_events SET status='succeeded', updatedAt=@ts WHERE eventId=@eventId`
  );

  const failStmt = db.prepare(
    `UPDATE webhook_events SET status='failed', lastError=@lastError, updatedAt=@ts WHERE eventId=@eventId`
  );

  return {
    dbPath,
    /** Returns row or null */
    get(eventId) {
      return getStmt.get(eventId) ?? null;
    },

    /**
     * Inserts an event row in "processing" state.
     * Returns { reserved: true } if inserted, or { reserved: false, existing: row } if already present.
     */
    reserve({ eventId, topic, shopDomain, orderNumber }) {
      const existing = getStmt.get(eventId);
      if (existing) return { reserved: false, existing };
      reserveStmt.run({ eventId, topic, shopDomain, orderNumber, ts: now() });
      return { reserved: true };
    },

    markSucceeded(eventId) {
      succeedStmt.run({ eventId, ts: now() });
    },

    markFailed(eventId, errorMessage) {
      failStmt.run({ eventId, lastError: errorMessage?.slice(0, 4000) ?? 'Unknown error', ts: now() });
    },

    close() {
      db.close();
    },
  };
}

