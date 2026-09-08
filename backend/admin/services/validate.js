// ============================================================================
// Admin — input validation
//
// Same pattern as shared/auth/validate.js and caregiver/services/validate.js:
// collect all problems and report them together.
// ============================================================================

import { badRequest } from '../../shared/http/errors.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_ROLES = ['elderly', 'family', 'caregiver', 'admin'];

export function validateUuid(val, fieldName = 'id') {
  if (!val || !UUID_RE.test(val)) {
    throw badRequest('invalid_id', `${fieldName} must be a valid UUID.`);
  }
}

/**
 * Validates and normalises query parameters for the user listing.
 * Everything is optional — an empty query returns the first page, all roles,
 * all statuses.
 */
export function validateUserListQuery(query = {}) {
  const { q, role, active, page, limit } = query;

  if (role && !VALID_ROLES.includes(role)) {
    throw badRequest('validation_failed', `role must be one of: ${VALID_ROLES.join(', ')}.`);
  }

  let activeBool;
  if (active !== undefined) {
    if (active === 'true') activeBool = true;
    else if (active === 'false') activeBool = false;
    else throw badRequest('validation_failed', 'active must be "true" or "false".');
  }

  const parsedPage = page ? parseInt(page, 10) : 1;
  const parsedLimit = limit ? parseInt(limit, 10) : 25;

  if (isNaN(parsedPage) || parsedPage < 1) {
    throw badRequest('validation_failed', 'page must be a positive integer.');
  }
  if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
    throw badRequest('validation_failed', 'limit must be between 1 and 100.');
  }

  return {
    q: q || null,
    role: role || null,
    active: activeBool,
    page: parsedPage,
    limit: parsedLimit,
  };
}

/**
 * Validates the body for PATCH /admin/users/:id (activate/deactivate).
 */
export function validateUserStatusUpdate(body = {}) {
  const { isActive } = body;

  if (typeof isActive !== 'boolean') {
    throw badRequest('validation_failed', 'isActive must be a boolean (true or false).');
  }

  return { isActive };
}

const VALID_ALERT_STATUSES = ['active', 'acknowledged', 'resolved', 'cancelled', 'false_alarm'];
const VALID_ALERT_TYPES = ['sos', 'fall', 'geofence_breach', 'disaster', 'manual'];
const VALID_ALERT_SEVERITIES = ['low', 'medium', 'high', 'critical'];

/**
 * Validates and normalises query parameters for the admin alert listing.
 */
export function validateAlertListQuery(query = {}) {
  const { status, type, severity, page, limit } = query;

  if (status && !VALID_ALERT_STATUSES.includes(status)) {
    throw badRequest('validation_failed', `status must be one of: ${VALID_ALERT_STATUSES.join(', ')}.`);
  }

  if (type && !VALID_ALERT_TYPES.includes(type)) {
    throw badRequest('validation_failed', `type must be one of: ${VALID_ALERT_TYPES.join(', ')}.`);
  }

  if (severity && !VALID_ALERT_SEVERITIES.includes(severity)) {
    throw badRequest('validation_failed', `severity must be one of: ${VALID_ALERT_SEVERITIES.join(', ')}.`);
  }

  const parsedPage = page ? parseInt(page, 10) : 1;
  const parsedLimit = limit ? parseInt(limit, 10) : 25;

  if (isNaN(parsedPage) || parsedPage < 1) {
    throw badRequest('validation_failed', 'page must be a positive integer.');
  }
  if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
    throw badRequest('validation_failed', 'limit must be between 1 and 100.');
  }

  return {
    status: status || null,
    type: type || null,
    severity: severity || null,
    page: parsedPage,
    limit: parsedLimit,
  };
}

