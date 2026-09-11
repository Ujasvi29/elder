import { Router } from 'express';
import { requireAuth, requireRole } from '../../shared/auth/middleware.js';
import { forbidden } from '../../shared/http/errors.js';
import { hasManageCaregiversPermission } from '../../family/links.js';
import { isAssignedCaregiver } from '../services/authorize.js';
import { createFeedItem } from '../../notifications/feedWriter.js';
import { NOTIFICATION_EVENTS } from '../../notifications/constants.js';
import { query } from '../../shared/db/pool.js';
import {
  validateCreateTask,
  validateTaskStatusUpdate,
  validateUuid,
} from '../services/validate.js';
import {
  createTask,
  findTaskById,
  listTasks,
  updateTaskStatus,
} from '../services/tasks.service.js';

export const tasksRouter = Router();

async function getCaregiverUserId(caregiverId) {
  if (!caregiverId) return null;
  const { rows } = await query(`SELECT user_id FROM caregivers WHERE id = $1`, [caregiverId]);
  return rows[0]?.user_id ?? null;
}

// Deep-link target for task feed items. 'TaskDetails' used to be sent here
// and no navigator registers it, so every task notification tapped went
// nowhere (React Navigation does not throw on an unknown route — see
// NotificationFeedScreen). ScheduleTasksScreen is the screen that actually
// shows a task and carries the caregiver's "Mark Done" button, so send that
// with the params it reads. task.scheduleId is nullable — a task not tied to
// a visit deep-links to the unfiltered list rather than nowhere.
function taskFeedTarget(task) {
  return {
    screen: 'ScheduleTasks',
    params: {
      scheduleId: task.scheduleId,
      elderlyUserId: task.elderlyUserId,
      elderlyName: task.elderlyName,
      caregiverId: task.assignedToCaregiverId,
    },
  };
}

// Elderly self, the caregiver being assigned (if any), family with
// hasManageCaregiversPermission, or admin.
async function requireTaskCreatePermission(req, data) {
  if (req.user.id === data.elderlyUserId || req.user.role === 'admin') return;
  if (req.user.role === 'caregiver' && data.assignedToCaregiverId && (await isAssignedCaregiver(req.user.id, data.assignedToCaregiverId))) return;
  if (await hasManageCaregiversPermission(req.user.id, data.elderlyUserId)) return;
  throw forbidden('not_permitted', 'You are not permitted to create a task for this account.');
}

// Same set for read and for marking a task's status.
async function requireTaskAccess(req, task) {
  if (req.user.id === task.elderlyUserId || req.user.role === 'admin') return;
  if (req.user.role === 'caregiver' && task.assignedToCaregiverId && (await isAssignedCaregiver(req.user.id, task.assignedToCaregiverId))) return;
  if (await hasManageCaregiversPermission(req.user.id, task.elderlyUserId)) return;
  throw forbidden('not_permitted', 'You are not permitted to access this task.');
}

// Create/assign a task
tasksRouter.post('/', requireAuth, requireRole('elderly', 'family', 'caregiver', 'admin'), async (req, res) => {
  const data = validateCreateTask(req.body);
  await requireTaskCreatePermission(req, data);
  const task = await createTask(data, req.user.id);

  getCaregiverUserId(task.assignedToCaregiverId)
    .then((caregiverUserId) => {
      const candidates = [caregiverUserId, task.elderlyUserId, task.assignedByUserId];
      const recipients = [...new Set(candidates.filter((uId) => uId && uId !== req.user.id))];

      if (recipients.length > 0) {
        createFeedItem({
          recipientUserIds: recipients,
          eventType: NOTIFICATION_EVENTS.TASK_ASSIGNED,
          eventId: task.id,
          title: 'Care Task Assigned',
          body: `Task "${task.title}" was created/assigned.`,
          data: taskFeedTarget(task),
          sendPush: true,
        });
      }
    })
    .catch((err) => console.error('Feed error for task creation:', err));

  res.status(201).json({ status: 'ok', task });
});

// List tasks with filters
tasksRouter.get('/', requireAuth, async (req, res) => {
  const { caregiverId, elderlyUserId, carePlanId, scheduleId, status, dueDate } = req.query;
  const tasks = await listTasks({
    caregiverId,
    elderlyUserId,
    carePlanId,
    scheduleId,
    status,
    dueDate,
    user: req.user,
  });
  res.json({ status: 'ok', count: tasks.length, tasks });
});

// Get task by ID
tasksRouter.get('/:id', requireAuth, async (req, res) => {
  validateUuid(req.params.id, 'taskId');
  const task = await findTaskById(req.params.id);
  await requireTaskAccess(req, task);
  res.json({ status: 'ok', task });
});

// Update task status (mark in_progress, completed, skipped)
tasksRouter.patch('/:id/status', requireAuth, requireRole('caregiver', 'elderly', 'family', 'admin'), async (req, res) => {
  validateUuid(req.params.id, 'taskId');
  const { status, completionNotes } = validateTaskStatusUpdate(req.body);
  const existing = await findTaskById(req.params.id);
  await requireTaskAccess(req, existing);
  const task = await updateTaskStatus(req.params.id, status, req.user, completionNotes);

  getCaregiverUserId(task.assignedToCaregiverId)
    .then((caregiverUserId) => {
      const candidates = [caregiverUserId, task.elderlyUserId, task.assignedByUserId];
      const recipients = [...new Set(candidates.filter((uId) => uId && uId !== req.user.id))];

      if (recipients.length > 0) {
        createFeedItem({
          recipientUserIds: recipients,
          eventType: NOTIFICATION_EVENTS.TASK_STATUS_CHANGED,
          eventId: task.id,
          title: `Care Task ${status.charAt(0).toUpperCase() + status.slice(1)}`,
          body: `Task "${task.title}" status updated to ${status}.`,
          data: taskFeedTarget(task),
          sendPush: true,
        });
      }
    })
    .catch((err) => console.error('Feed error for task status update:', err));

  res.json({ status: 'ok', task });
});
