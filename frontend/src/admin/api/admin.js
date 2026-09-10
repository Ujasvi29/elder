// ============================================================================
// Admin API Client
//
// Wraps all admin-specific endpoints: user management and platform-wide alerts.
// Every request goes through the shared apiRequest, which automatically
// attaches the Bearer token and handles refresh.
// ============================================================================

import { apiRequest } from '../../shared/api/client';

/**
 * GET /admin/users — paginated, filterable, searchable user list.
 *
 * @param {object} [filters]
 * @param {string} [filters.q]        — search query (name, email, phone)
 * @param {string} [filters.role]     — 'elderly' | 'family' | 'caregiver' | 'admin'
 * @param {boolean} [filters.active]  — true | false
 * @param {number} [filters.page]     — 1-indexed page number
 * @param {number} [filters.limit]    — items per page (default 25)
 */
export function listAdminUsers(filters = {}) {
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (filters.role) params.set('role', filters.role);
  if (filters.active !== undefined && filters.active !== null && filters.active !== '') {
    params.set('active', String(filters.active));
  }
  if (filters.page) params.set('page', String(filters.page));
  if (filters.limit) params.set('limit', String(filters.limit));

  const query = params.toString();
  return apiRequest(`/admin/users${query ? `?${query}` : ''}`);
}

/**
 * GET /admin/users/:id — single user detail.
 */
export function getAdminUser(id) {
  return apiRequest(`/admin/users/${id}`);
}

/**
 * PATCH /admin/users/:id — activate or deactivate a user account.
 *
 * @param {string} id
 * @param {boolean} isActive
 */
export function updateUserActiveStatus(id, isActive) {
  return apiRequest(`/admin/users/${id}`, {
    method: 'PATCH',
    body: { isActive },
  });
}

/**
 * GET /emergency/admin/alerts — platform-wide alert overview.
 *
 * @param {object} [filters]
 * @param {string} [filters.status]   — 'active' | 'acknowledged' | 'resolved' | 'cancelled' | 'false_alarm'
 * @param {string} [filters.type]     — 'sos' | 'fall' | 'geofence_breach' | 'disaster' | 'manual'
 * @param {string} [filters.severity] — 'low' | 'medium' | 'high' | 'critical'
 * @param {number} [filters.page]     — 1-indexed page number
 * @param {number} [filters.limit]    — items per page (default 25)
 */
export function listAdminAlerts(filters = {}) {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.type) params.set('type', filters.type);
  if (filters.severity) params.set('severity', filters.severity);
  if (filters.page) params.set('page', String(filters.page));
  if (filters.limit) params.set('limit', String(filters.limit));

  const query = params.toString();
  return apiRequest(`/admin/alerts${query ? `?${query}` : ''}`);
}

/**
 * GET /emergency/admin/alerts/:id — single alert detail for admin.
 */
export function getAdminAlert(id) {
  return apiRequest(`/admin/alerts/${id}`);
}
