// ============================================================================
// Entry point
//
//   npm start        (from backend/)
//
// Verifies the database connection before binding the port, so a bad
// DATABASE_URL fails at startup with a clear message rather than at the first
// request from the app.
// ============================================================================

import { app } from './app.js';
import { config } from './shared/config/env.js';
import { checkConnection, closePool } from './shared/db/pool.js';
import { startEscalationScheduler, stopEscalationScheduler } from './emergency/notifications/scheduler.js';
import { startLocationRetentionScheduler, stopLocationRetentionScheduler } from './emergency/locationRetentionScheduler.js';
import { startReceiptReconciliationScheduler, stopReceiptReconciliationScheduler } from './notifications/receiptReconciler.js';

const server = await start();

async function start() {
  try {
    const db = await checkConnection();
    console.log(`Database connected: ${db.database} (${db.serverVersion}, ${db.latencyMs}ms)`);
  } catch (err) {
    console.error('Database connection failed:', err.message);
    console.error('Check DATABASE_URL in .env and that PostgreSQL is running.');
    process.exit(1);
  }

  const listener = app.listen(config.port, '0.0.0.0', () => {
    console.log(`ElderCare backend listening on http://0.0.0.0:${config.port} (localhost:${config.port}) [${config.nodeEnv}]`);
    console.log(`Health check: http://localhost:${config.port}/health`);
  });

  startEscalationScheduler();
  startLocationRetentionScheduler();
  startReceiptReconciliationScheduler();

  return listener;
}

// Stop accepting new requests, let in-flight ones finish, then release the
// database connections. Without this, Ctrl+C leaves sessions open on the server.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log(`\n${signal} received, shutting down.`);
    stopEscalationScheduler();
    stopLocationRetentionScheduler();
    stopReceiptReconciliationScheduler();
    server.close(async () => {
      await closePool();
      process.exit(0);
    });
  });
}
