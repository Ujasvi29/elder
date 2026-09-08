import { query, pool } from '../shared/db/pool.js';

async function migrate() {
  await query(`
    CREATE TABLE IF NOT EXISTS push_receipt_tickets (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ticket_id       TEXT NOT NULL UNIQUE,
      expo_push_token TEXT NOT NULL,
      user_id         UUID REFERENCES users (id) ON DELETE CASCADE,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_push_receipt_tickets_created_at
      ON push_receipt_tickets (created_at);
  `);
  console.log('push_receipt_tickets table created or verified successfully.');
  await pool.end();
}

migrate().catch(async (err) => {
  console.error('Migration failed:', err);
  await pool.end();
  process.exit(1);
});
