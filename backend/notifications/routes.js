// ============================================================================
// Notification Feed routes — mounted at /notifications
//
//   GET   /notifications              paginated notification feed for caller
//   GET   /notifications/unread-count unread count for home screen badge
//   PATCH /notifications/:id/read     mark single notification as read
//   POST  /notifications/read-all     mark all notifications as read
// ============================================================================

import { Router } from 'express';
import { query } from '../shared/db/pool.js';
import { requireAuth } from '../shared/auth/middleware.js';
import { notFound, badRequest } from '../shared/http/errors.js';

export const notificationsRouter = Router();

notificationsRouter.use(requireAuth);

/**
 * GET /notifications
 * Paginated notification feed for authenticated user.
 * Query params:
 *   limit  (optional, default 20, max 50)
 *   before (optional notification UUID cursor)
 */
notificationsRouter.get('/', async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
    const beforeId = req.query.before;

    let sql = `
      SELECT id, recipient_user_id, event_type, event_id, title, body, data, is_read, created_at
      FROM notification_feed
      WHERE recipient_user_id = $1
    `;
    const params = [req.user.id];

    if (beforeId) {
      // Find timestamp of the cursor item
      const cursorRes = await query(
        `SELECT created_at FROM notification_feed WHERE id = $1 AND recipient_user_id = $2`,
        [beforeId, req.user.id]
      );
      if (cursorRes.rows.length > 0) {
        params.push(cursorRes.rows[0].created_at);
        sql += ` AND created_at < $${params.length}`;
      }
    }

    params.push(limit);
    sql += ` ORDER BY created_at DESC LIMIT $${params.length}`;

    const { rows } = await query(sql, params);

    res.json({
      notifications: rows,
      hasMore: rows.length === limit,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /notifications/unread-count
 * Returns the unread notification count for caller badge display.
 */
notificationsRouter.get('/unread-count', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT COUNT(*)::int AS count
       FROM notification_feed
       WHERE recipient_user_id = $1 AND is_read = FALSE`,
      [req.user.id]
    );

    res.json({ count: rows[0]?.count || 0 });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /notifications/:id/read
 * Marks a specific notification item as read.
 */
notificationsRouter.patch('/:id/read', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { rows } = await query(
      `UPDATE notification_feed
       SET is_read = TRUE
       WHERE id = $1 AND recipient_user_id = $2
       RETURNING id, recipient_user_id, event_type, event_id, title, body, data, is_read, created_at`,
      [id, req.user.id]
    );

    if (rows.length === 0) {
      return next(notFound('notification_not_found', 'Notification not found or access denied.'));
    }

    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /notifications/read-all
 * Marks all notifications for the caller as read.
 */
notificationsRouter.post('/read-all', async (req, res, next) => {
  try {
    const { rowCount } = await query(
      `UPDATE notification_feed
       SET is_read = TRUE
       WHERE recipient_user_id = $1 AND is_read = FALSE`,
      [req.user.id]
    );

    res.json({ success: true, updatedCount: rowCount });
  } catch (err) {
    next(err);
  }
});
