// ============================================================================
// Admin — alert management routes, mounted at /admin/alerts
//
// Every route: requireAuth, requireRole('admin').
//
//   GET  /admin/alerts       platform-wide paginated, filterable alert overview
//   GET  /admin/alerts/:id   single alert detail
// ============================================================================

import { Router } from 'express';
import { requireAuth, requireRole } from '../../shared/auth/middleware.js';
import { notFound } from '../../shared/http/errors.js';
import { listAllAlerts, findAlertForAdmin } from '../../emergency/alerts.js';
import { validateAlertListQuery, validateUuid } from '../services/validate.js';

export const adminAlertsRouter = Router();

// ---------------------------------------------------------------------------
// GET /admin/alerts — platform-wide alerts
// ---------------------------------------------------------------------------

adminAlertsRouter.get('/', requireAuth, requireRole('admin'), async (req, res) => {
  const filters = validateAlertListQuery(req.query);
  const result = await listAllAlerts(filters);

  res.json({
    status: 'ok',
    total: result.total,
    page: result.page,
    limit: result.limit,
    count: result.alerts.length,
    alerts: result.alerts,
  });
});

// ---------------------------------------------------------------------------
// GET /admin/alerts/:id — single alert detail
// ---------------------------------------------------------------------------

adminAlertsRouter.get('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  validateUuid(req.params.id, 'alertId');
  const alert = await findAlertForAdmin(req.params.id);

  if (!alert) {
    throw notFound('alert_not_found', 'No alert with that id.');
  }

  res.json({ status: 'ok', alert });
});
