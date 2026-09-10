// ============================================================================
// Admin — user management routes, mounted at /admin/users
//
// Every route: requireAuth, requireRole('admin'). No exceptions.
//
//   GET    /admin/users       paginated, searchable user listing
//   GET    /admin/users/:id   single user detail
//   PATCH  /admin/users/:id   activate / deactivate a user
// ============================================================================

import { Router } from 'express';
import { requireAuth, requireRole } from '../../shared/auth/middleware.js';
import { forbidden, notFound } from '../../shared/http/errors.js';
import { listUsers, findUserForAdmin, setUserActiveStatus } from '../services/users.service.js';
import { validateUserListQuery, validateUserStatusUpdate, validateUuid } from '../services/validate.js';

export const adminUsersRouter = Router();

// ---------------------------------------------------------------------------
// GET /admin/users — paginated, filterable, searchable
// ---------------------------------------------------------------------------

adminUsersRouter.get('/', requireAuth, requireRole('admin'), async (req, res) => {
  const filters = validateUserListQuery(req.query);
  const result = await listUsers(filters);

  res.json({
    status: 'ok',
    total: result.total,
    page: result.page,
    limit: result.limit,
    count: result.users.length,
    users: result.users,
  });
});

// ---------------------------------------------------------------------------
// GET /admin/users/:id — single user detail
// ---------------------------------------------------------------------------

adminUsersRouter.get('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  validateUuid(req.params.id, 'userId');
  const user = await findUserForAdmin(req.params.id);

  if (!user) {
    throw notFound('user_not_found', 'No user with that id.');
  }

  res.json({ status: 'ok', user });
});

// ---------------------------------------------------------------------------
// PATCH /admin/users/:id — activate or deactivate
//
// An admin cannot deactivate their own account through this endpoint — they
// would immediately lose the session they need to undo the action.
// ---------------------------------------------------------------------------

adminUsersRouter.patch('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  validateUuid(req.params.id, 'userId');
  const { isActive } = validateUserStatusUpdate(req.body);

  if (req.params.id === req.user.id && !isActive) {
    throw forbidden('cannot_deactivate_self', 'You cannot deactivate your own admin account.');
  }

  const user = await setUserActiveStatus(req.params.id, isActive);

  if (!user) {
    throw notFound('user_not_found', 'No user with that id.');
  }

  res.json({ status: 'ok', user });
});
