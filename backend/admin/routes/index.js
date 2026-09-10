// ============================================================================
// Admin Module Router — mounted at /admin
// ============================================================================

import { Router } from 'express';
import { adminUsersRouter } from './users.routes.js';
import { adminAlertsRouter } from './alerts.routes.js';

export const adminRouter = Router();

adminRouter.use('/users', adminUsersRouter);
adminRouter.use('/alerts', adminAlertsRouter);
