// ============================================================================
// Express application
//
// Builds and exports the app without starting a listener. Keeping `listen` out
// of this file means tests, or a future second entry point, can import the app
// and drive it without binding a port.
//
// Phase 0: no authentication, no feature routes. Only the health check.
// ============================================================================

import express from 'express';
import { checkConnection } from './shared/db/pool.js';
import { ApiError } from './shared/http/errors.js';
import { authRouter } from './shared/auth/routes.js';
import { caregiverRouter } from './caregiver/routes/index.js';
import { emergencyRouter } from './emergency/routes.js';
import { familyRouter } from './family/routes.js';
import { notificationsRouter } from './notifications/routes.js';
export const app = express();

// Trust the proxy hop count in production so req.ip is the real client address
// and not the load balancer's — that address is stored on every refresh token.
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
app.use(express.json());

/**
 * GET /health
 *
 * Liveness plus database reachability. Returns 200 only if a query actually
 * completed against PostgreSQL — a server that is up but cannot reach its
 * database is not healthy, and reporting 200 there would hide the outage.
 */
app.get('/health', async (req, res) => {
  try {
    const db = await checkConnection();
    res.json({
      status: 'ok',
      uptimeSeconds: Math.round(process.uptime()),
      db: { connected: true, ...db },
    });
  } catch (err) {
    // 503, not 500: the server is fine, its dependency is not.
    res.status(503).json({
      status: 'error',
      db: { connected: false, error: err.message },
    });
  }
});

app.use('/auth', authRouter);
app.use('/caregiver', caregiverRouter);
app.use('/emergency', emergencyRouter);
app.use('/family', familyRouter);
app.use('/notifications', notificationsRouter);

// Anything else is not a route yet.
app.use((req, res) => {
  res.status(404).json({
    status: 'error',
    code: 'not_found',
    error: `No route for ${req.method} ${req.originalUrl}`,
  });
});

// Final safety net. Express 5 forwards rejected async handlers here, so an
// unexpected throw returns JSON instead of an HTML stack trace.
app.use((err, req, res, next) => {
  // Deliberate, client-facing failures carry their own status and code.
  if (err instanceof ApiError) {
    return res.status(err.status).json(err.toJSON());
  }

  // A malformed JSON body is the client's fault, not a server fault.
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({
      status: 'error',
      code: 'malformed_json',
      error: 'Request body is not valid JSON.',
    });
  }

  // Anything reaching here is a bug. Log it in full, tell the client nothing:
  // stack traces and driver messages leak internals.
  console.error('Unhandled error:', err);
  res.status(500).json({ status: 'error', code: 'internal_error', error: 'Internal server error' });
});