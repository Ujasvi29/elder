// ============================================================================
// Input validation for the emergency alert routes
//
// Same shape as shared/auth/validate.js: collect every problem and report
// them together rather than one at a time.
// ============================================================================

import { badRequest } from '../shared/http/errors.js';
import { normalizePhone } from '../shared/phone.js';

const ALERT_STATUSES = ['active', 'acknowledged', 'resolved', 'cancelled', 'false_alarm'];

// 'sos_capture' is reserved: nothing writes it yet, since the SOS-press
// capture goes straight onto alerts.latitude/longitude, not this table. Kept
// here so validation is ready the moment that changes.
const LOCATION_SOURCES = ['foreground_mount', 'background_task', 'sos_capture'];

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 50;

function fieldErrors(checks) {
  return checks.filter((c) => c.when).map(({ field, message }) => ({ field, message }));
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

// `null` and `undefined` are both "not provided" here — a caller that omits
// a field and one that explicitly sends `null` for it mean the same thing.
// Only `latitude === undefined` used to be recognised, which meant a client
// sending `{ latitude: null, longitude: null }` (as opposed to leaving the
// keys out) fell through to the "must be a number" checks below and got
// rejected. That is exactly what happened to a fall alert sent with no GPS
// fix — see BUILD_LOG.md.
function isMissing(value) {
  return value === undefined || value === null;
}

/** Shared by the SOS body and the locations endpoint — same column, same rules. */
function coordinateErrors(latitude, longitude, { required }) {
  if (!required && isMissing(latitude) && isMissing(longitude)) return [];

  return fieldErrors([
    { when: isMissing(latitude) || isMissing(longitude),
      field: 'latitude', message: 'latitude and longitude must be sent together.' },
    { when: !isMissing(latitude) && (!isFiniteNumber(latitude) || latitude < -90 || latitude > 90),
      field: 'latitude', message: 'Latitude must be a number between -90 and 90.' },
    { when: !isMissing(longitude) && (!isFiniteNumber(longitude) || longitude < -180 || longitude > 180),
      field: 'longitude', message: 'Longitude must be a number between -180 and 180.' },
  ]);
}

/** GET /emergency/alerts and GET /emergency/family/alerts share this shape. */
export function validateListQuery(query = {}) {
  const { status, limit } = query;

  const errors = fieldErrors([
    { when: status !== undefined && !ALERT_STATUSES.includes(status),
      field: 'status', message: `Status must be one of: ${ALERT_STATUSES.join(', ')}.` },
    { when: limit !== undefined && (!/^\d+$/.test(String(limit)) || Number(limit) < 1),
      field: 'limit', message: 'Limit must be a positive whole number.' },
  ]);

  if (errors.length > 0) {
    throw badRequest('validation_failed', 'One or more fields are invalid.', { details: errors });
  }

  return {
    status: status ?? null,
    limit: limit === undefined ? DEFAULT_LIST_LIMIT : Math.min(Number(limit), MAX_LIST_LIMIT),
  };
}

/**
 * POST /emergency/alerts — `latitude`/`longitude` are optional and, if sent,
 * captured on the device at press time and written straight onto the alert.
 * Never required: an SOS must fire with or without a location fix.
 *
 * `accuracyMeters`/`isApproximate`/`capturedAt` are optional alongside the
 * coordinates — Phase 1 step 4, carrying a getLastKnownPositionAsync floor
 * value onto the initial send when no fresh fix landed within
 * SOS_LOCATION_TIMEOUT_MS. `isApproximate` defaults false, matching a fresh
 * fix; the client only ever sends true for a last-known reading.
 */
export function validateSosAlertBody(body = {}) {
  const { latitude, longitude, accuracyMeters, isApproximate, capturedAt } = body;
  const errors = [
    ...coordinateErrors(latitude, longitude, { required: false }),
    ...fieldErrors([
      { when: accuracyMeters !== undefined && (!isFiniteNumber(accuracyMeters) || accuracyMeters < 0),
        field: 'accuracyMeters', message: 'Accuracy must be a non-negative number.' },
      { when: isApproximate !== undefined && typeof isApproximate !== 'boolean',
        field: 'isApproximate', message: 'isApproximate must be a boolean.' },
      { when: capturedAt !== undefined && Number.isNaN(new Date(capturedAt).getTime()),
        field: 'capturedAt', message: 'capturedAt must be a valid date.' },
    ]),
  ];

  if (errors.length > 0) {
    throw badRequest('validation_failed', 'One or more fields are invalid.', { details: errors });
  }

  return {
    latitude: latitude ?? null,
    longitude: longitude ?? null,
    accuracyMeters: accuracyMeters ?? null,
    isApproximate: isApproximate ?? false,
    capturedAt: capturedAt !== undefined ? new Date(capturedAt).toISOString() : null,
  };
}

/**
 * PATCH /emergency/alerts/:id/location — a fresh fix that landed after the
 * alert already sent (Phase 1 step 4's async-attach path). Always a real
 * reading, never a last-known one — isApproximate is not a caller option
 * here, alerts.js hardcodes it false on write.
 */
export function validateAttachLocationBody(body = {}) {
  const { latitude, longitude, accuracyMeters, capturedAt } = body;

  const errors = [
    ...coordinateErrors(latitude, longitude, { required: true }),
    ...fieldErrors([
      { when: accuracyMeters !== undefined && (!isFiniteNumber(accuracyMeters) || accuracyMeters < 0),
        field: 'accuracyMeters', message: 'Accuracy must be a non-negative number.' },
      { when: capturedAt !== undefined && Number.isNaN(new Date(capturedAt).getTime()),
        field: 'capturedAt', message: 'capturedAt must be a valid date.' },
    ]),
  ];

  if (errors.length > 0) {
    throw badRequest('validation_failed', 'One or more fields are invalid.', { details: errors });
  }

  return {
    latitude,
    longitude,
    accuracyMeters: accuracyMeters ?? null,
    capturedAt: capturedAt !== undefined ? new Date(capturedAt).toISOString() : null,
  };
}

/** POST /emergency/locations */
export function validateCreateLocationBody(body = {}) {
  const { latitude, longitude, accuracyMeters, batteryLevel, recordedAt, source } = body;

  const errors = [
    ...coordinateErrors(latitude, longitude, { required: true }),
    ...fieldErrors([
      { when: accuracyMeters !== undefined && (!isFiniteNumber(accuracyMeters) || accuracyMeters < 0),
        field: 'accuracyMeters', message: 'Accuracy must be a non-negative number.' },
      { when: batteryLevel !== undefined &&
          (!Number.isInteger(batteryLevel) || batteryLevel < 0 || batteryLevel > 100),
        field: 'batteryLevel', message: 'Battery level must be a whole number between 0 and 100.' },
      { when: recordedAt !== undefined && Number.isNaN(new Date(recordedAt).getTime()),
        field: 'recordedAt', message: 'recordedAt must be a valid date.' },
      { when: source !== undefined && !LOCATION_SOURCES.includes(source),
        field: 'source', message: `source must be one of: ${LOCATION_SOURCES.join(', ')}.` },
    ]),
  ];

  if (errors.length > 0) {
    throw badRequest('validation_failed', 'One or more fields are invalid.', { details: errors });
  }

  return {
    latitude,
    longitude,
    accuracyMeters: accuracyMeters ?? null,
    batteryLevel: batteryLevel ?? null,
    recordedAt: recordedAt !== undefined ? new Date(recordedAt).toISOString() : null,
    source: source ?? null,
  };
}

/** GET /emergency/family/alerts/history — same limit rules, no status filter (fixed server-side). */
export function validateHistoryQuery(query = {}) {
  const { limit } = query;

  const errors = fieldErrors([
    { when: limit !== undefined && (!/^\d+$/.test(String(limit)) || Number(limit) < 1),
      field: 'limit', message: 'Limit must be a positive whole number.' },
  ]);

  if (errors.length > 0) {
    throw badRequest('validation_failed', 'One or more fields are invalid.', { details: errors });
  }

  return {
    limit: limit === undefined ? DEFAULT_LIST_LIMIT : Math.min(Number(limit), MAX_LIST_LIMIT),
  };
}

const DEVICE_PLATFORMS = ['ios', 'android', 'web'];

/** POST /emergency/device-tokens */
export function validateRegisterDeviceTokenBody(body = {}) {
  const { expoPushToken, previousExpoPushToken, platform, deviceName, deviceModel, appVersion, osVersion } = body;

  const shortString = (value, max) => typeof value === 'string' && value.length <= max;

  const errors = fieldErrors([
    { when: typeof expoPushToken !== 'string' || expoPushToken.trim() === '',
      field: 'expoPushToken', message: 'expoPushToken is required.' },
    { when: typeof expoPushToken === 'string' && expoPushToken.length > 255,
      field: 'expoPushToken', message: 'expoPushToken must be 255 characters or fewer.' },
    { when: previousExpoPushToken !== undefined && (typeof previousExpoPushToken !== 'string' || previousExpoPushToken.length > 255),
      field: 'previousExpoPushToken', message: 'previousExpoPushToken must be a string of 255 characters or fewer.' },
    { when: !DEVICE_PLATFORMS.includes(platform),
      field: 'platform', message: `platform must be one of: ${DEVICE_PLATFORMS.join(', ')}.` },
    { when: deviceName !== undefined && !shortString(deviceName, 120),
      field: 'deviceName', message: 'deviceName must be a string of 120 characters or fewer.' },
    { when: deviceModel !== undefined && !shortString(deviceModel, 120),
      field: 'deviceModel', message: 'deviceModel must be a string of 120 characters or fewer.' },
    { when: appVersion !== undefined && !shortString(appVersion, 20),
      field: 'appVersion', message: 'appVersion must be a string of 20 characters or fewer.' },
    { when: osVersion !== undefined && !shortString(osVersion, 40),
      field: 'osVersion', message: 'osVersion must be a string of 40 characters or fewer.' },
  ]);

  if (errors.length > 0) {
    throw badRequest('validation_failed', 'One or more fields are invalid.', { details: errors });
  }

  return {
    expoPushToken: expoPushToken.trim(),
    previousExpoPushToken: previousExpoPushToken ? previousExpoPushToken.trim() : null,
    platform,
    deviceName: deviceName ?? null,
    deviceModel: deviceModel ?? null,
    appVersion: appVersion ?? null,
    osVersion: osVersion ?? null,
  };
}

/** DELETE /emergency/device-tokens */
export function validateDeactivateDeviceTokenBody(body = {}) {
  const { expoPushToken } = body;

  const errors = fieldErrors([
    { when: typeof expoPushToken !== 'string' || expoPushToken.trim() === '',
      field: 'expoPushToken', message: 'expoPushToken is required.' },
    { when: typeof expoPushToken === 'string' && expoPushToken.length > 255,
      field: 'expoPushToken', message: 'expoPushToken must be 255 characters or fewer.' },
  ]);

  if (errors.length > 0) {
    throw badRequest('validation_failed', 'One or more fields are invalid.', { details: errors });
  }

  return {
    expoPushToken: expoPushToken.trim(),
  };
}

const CONTACT_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * POST /emergency/contacts. `elderlyUserId` is required only when the caller
 * is not the elderly user themselves — routes.js decides that, same pattern
 * as family/validate.js's invite body. `priority` left `null` when omitted
 * means "append after the current max"; routes.js resolves that, not here.
 */
export function validateCreateContactBody(body = {}) {
  const {
    elderlyUserId, fullName, phone, email, relationship, priority,
    notifyBySms, notifyByCall, notifyByPush,
  } = body;

  const normalizedPhone = normalizePhone(phone);
  const hasEmail = typeof email === 'string' && email.trim() !== '';

  const errors = fieldErrors([
    { when: elderlyUserId !== undefined && !CONTACT_UUID_RE.test(elderlyUserId),
      field: 'elderlyUserId', message: 'elderlyUserId must be a UUID.' },
    { when: typeof fullName !== 'string' || fullName.trim().length < 1 || fullName.trim().length > 120,
      field: 'fullName', message: 'Full name is required, 1-120 characters.' },
    { when: !normalizedPhone.ok, field: 'phone', message: normalizedPhone.reason },
    { when: email !== undefined && email !== null && typeof email !== 'string',
      field: 'email', message: 'Email must be a string.' },
    { when: hasEmail && !EMAIL_RE.test(email.trim()), field: 'email', message: 'Email is not a valid address.' },
    { when: hasEmail && email.trim().length > 255, field: 'email', message: 'Email must be 255 characters or fewer.' },
    { when: relationship !== undefined && (typeof relationship !== 'string' || relationship.length > 50),
      field: 'relationship', message: 'Relationship must be a string of 50 characters or fewer.' },
    { when: priority !== undefined && (!Number.isInteger(priority) || priority < 1 || priority > 10),
      field: 'priority', message: 'Priority must be a whole number between 1 and 10.' },
    { when: notifyBySms !== undefined && typeof notifyBySms !== 'boolean',
      field: 'notifyBySms', message: 'notifyBySms must be a boolean.' },
    { when: notifyByCall !== undefined && typeof notifyByCall !== 'boolean',
      field: 'notifyByCall', message: 'notifyByCall must be a boolean.' },
    { when: notifyByPush !== undefined && typeof notifyByPush !== 'boolean',
      field: 'notifyByPush', message: 'notifyByPush must be a boolean.' },
  ]);

  if (errors.length > 0) {
    throw badRequest('validation_failed', 'One or more fields are invalid.', { details: errors });
  }

  return {
    elderlyUserId: elderlyUserId ?? null,
    fullName: fullName.trim(),
    phone: normalizedPhone.value,
    email: hasEmail ? email.trim().toLowerCase() : null,
    relationship: typeof relationship === 'string' && relationship.trim() !== '' ? relationship.trim() : null,
    priority: priority ?? null,
    notifyBySms: notifyBySms ?? true,
    notifyByCall: notifyByCall ?? true,
    notifyByPush: notifyByPush ?? true,
  };
}

/**
 * GET /emergency/contacts — elderlyUserId is required only for a non-elderly
 * caller; routes.js decides that.
 */
export function validateContactsListQuery(query = {}) {
  const { elderlyUserId } = query;

  const errors = fieldErrors([
    { when: elderlyUserId !== undefined && !CONTACT_UUID_RE.test(elderlyUserId),
      field: 'elderlyUserId', message: 'elderlyUserId must be a UUID.' },
  ]);

  if (errors.length > 0) {
    throw badRequest('validation_failed', 'One or more fields are invalid.', { details: errors });
  }

  return { elderlyUserId: elderlyUserId ?? null };
}

/**
 * PATCH /emergency/contacts/:id — every field optional, but at least one must
 * be present. No separate reorder endpoint: sending only `priority` is how
 * reordering works.
 */
export function validateUpdateContactBody(body = {}) {
  const { fullName, phone, email, relationship, priority, notifyBySms, notifyByCall, notifyByPush } = body;

  const providedPhone = phone !== undefined;
  const normalizedPhone = providedPhone ? normalizePhone(phone) : null;
  const hasEmail = typeof email === 'string' && email.trim() !== '';

  const anyFieldProvided = [fullName, phone, email, relationship, priority, notifyBySms, notifyByCall, notifyByPush]
    .some((v) => v !== undefined);

  const errors = fieldErrors([
    { when: !anyFieldProvided, field: 'body', message: 'At least one field must be provided.' },
    { when: fullName !== undefined && (typeof fullName !== 'string' || fullName.trim().length < 1 || fullName.trim().length > 120),
      field: 'fullName', message: 'Full name must be 1-120 characters.' },
    { when: providedPhone && !normalizedPhone.ok, field: 'phone', message: normalizedPhone?.reason },
    { when: email !== undefined && email !== null && typeof email !== 'string',
      field: 'email', message: 'Email must be a string.' },
    { when: hasEmail && !EMAIL_RE.test(email.trim()), field: 'email', message: 'Email is not a valid address.' },
    { when: hasEmail && email.trim().length > 255, field: 'email', message: 'Email must be 255 characters or fewer.' },
    { when: relationship !== undefined && relationship !== null &&
        (typeof relationship !== 'string' || relationship.length > 50),
      field: 'relationship', message: 'Relationship must be a string of 50 characters or fewer.' },
    { when: priority !== undefined && (!Number.isInteger(priority) || priority < 1 || priority > 10),
      field: 'priority', message: 'Priority must be a whole number between 1 and 10.' },
    { when: notifyBySms !== undefined && typeof notifyBySms !== 'boolean',
      field: 'notifyBySms', message: 'notifyBySms must be a boolean.' },
    { when: notifyByCall !== undefined && typeof notifyByCall !== 'boolean',
      field: 'notifyByCall', message: 'notifyByCall must be a boolean.' },
    { when: notifyByPush !== undefined && typeof notifyByPush !== 'boolean',
      field: 'notifyByPush', message: 'notifyByPush must be a boolean.' },
  ]);

  if (errors.length > 0) {
    throw badRequest('validation_failed', 'One or more fields are invalid.', { details: errors });
  }

  const result = {};
  if (fullName !== undefined) result.fullName = fullName.trim();
  if (providedPhone) result.phone = normalizedPhone.value;
  if (email !== undefined) result.email = hasEmail ? email.trim().toLowerCase() : null;
  if (relationship !== undefined) {
    result.relationship = typeof relationship === 'string' && relationship.trim() !== '' ? relationship.trim() : null;
  }
  if (priority !== undefined) result.priority = priority;
  if (notifyBySms !== undefined) result.notifyBySms = notifyBySms;
  if (notifyByCall !== undefined) result.notifyByCall = notifyByCall;
  if (notifyByPush !== undefined) result.notifyByPush = notifyByPush;
  return result;
}

/**
 * POST /emergency/geofences. `elderlyUserId` required only when the caller
 * isn't the elderly user — routes.js decides that, same pattern as contacts.
 * `centerLatitude`/`centerLongitude` reuse coordinateErrors, required here:
 * unlike an SOS press, a zone with no center means nothing.
 */
export function validateCreateGeofenceBody(body = {}) {
  const { elderlyUserId, name, centerLatitude, centerLongitude, radiusMeters, alertOnExit, alertOnEnter } = body;

  const errors = [
    ...coordinateErrors(centerLatitude, centerLongitude, { required: true }),
    ...fieldErrors([
      { when: elderlyUserId !== undefined && !CONTACT_UUID_RE.test(elderlyUserId),
        field: 'elderlyUserId', message: 'elderlyUserId must be a UUID.' },
      { when: typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 100,
        field: 'name', message: 'Name is required, 1-100 characters.' },
      { when: !Number.isInteger(radiusMeters) || radiusMeters <= 0,
        field: 'radiusMeters', message: 'radiusMeters must be a positive whole number.' },
      { when: alertOnExit !== undefined && typeof alertOnExit !== 'boolean',
        field: 'alertOnExit', message: 'alertOnExit must be a boolean.' },
      { when: alertOnEnter !== undefined && typeof alertOnEnter !== 'boolean',
        field: 'alertOnEnter', message: 'alertOnEnter must be a boolean.' },
    ]),
  ];

  if (errors.length > 0) {
    throw badRequest('validation_failed', 'One or more fields are invalid.', { details: errors });
  }

  return {
    elderlyUserId: elderlyUserId ?? null,
    name: name.trim(),
    centerLatitude,
    centerLongitude,
    radiusMeters,
    alertOnExit: alertOnExit ?? true,
    alertOnEnter: alertOnEnter ?? false,
  };
}

/** PATCH /emergency/geofences/:id — every field optional, but at least one must be present. */
export function validateUpdateGeofenceBody(body = {}) {
  const { name, centerLatitude, centerLongitude, radiusMeters, alertOnExit, alertOnEnter } = body;

  const anyCoordProvided = centerLatitude !== undefined || centerLongitude !== undefined;
  const anyFieldProvided = [name, centerLatitude, centerLongitude, radiusMeters, alertOnExit, alertOnEnter]
    .some((v) => v !== undefined);

  const errors = [
    ...(anyCoordProvided ? coordinateErrors(centerLatitude, centerLongitude, { required: true }) : []),
    ...fieldErrors([
      { when: !anyFieldProvided, field: 'body', message: 'At least one field must be provided.' },
      { when: name !== undefined && (typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 100),
        field: 'name', message: 'Name must be 1-100 characters.' },
      { when: radiusMeters !== undefined && (!Number.isInteger(radiusMeters) || radiusMeters <= 0),
        field: 'radiusMeters', message: 'radiusMeters must be a positive whole number.' },
      { when: alertOnExit !== undefined && typeof alertOnExit !== 'boolean',
        field: 'alertOnExit', message: 'alertOnExit must be a boolean.' },
      { when: alertOnEnter !== undefined && typeof alertOnEnter !== 'boolean',
        field: 'alertOnEnter', message: 'alertOnEnter must be a boolean.' },
    ]),
  ];

  if (errors.length > 0) {
    throw badRequest('validation_failed', 'One or more fields are invalid.', { details: errors });
  }

  const result = {};
  if (name !== undefined) result.name = name.trim();
  if (centerLatitude !== undefined) result.centerLatitude = centerLatitude;
  if (centerLongitude !== undefined) result.centerLongitude = centerLongitude;
  if (radiusMeters !== undefined) result.radiusMeters = radiusMeters;
  if (alertOnExit !== undefined) result.alertOnExit = alertOnExit;
  if (alertOnEnter !== undefined) result.alertOnEnter = alertOnEnter;
  return result;
}

/**
 * GET /emergency/geofences and GET /emergency/locations/latest —
 * elderlyUserId required only for a non-elderly caller. Same shape for both:
 * neither takes anything beyond which elderly user's data is being asked
 * for.
 */
export function validateGeofenceListQuery(query = {}) {
  const { elderlyUserId } = query;

  const errors = fieldErrors([
    { when: elderlyUserId !== undefined && !CONTACT_UUID_RE.test(elderlyUserId),
      field: 'elderlyUserId', message: 'elderlyUserId must be a UUID.' },
  ]);

  if (errors.length > 0) {
    throw badRequest('validation_failed', 'One or more fields are invalid.', { details: errors });
  }

  return { elderlyUserId: elderlyUserId ?? null };
}

const DEFAULT_HISTORY_DAYS = 3;
const MAX_HISTORY_DAYS = 30;

/** GET /emergency/geofences/:id/history — how many days back to tally. */
export function validateGeofenceHistoryQuery(query = {}) {
  const { days } = query;

  const errors = fieldErrors([
    { when: days !== undefined && (!/^\d+$/.test(String(days)) || Number(days) < 1),
      field: 'days', message: 'days must be a positive whole number.' },
  ]);

  if (errors.length > 0) {
    throw badRequest('validation_failed', 'One or more fields are invalid.', { details: errors });
  }

  return {
    days: days === undefined ? DEFAULT_HISTORY_DAYS : Math.min(Number(days), MAX_HISTORY_DAYS),
  };
}

/** POST /emergency/alerts/:id/cancel and /resolve share this body shape. */
export function validateCloseAlertBody(body = {}) {
  const { note } = body;

  const errors = fieldErrors([
    { when: note !== undefined && note !== null && typeof note !== 'string',
      field: 'note', message: 'Note must be a string.' },
    { when: typeof note === 'string' && note.length > 2000,
      field: 'note', message: 'Note must be 2000 characters or fewer.' },
  ]);

  if (errors.length > 0) {
    throw badRequest('validation_failed', 'One or more fields are invalid.', { details: errors });
  }

  return { note: typeof note === 'string' && note.trim() !== '' ? note.trim() : null };
}
