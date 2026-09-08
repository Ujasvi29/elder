// ============================================================================
// Notifications API client
//
// Communicates with backend /notifications endpoints.
// All requests carry authenticated Bearer headers automatically via apiRequest.
// ============================================================================

import { apiRequest } from './client';

/**
 * Fetches the paginated notification feed for the authenticated user.
 *
 * @param {Object} [options]
 * @param {number} [options.limit=20]
 * @param {string|null} [options.before=null] Notification ID cursor for pagination
 * @returns {Promise<{ notifications: Array, hasMore: boolean }>}
 */
export async function listNotifications({ limit = 20, before = null } = {}) {
  const params = new URLSearchParams();
  if (limit) params.set('limit', String(limit));
  if (before) params.set('before', before);

  const qs = params.toString() ? `?${params.toString()}` : '';
  return apiRequest(`/notifications${qs}`);
}

/**
 * Returns the unread notification count for the authenticated user.
 *
 * @returns {Promise<{ count: number }>}
 */
export async function getUnreadNotificationCount() {
  return apiRequest('/notifications/unread-count');
}

/**
 * Marks a single notification item as read.
 *
 * @param {string} notificationId
 * @returns {Promise<Object>} Updated notification row
 */
export async function markNotificationAsRead(notificationId) {
  return apiRequest(`/notifications/${notificationId}/read`, {
    method: 'PATCH',
  });
}

/**
 * Marks all notifications for the authenticated user as read.
 *
 * @returns {Promise<{ status: string, count: number }>}
 */
export async function markAllNotificationsAsRead() {
  return apiRequest('/notifications/read-all', {
    method: 'POST',
  });
}
