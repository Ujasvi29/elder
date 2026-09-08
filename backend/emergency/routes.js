// ============================================================================
// Emergency routes — mounted at /emergency
//
//   POST /emergency/alerts               press SOS
//   GET  /emergency/alerts               the caller's own alerts
//   POST /emergency/alerts/:id/cancel    "that was a mistake" — owner only
//   POST /emergency/alerts/:id/resolve   "this is handled" — owner or family
//   POST /emergency/alerts/:id/acknowledge  "I've seen this" — family only, stops escalation
//   PATCH /emergency/alerts/:id/location attach a fresh fix that landed after send — owner only, any status
//   GET  /emergency/family/alerts        active alerts for linked elderly users
//   GET  /emergency/family/alerts/history recent resolved/cancelled alerts, last 7 days
//   POST /emergency/locations            record one GPS reading
//   GET  /emergency/locations/latest     most recent reading for an elderly user
//   POST /emergency/device-tokens        register this device for push
//   POST /emergency/geofences            define a safe (or restricted) zone
//   GET  /emergency/geofences            list zones for an elderly user
//   PATCH /emergency/geofences/:id       edit a zone
//   DELETE /emergency/geofences/:id      soft-delete a zone
//   GET  /emergency/geofences/:id/history  recent inside/outside tally for one zone
//
// Phase 1, step 3: emergency contact notification and escalation.
// Phase 3, step 3: geofencing — breach detection lives in geofenceCheck.js,
// called from POST /locations below; no map UI yet. See BUILD_LOG.md.
// ============================================================================

import { Router } from 'express';
import { badRequest, notFound, forbidden, conflict } from '../shared/http/errors.js';
import { requireAuth, requireRole } from '../shared/auth/middleware.js';
import {
  toPublicAlert,
  findActiveSosAlert,
  createSosAlert,
  findActiveFallAlert,
  createFallAlert,
  listAlertsForUser,
  findAlertById,
  cancelAlert,
  resolveAlert,
  acknowledgeAlert,
  attachAlertLocation,
  findFamilyLink,
  listActiveFamilyAlerts,
  listFamilyAlertHistory,
  listAllAlerts,
  findAlertForAdmin,
} from './alerts.js';
import { validateAlertListQuery, validateUuid } from '../admin/services/validate.js';
import { createLocation, toPublicLocation, findLatestLocation, listLocationsSince } from './locations.js';
import { registerDeviceToken, deactivateDeviceTokenForUser } from './deviceTokens.js';
import { advanceFanout } from './notifications/fanout.js';
import { broadcastToFamily } from './notifications/broadcast.js';
import { createFeedItem } from '../notifications/feedWriter.js';
import { NOTIFICATION_EVENTS } from '../notifications/constants.js';
import { listLinksForElderly } from '../family/links.js';
import { ambulanceRouter } from './ambulance/routes.js';
import { disasterRouter } from './disaster/routes.js';
import {
  toPublicContact,
  findContactById,
  listContactsForUser,
  createContact,
  updateContact,
  deactivateContact,
  nextContactPriority,
} from './contacts.js';
import {
  toPublicGeofence,
  findGeofenceById,
  listGeofencesForUser,
  createGeofence,
  updateGeofence,
  deactivateGeofence,
} from './geofences.js';
import { checkGeofences } from './geofenceCheck.js';
import { haversineMeters, classify } from './geofenceMath.js';
import { hasManageContactsPermission, hasViewLocationPermission, hasManageGeofencesPermission } from '../family/links.js';
import {
  validateListQuery,
  validateCloseAlertBody,
  validateHistoryQuery,
  validateSosAlertBody,
  validateAttachLocationBody,
  validateCreateLocationBody,
  validateRegisterDeviceTokenBody,
  validateDeactivateDeviceTokenBody,
  validateCreateContactBody,
  validateContactsListQuery,
  validateUpdateContactBody,
  validateCreateGeofenceBody,
  validateUpdateGeofenceBody,
  validateGeofenceListQuery,
  validateGeofenceHistoryQuery,
} from './validate.js';

export const emergencyRouter = Router();

const PG_UNIQUE_VIOLATION = '23505';

emergencyRouter.use('/ambulance', ambulanceRouter);
emergencyRouter.use('/disaster-alerts', disasterRouter);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireAlertId(req) {
  const { id } = req.params;
  if (!UUID_RE.test(id)) {
    throw badRequest('validation_failed', 'Alert id is not a valid identifier.', {
      details: [{ field: 'id', message: 'Must be a UUID.' }],
    });
  }
  return id;
}

function requireContactId(req) {
  const { id } = req.params;
  if (!UUID_RE.test(id)) {
    throw badRequest('validation_failed', 'Contact id is not a valid identifier.', {
      details: [{ field: 'id', message: 'Must be a UUID.' }],
    });
  }
  return id;
}

function requireGeofenceId(req) {
  const { id } = req.params;
  if (!UUID_RE.test(id)) {
    throw badRequest('validation_failed', 'Geofence id is not a valid identifier.', {
      details: [{ field: 'id', message: 'Must be a UUID.' }],
    });
  }
  return id;
}

// ---------------------------------------------------------------------------
// POST /emergency/alerts
// ---------------------------------------------------------------------------

emergencyRouter.post('/alerts', requireAuth, async (req, res) => {
  const location = validateSosAlertBody(req.body);

  // One active SOS per person at a time. A second press while one is already
  // open is not a second emergency — it is almost always the same emergency
  // pressed twice, or a retry after a slow response. Returning the existing
  // alert instead of creating another means the app can treat this as
  // reassurance ("help is already on the way") rather than an error.
  const existing = await findActiveSosAlert(req.user.id);
  if (existing) {
    throw conflict('sos_already_active', 'An SOS alert is already active for this account.', {
      alert: toPublicAlert(existing),
    });
  }

  const alert = await createSosAlert(req.user.id, location);

  // Fire-and-forget: notifying contact 1 must never delay the response to the
  // person who just pressed SOS, same "never a precondition" principle as the
  // GPS capture above. Errors are logged, not thrown — a notification problem
  // is not a reason to fail the alert that already exists.
  advanceFanout(alert.id).catch((err) =>
    console.error(`Initial fanout failed for alert ${alert.id}:`, err)
  );

  // Separate tier, separate call, own catch — not inside advanceFanout and not
  // re-run by the escalation scheduler. Every actively-linked family member
  // gets pushed once, right now: dashboard access is a different opt-in than
  // being phoned, but silence when SOS fires is the dangerous failure mode,
  // not an extra push. SOS only for now — see BUILD_LOG.md.
  broadcastToFamily(alert.id).catch((err) =>
    console.error(`Family broadcast failed for alert ${alert.id}:`, err)
  );

  listLinksForElderly(req.user.id, 'active')
    .then((links) => {
      const familyUserIds = links.map((l) => l.family_user_id);
      if (familyUserIds.length > 0) {
        createFeedItem({
          recipientUserIds: familyUserIds,
          eventType: NOTIFICATION_EVENTS.ALERT_FIRED,
          eventId: alert.id,
          title: 'SOS Alert Triggered',
          body: `Emergency SOS alert raised by ${req.user.full_name || 'Elderly user'}`,
          data: { screen: 'AlertDetails', params: { id: alert.id } },
          sendPush: false,
        });
      }
    })
    .catch((err) => console.error('Feed error SOS alert family:', err));

  createFeedItem({
    recipientUserIds: [req.user.id],
    eventType: NOTIFICATION_EVENTS.ALERT_FIRED,
    eventId: alert.id,
    title: 'SOS Alert Activated',
    body: 'Your emergency SOS alert was activated and family contacts have been notified.',
    data: { screen: 'AlertDetails', params: { id: alert.id } },
    sendPush: false,
  });

  res.status(201).json({ status: 'ok', alert: toPublicAlert(alert) });
});

// ---------------------------------------------------------------------------
// POST /emergency/alerts/fall (and POST /emergency/fall)
// ---------------------------------------------------------------------------
const handleFallAlert = async (req, res) => {
  let location = null;
  let message = null;

  if (req.body && typeof req.body === 'object') {
    location = validateSosAlertBody(req.body);
    if (typeof req.body.message === 'string' && req.body.message.trim()) {
      message = req.body.message.trim();
    }
  }

  const existing = await findActiveFallAlert(req.user.id);
  if (existing) {
    throw conflict('fall_already_active', 'A fall alert is already active for this account.', {
      alert: toPublicAlert(existing),
    });
  }

  const alert = await createFallAlert(req.user.id, location, message);

  advanceFanout(alert.id).catch((err) =>
    console.error(`Initial fanout failed for fall alert ${alert.id}:`, err)
  );

  listLinksForElderly(req.user.id, 'active')
    .then((links) => {
      const familyUserIds = links.map((l) => l.family_user_id);
      if (familyUserIds.length > 0) {
        createFeedItem({
          recipientUserIds: familyUserIds,
          eventType: NOTIFICATION_EVENTS.ALERT_FIRED,
          eventId: alert.id,
          title: 'Fall Detected',
          body: `Fall alert detected for ${req.user.full_name || 'Elderly user'}`,
          data: { screen: 'AlertDetails', params: { id: alert.id } },
          sendPush: false,
        });
      }
    })
    .catch((err) => console.error('Feed error fall alert family:', err));

  createFeedItem({
    recipientUserIds: [req.user.id],
    eventType: NOTIFICATION_EVENTS.ALERT_FIRED,
    eventId: alert.id,
    title: 'Fall Alert Recorded',
    body: 'Fall alert was logged and emergency contacts notified.',
    data: { screen: 'AlertDetails', params: { id: alert.id } },
    sendPush: false,
  });

  res.status(201).json({ status: 'ok', alert: toPublicAlert(alert) });
};

emergencyRouter.post('/alerts/fall', requireAuth, handleFallAlert);
emergencyRouter.post('/fall', requireAuth, handleFallAlert);

// ---------------------------------------------------------------------------
// GET /emergency/alerts
// ---------------------------------------------------------------------------

emergencyRouter.get('/alerts', requireAuth, async (req, res) => {
  const { status, limit } = validateListQuery(req.query);
  const alerts = await listAlertsForUser(req.user.id, { status, limit });

  res.json({ status: 'ok', count: alerts.length, alerts: alerts.map(toPublicAlert) });
});

// ---------------------------------------------------------------------------
// GET /emergency/admin/alerts — platform-wide alert overview
// ---------------------------------------------------------------------------

emergencyRouter.get('/admin/alerts', requireAuth, requireRole('admin'), async (req, res) => {
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
// GET /emergency/admin/alerts/:id — single alert detail
// ---------------------------------------------------------------------------

emergencyRouter.get('/admin/alerts/:id', requireAuth, requireRole('admin'), async (req, res) => {
  validateUuid(req.params.id, 'alertId');
  const alert = await findAlertForAdmin(req.params.id);

  if (!alert) {
    throw notFound('alert_not_found', 'No alert with that id.');
  }

  res.json({ status: 'ok', alert });
});


// ---------------------------------------------------------------------------
// POST /emergency/alerts/:id/cancel — owner only
// ---------------------------------------------------------------------------

emergencyRouter.post('/alerts/:id/cancel', requireAuth, async (req, res) => {
  const id = requireAlertId(req);
  const { note } = validateCloseAlertBody(req.body);

  const alert = await findAlertById(id);
  if (!alert) throw notFound('alert_not_found', 'No alert with that id.');

  // Only the person who pressed SOS can say it was a mistake. A family
  // member who thinks it's a false alarm uses resolve, not cancel — that
  // distinction is deliberate, see BUILD_LOG.md.
  if (alert.user_id !== req.user.id) {
    throw forbidden('not_alert_owner', 'Only the person who triggered this alert can cancel it.');
  }

  const updated = await cancelAlert(id, req.user.id, note);
  if (!updated) {
    throw conflict('alert_not_active', 'This alert is no longer active.');
  }

  listLinksForElderly(alert.user_id, 'active')
    .then((links) => {
      const familyUserIds = links.map((l) => l.family_user_id).filter((uId) => uId !== req.user.id);
      if (familyUserIds.length > 0) {
        createFeedItem({
          recipientUserIds: familyUserIds,
          eventType: NOTIFICATION_EVENTS.ALERT_CANCELLED,
          eventId: alert.id,
          title: 'Alert Cancelled',
          body: `Emergency alert was cancelled by ${req.user.full_name || 'user'}`,
          data: { screen: 'AlertDetails', params: { id: alert.id } },
          sendPush: true,
        });
      }
    })
    .catch((err) => console.error('Feed error cancel alert:', err));

  res.json({ status: 'ok', alert: toPublicAlert(updated) });
});

// ---------------------------------------------------------------------------
// POST /emergency/alerts/:id/resolve — owner or a permitted family member
// ---------------------------------------------------------------------------

emergencyRouter.post('/alerts/:id/resolve', requireAuth, async (req, res) => {
  const id = requireAlertId(req);
  const { note } = validateCloseAlertBody(req.body);

  const alert = await findAlertById(id);
  if (!alert) throw notFound('alert_not_found', 'No alert with that id.');

  if (alert.user_id !== req.user.id) {
    const link = await findFamilyLink(req.user.id, alert.user_id);
    const permitted = link && link.status === 'active' && link.can_acknowledge_alerts;

    if (!permitted) {
      throw forbidden(
        'not_permitted',
        'You are not permitted to resolve alerts for this person.'
      );
    }
  }

  const updated = await resolveAlert(id, req.user.id, note);
  if (!updated) {
    throw conflict('alert_not_active', 'This alert is no longer active.');
  }

  listLinksForElderly(alert.user_id, 'active')
    .then((links) => {
      const allStakeholders = [alert.user_id, ...links.map((l) => l.family_user_id)];
      const recipients = allStakeholders.filter((uId) => uId !== req.user.id);
      if (recipients.length > 0) {
        createFeedItem({
          recipientUserIds: recipients,
          eventType: NOTIFICATION_EVENTS.ALERT_RESOLVED,
          eventId: alert.id,
          title: 'Alert Resolved',
          body: `Emergency alert was resolved by ${req.user.full_name || 'user'}`,
          data: { screen: 'AlertDetails', params: { id: alert.id } },
          sendPush: true,
        });
      }
    })
    .catch((err) => console.error('Feed error resolve alert:', err));

  res.json({ status: 'ok', alert: toPublicAlert(updated) });
});

// ---------------------------------------------------------------------------
// POST /emergency/alerts/:id/acknowledge — a permitted family member only.
// Does not close the alert; stops it from escalating further.
// ---------------------------------------------------------------------------

emergencyRouter.post('/alerts/:id/acknowledge', requireAuth, async (req, res) => {
  const id = requireAlertId(req);

  const alert = await findAlertById(id);
  if (!alert) throw notFound('alert_not_found', 'No alert with that id.');

  // No owner branch here on purpose: chk_not_self in the schema means a
  // family_links row from someone to themselves can never exist, so the
  // owner is automatically excluded by this same check, not a special case.
  const link = await findFamilyLink(req.user.id, alert.user_id);
  const permitted = link && link.status === 'active' && link.can_acknowledge_alerts;
  if (!permitted) {
    throw forbidden('not_permitted', 'You are not permitted to acknowledge alerts for this person.');
  }

  const updated = await acknowledgeAlert(id, req.user.id);
  if (!updated) {
    // Re-read rather than trust the copy fetched above, which may now be
    // stale — distinguishes "already closed" from "someone else got there
    // first" for the error the app shows.
    const current = await findAlertById(id);
    if (current.status !== 'active') {
      throw conflict('alert_not_active', 'This alert is no longer active.');
    }
    throw conflict('alert_already_acknowledged', 'This alert has already been acknowledged.', {
      alert: toPublicAlert(current),
    });
  }

  listLinksForElderly(alert.user_id, 'active')
    .then((links) => {
      const allStakeholders = [alert.user_id, ...links.map((l) => l.family_user_id)];
      const recipients = allStakeholders.filter((uId) => uId !== req.user.id);
      if (recipients.length > 0) {
        createFeedItem({
          recipientUserIds: recipients,
          eventType: NOTIFICATION_EVENTS.ALERT_ACKNOWLEDGED,
          eventId: alert.id,
          title: 'Alert Acknowledged',
          body: `Emergency alert acknowledged by ${req.user.full_name || 'family member'}`,
          data: { screen: 'AlertDetails', params: { id: alert.id } },
          sendPush: true,
        });
      }
    })
    .catch((err) => console.error('Feed error acknowledge alert:', err));

  res.json({ status: 'ok', alert: toPublicAlert(updated) });
});

// ---------------------------------------------------------------------------
// PATCH /emergency/alerts/:id/location — owner only, any status.
//
// Phase 1 step 4: the SOS-time capture keeps trying for a fresh fix past the
// 4.5s send deadline (see ElderlyHomeScreen's SOS_LOCATION_ASYNC_CEILING_MS).
// When one lands, this is how it reaches the alert already sent. Deliberately
// not restricted to status = 'active' — a fix landing after the alert was
// cancelled or resolved is still attached, so the record isn't stuck on "no
// location" or an approximate reading just because the timing lost a race.
// ---------------------------------------------------------------------------

emergencyRouter.patch('/alerts/:id/location', requireAuth, async (req, res) => {
  const id = requireAlertId(req);
  const location = validateAttachLocationBody(req.body);

  const alert = await findAlertById(id);
  if (!alert) throw notFound('alert_not_found', 'No alert with that id.');

  if (alert.user_id !== req.user.id) {
    throw forbidden('not_alert_owner', 'Only the person who triggered this alert can attach a location to it.');
  }

  const updated = await attachAlertLocation(id, location);
  res.json({ status: 'ok', alert: toPublicAlert(updated) });
});

// ---------------------------------------------------------------------------
// GET /emergency/family/alerts — family role only
// ---------------------------------------------------------------------------

emergencyRouter.get('/family/alerts', requireAuth, requireRole('family'), async (req, res) => {
  const alerts = await listActiveFamilyAlerts(req.user.id);
  res.json({ status: 'ok', count: alerts.length, alerts });
});

// ---------------------------------------------------------------------------
// GET /emergency/family/alerts/history — family role only
// ---------------------------------------------------------------------------

emergencyRouter.get(
  '/family/alerts/history',
  requireAuth,
  requireRole('family'),
  async (req, res) => {
    const { limit } = validateHistoryQuery(req.query);
    const alerts = await listFamilyAlertHistory(req.user.id, { limit });
    res.json({ status: 'ok', count: alerts.length, alerts });
  }
);

// ---------------------------------------------------------------------------
// POST /emergency/locations — no role check, same reasoning as POST /alerts:
// scoped to the caller's own user_id, restricted by UI, not by role here.
// ---------------------------------------------------------------------------

emergencyRouter.post('/locations', requireAuth, async (req, res) => {
  const location = validateCreateLocationBody(req.body);
  const row = await createLocation(req.user.id, location);

  // row is undefined when ON CONFLICT DO NOTHING silently dropped a duplicate
  // reading (same user_id + recorded_at, most often a queued retry resending
  // something already written) — that is a successful no-op, not an error,
  // so the client's queue must still see a 2xx and drop the item.
  if (!row) {
    res.status(200).json({ status: 'ok', location: null, deduplicated: true });
    return;
  }

  // Fire-and-forget, same "never a precondition" principle as SOS fanout —
  // evaluating geofences must never delay the response to a routine location
  // write. See geofenceCheck.js for how a breach or return gets detected.
  checkGeofences(req.user.id, row).catch((err) =>
    console.error(`Geofence check failed for user ${req.user.id}:`, err)
  );

  res.status(201).json({ status: 'ok', location: toPublicLocation(row) });
});

// ---------------------------------------------------------------------------
// GET /emergency/locations/latest — the elderly user, or a family member with
// an active link and can_view_location = true. Phase 3 step 3's "use their
// last known location" zone-centre flow (see GeofenceFormScreen): a family
// member's own device position is never a stand-in for the elderly user's,
// so this reads the elderly user's most recent stored reading instead of
// anything captured on the caller's own phone.
// ---------------------------------------------------------------------------

emergencyRouter.get('/locations/latest', requireAuth, async (req, res) => {
  const { elderlyUserId } = validateGeofenceListQuery(req.query);

  requireElderlyUserId(req, elderlyUserId);
  const userId = req.user.role === 'elderly' ? req.user.id : elderlyUserId;

  await requireLocationViewPermission(req, userId);

  const row = await findLatestLocation(userId);
  res.json({ status: 'ok', location: row ? toPublicLocation(row) : null });
});

// ---------------------------------------------------------------------------
// POST /emergency/device-tokens — no role check, same reasoning as the two
// endpoints above: scoped to the caller's own account.
// ---------------------------------------------------------------------------

emergencyRouter.post('/device-tokens', requireAuth, async (req, res) => {
  const deviceToken = validateRegisterDeviceTokenBody(req.body);
  const row = await registerDeviceToken(req.user.id, deviceToken);
  res.status(201).json({ status: 'ok', deviceToken: row });
});

// ---------------------------------------------------------------------------
// DELETE /emergency/device-tokens — deactivate this device's push token on logout.
// Scoped strictly to (expoPushToken, req.user.id) so a caller cannot deactivate
// tokens belonging to other users or other devices.
// ---------------------------------------------------------------------------

emergencyRouter.delete('/device-tokens', requireAuth, async (req, res) => {
  const { expoPushToken } = validateDeactivateDeviceTokenBody(req.body);
  const deactivated = await deactivateDeviceTokenForUser(req.user.id, expoPushToken);
  res.json({ status: 'ok', deactivated });
});

// ---------------------------------------------------------------------------
// Emergency contacts — hand-entered contact list.
//
// Permitted throughout: the owning elderly user, or a family member with an
// active family_links row to them and can_manage_contacts = true (see
// hasManageContactsPermission, family/links.js). contact_user_id is always
// null for a contact created here — a neighbour or doctor with no account is
// the normal case. Escalating a linked family member to contact status is a
// separate, deliberate action: POST /family/links/:id/emergency-contact
// (family/routes.js), not this endpoint.
// ---------------------------------------------------------------------------

async function requireContactManagePermission(req, elderlyUserId) {
  const permitted = await hasManageContactsPermission(req.user.id, elderlyUserId);
  if (!permitted) {
    throw forbidden('not_permitted', 'You are not permitted to manage contacts for this account.');
  }
}

function requireElderlyUserId(req, elderlyUserId) {
  if (req.user.role !== 'elderly' && !elderlyUserId) {
    throw badRequest('validation_failed', 'One or more fields are invalid.', {
      details: [{ field: 'elderlyUserId', message: 'Required when the caller is not the elderly user themselves.' }],
    });
  }
}

emergencyRouter.post('/contacts', requireAuth, async (req, res) => {
  const input = validateCreateContactBody(req.body);

  requireElderlyUserId(req, input.elderlyUserId);
  const userId = req.user.role === 'elderly' ? req.user.id : input.elderlyUserId;

  await requireContactManagePermission(req, userId);

  const priority = input.priority ?? (await nextContactPriority(userId));

  let contact;
  try {
    contact = await createContact({ userId, ...input, priority });
  } catch (err) {
    // Relying on the constraint as the real backstop, same reasoning as
    // /auth/register: two simultaneous creates for the same phone would both
    // pass a pre-check and one must still fail here.
    if (err.code === PG_UNIQUE_VIOLATION) {
      throw conflict('contact_already_exists', 'A contact with this phone number already exists for this account.');
    }
    throw err;
  }

  res.status(201).json({ status: 'ok', contact: toPublicContact(contact) });
});

emergencyRouter.get('/contacts', requireAuth, async (req, res) => {
  const { elderlyUserId } = validateContactsListQuery(req.query);

  requireElderlyUserId(req, elderlyUserId);
  const userId = req.user.role === 'elderly' ? req.user.id : elderlyUserId;

  await requireContactManagePermission(req, userId);

  const contacts = await listContactsForUser(userId);
  res.json({ status: 'ok', count: contacts.length, contacts: contacts.map(toPublicContact) });
});

emergencyRouter.patch('/contacts/:id', requireAuth, async (req, res) => {
  const id = requireContactId(req);
  const patch = validateUpdateContactBody(req.body);

  const existing = await findContactById(id);
  if (!existing || !existing.is_active) throw notFound('contact_not_found', 'No contact with that id.');

  await requireContactManagePermission(req, existing.user_id);

  let updated;
  try {
    updated = await updateContact(id, patch);
  } catch (err) {
    if (err.code === PG_UNIQUE_VIOLATION) {
      throw conflict('contact_already_exists', 'A contact with this phone number already exists for this account.');
    }
    throw err;
  }

  res.json({ status: 'ok', contact: toPublicContact(updated) });
});

emergencyRouter.delete('/contacts/:id', requireAuth, async (req, res) => {
  const id = requireContactId(req);

  const existing = await findContactById(id);
  if (!existing || !existing.is_active) throw notFound('contact_not_found', 'No contact with that id.');

  await requireContactManagePermission(req, existing.user_id);

  const updated = await deactivateContact(id);
  res.json({ status: 'ok', contact: toPublicContact(updated) });
});

// ---------------------------------------------------------------------------
// Geofences — safe zones (or restricted zones) around a point. Phase 3 step
// 3. A breach is a real alerts row (alert_type = 'geofence_breach'), created
// by geofenceCheck.js from inside POST /locations above, not by anything
// here — these four routes only manage the zone definitions themselves.
//
// Read: the owning elderly user, or a family member with an active link and
// can_view_location = true. Write (create/edit/delete): the same, plus
// permission_level 'manage' or 'owner' — see hasManageGeofencesPermission,
// family/links.js. The elderly user can see who holds that tier via GET
// /family/links, and step it back down via PATCH /family/links/:id
// (family/routes.js) without revoking the whole relationship.
// ---------------------------------------------------------------------------

async function requireGeofenceViewPermission(req, elderlyUserId) {
  const permitted = await hasViewLocationPermission(req.user.id, elderlyUserId);
  if (!permitted) {
    throw forbidden('not_permitted', 'You are not permitted to view safe zones for this account.');
  }
}

async function requireLocationViewPermission(req, elderlyUserId) {
  const permitted = await hasViewLocationPermission(req.user.id, elderlyUserId);
  if (!permitted) {
    throw forbidden('not_permitted', 'You are not permitted to view location data for this account.');
  }
}

async function requireGeofenceManagePermission(req, elderlyUserId) {
  const permitted = await hasManageGeofencesPermission(req.user.id, elderlyUserId);
  if (!permitted) {
    throw forbidden('not_permitted', 'You are not permitted to manage safe zones for this account.');
  }
}

emergencyRouter.post('/geofences', requireAuth, async (req, res) => {
  const input = validateCreateGeofenceBody(req.body);

  requireElderlyUserId(req, input.elderlyUserId);
  const userId = req.user.role === 'elderly' ? req.user.id : input.elderlyUserId;

  await requireGeofenceManagePermission(req, userId);

  const geofence = await createGeofence({ userId, ...input, createdBy: req.user.id });
  res.status(201).json({ status: 'ok', geofence: toPublicGeofence(geofence) });
});

emergencyRouter.get('/geofences', requireAuth, async (req, res) => {
  const { elderlyUserId } = validateGeofenceListQuery(req.query);

  requireElderlyUserId(req, elderlyUserId);
  const userId = req.user.role === 'elderly' ? req.user.id : elderlyUserId;

  await requireGeofenceViewPermission(req, userId);

  const geofences = await listGeofencesForUser(userId);
  res.json({ status: 'ok', count: geofences.length, geofences: geofences.map(toPublicGeofence) });
});

emergencyRouter.patch('/geofences/:id', requireAuth, async (req, res) => {
  const id = requireGeofenceId(req);
  const patch = validateUpdateGeofenceBody(req.body);

  const existing = await findGeofenceById(id);
  if (!existing || !existing.is_active) throw notFound('geofence_not_found', 'No safe zone with that id.');

  await requireGeofenceManagePermission(req, existing.user_id);

  const updated = await updateGeofence(id, patch);
  res.json({ status: 'ok', geofence: toPublicGeofence(updated) });
});

emergencyRouter.delete('/geofences/:id', requireAuth, async (req, res) => {
  const id = requireGeofenceId(req);

  const existing = await findGeofenceById(id);
  if (!existing || !existing.is_active) throw notFound('geofence_not_found', 'No safe zone with that id.');

  await requireGeofenceManagePermission(req, existing.user_id);

  const updated = await deactivateGeofence(id);
  res.json({ status: 'ok', geofence: toPublicGeofence(updated) });
});

// ---------------------------------------------------------------------------
// GET /emergency/geofences/:id/history — same read permission as the zone
// itself. Aggregates recent `locations` rows against this zone's circle
// server-side rather than returning the raw trail: the caller needs "have
// they been inside this zone lately," not a location-by-location export.
// Feeds the sanity-check panel shown right after a zone is created (and
// reachable later from the zone's card) — see GeofenceFormScreen/BUILD_LOG.md.
// ---------------------------------------------------------------------------

emergencyRouter.get('/geofences/:id/history', requireAuth, async (req, res) => {
  const id = requireGeofenceId(req);
  const { days } = validateGeofenceHistoryQuery(req.query);

  const existing = await findGeofenceById(id);
  if (!existing || !existing.is_active) throw notFound('geofence_not_found', 'No safe zone with that id.');

  await requireGeofenceViewPermission(req, existing.user_id);

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const readings = await listLocationsSince(existing.user_id, since);

  const centerLat = Number(existing.center_latitude);
  const centerLon = Number(existing.center_longitude);
  const radius = existing.radius_meters;
  const sampleCount = readings.length;

  let insideCount = 0;
  let currentlyInside = null;
  for (const reading of readings) {
    const distance = haversineMeters(Number(reading.latitude), Number(reading.longitude), centerLat, centerLon);
    currentlyInside = classify(distance, radius) === 'inside';
    if (currentlyInside) insideCount += 1;
  }

  res.json({
    status: 'ok',
    history: {
      days,
      sampleCount,
      insideCount,
      percentInside: sampleCount > 0 ? Math.round((insideCount / sampleCount) * 100) : null,
      currentlyInside,
      oldestSampleAt: sampleCount > 0 ? readings[0].recorded_at : null,
      newestSampleAt: sampleCount > 0 ? readings[sampleCount - 1].recorded_at : null,
    },
  });
});
