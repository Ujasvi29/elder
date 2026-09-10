// ============================================================================
// Alerts — database access
//
// Every query for the `alerts` table used by Phase 1 step 1 (the SOS button)
// lives here, same split as shared/auth/users.js: routes.js decides what is
// allowed, this file only knows how to read and write rows.
// ============================================================================

import { query } from '../shared/db/pool.js';

// An SOS is the most urgent thing this product records, so it does not wait
// for a caller to say how severe it is — 'critical' is not a default so much
// as the definition of what this button means.
const SOS_SEVERITY = 'critical';

// How far back "recent alerts" looks on the family dashboard. Fixed, not
// caller-configurable — see BUILD_LOG.md for why.
const HISTORY_WINDOW_DAYS = 7;

/** Shapes a raw `alerts` row into the camelCase form the API returns. */
export function toPublicAlert(row) {
  return {
    id: row.id,
    userId: row.user_id,
    alertType: row.alert_type,
    status: row.status,
    severity: row.severity,
    latitude: row.latitude,
    longitude: row.longitude,
    locationAccuracyMeters: row.location_accuracy_meters,
    locationIsApproximate: row.location_is_approximate,
    locationCapturedAt: row.location_captured_at,
    message: row.message,
    triggeredAt: row.triggered_at,
    acknowledgedAt: row.acknowledged_at,
    acknowledgedBy: row.acknowledged_by,
    resolvedAt: row.resolved_at,
    resolvedBy: row.resolved_by,
    resolutionNotes: row.resolution_notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** The caller's own currently-active SOS alert, if there is one. */
export async function findActiveSosAlert(userId) {
  const { rows } = await query(
    `SELECT * FROM alerts
      WHERE user_id = $1 AND alert_type = 'sos' AND status = 'active'
      ORDER BY triggered_at DESC
      LIMIT 1`,
    [userId]
  );
  return rows[0] ?? null;
}

/**
 * Creates a new SOS alert. Does not check for an existing active one — that
 * is a business rule, decided by the caller in routes.js, not a fact about
 * how to write a row.
 *
 * `location` is best-effort and optional — captured on the device at press
 * time, but an SOS must fire whether or not a GPS fix was available. Written
 * directly onto the alert's own latitude/longitude, not a linked `locations`
 * row: nothing reads `location_id` today, and this is the copy that has to
 * outlive the 30-day location purge anyway. See BUILD_LOG.md.
 *
 * `location.isApproximate` (Phase 1 step 4) is true only when the device sent
 * a getLastKnownPositionAsync floor value because no fresh fix landed within
 * SOS_LOCATION_TIMEOUT_MS — see attachAlertLocation for the fresh fix that
 * may arrive afterward and clear it.
 */
export async function createSosAlert(userId, location) {
  const { rows } = await query(
    `INSERT INTO alerts (
       user_id, alert_type, status, severity, triggered_at,
       latitude, longitude, location_accuracy_meters, location_is_approximate, location_captured_at
     )
     VALUES ($1, 'sos', 'active', $2, now(), $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      userId,
      SOS_SEVERITY,
      location?.latitude ?? null,
      location?.longitude ?? null,
      location?.accuracyMeters ?? null,
      location?.isApproximate ?? false,
      location?.capturedAt ?? null,
    ]
  );
  return rows[0];
}

/**
 * Attaches a fresh location fix to an already-created alert — Phase 1 step 4.
 * Unlike cancel/resolve/acknowledge, this is not gated to status = 'active':
 * a fix that lands after the alert was cancelled or resolved is still
 * accepted, for the record — the family may already be looking at "no
 * location" or an approximate one and a real reading arriving late is still
 * worth showing. Always clears location_is_approximate to false: this path
 * only ever carries a fresh fix, never another last-known read.
 */
export async function attachAlertLocation(id, location) {
  const { rows } = await query(
    `UPDATE alerts
        SET latitude = $2,
            longitude = $3,
            location_accuracy_meters = $4,
            location_is_approximate = FALSE,
            location_captured_at = $5
      WHERE id = $1
      RETURNING *`,
    [id, location.latitude, location.longitude, location.accuracyMeters ?? null, location.capturedAt ?? null]
  );
  return rows[0] ?? null;
}

/** The caller's own currently-active fall alert, if there is one. */
export async function findActiveFallAlert(userId) {
  const { rows } = await query(
    `SELECT * FROM alerts
      WHERE user_id = $1 AND alert_type = 'fall' AND status = 'active'
      ORDER BY triggered_at DESC
      LIMIT 1`,
    [userId]
  );
  return rows[0] ?? null;
}

/**
 * Creates a new manual Fall Alert ('fall').
 */
export async function createFallAlert(userId, location, message) {
  const { rows } = await query(
    `INSERT INTO alerts (user_id, alert_type, status, severity, message, triggered_at, latitude, longitude)
     VALUES ($1, 'fall', 'active', 'high', $2, now(), $3, $4)
     RETURNING *`,
    [
      userId,
      message || 'Fall alert: user reported that they have fallen and may need assistance.',
      location?.latitude ?? null,
      location?.longitude ?? null,
    ]
  );
  return rows[0];
}

// Fall is 'high'; SOS is 'critical' and only the SOS button itself ever
// writes that. A geofence breach sits at the same tier as a fall — real and
// worth a full contact escalation, but not the button-press-level urgency
// SOS means.
const GEOFENCE_BREACH_SEVERITY = 'high';

/**
 * Creates a geofence-breach alert. `direction` ('exit' or 'enter') is folded
 * straight into `message` for the notification templates and the dashboard
 * rather than a new column — geofenceCheck.js is the only caller, and it
 * already knows which direction fired; nothing else needs to ask "which
 * direction" as a separate query later.
 */
export async function createGeofenceAlert(userId, geofenceId, direction, geofenceName, location) {
  const message =
    direction === 'exit' ? `Left the safe zone "${geofenceName}".` : `Entered the zone "${geofenceName}".`;

  const { rows } = await query(
    `INSERT INTO alerts (
       user_id, alert_type, status, severity, geofence_id, message, triggered_at,
       latitude, longitude, location_accuracy_meters
     )
     VALUES ($1, 'geofence_breach', 'active', $2, $3, $4, now(), $5, $6, $7)
     RETURNING *`,
    [
      userId,
      GEOFENCE_BREACH_SEVERITY,
      geofenceId,
      message,
      location.latitude,
      location.longitude,
      location.accuracyMeters ?? null,
    ]
  );
  return rows[0];
}

/**
 * Auto-resolve on return — the system, not a person, closes the loop once
 * the elderly user is back where a still-active geofence_breach alert says
 * they shouldn't be. `resolved_by` stays NULL: it references `users`, there
 * is no "system" row to point at, and NULL already reads correctly here —
 * nobody had to act for this to close. Matches on `geofence_id` and status
 * alone, same atomic-update-as-guard shape as closeActiveAlert above: at
 * most one active geofence_breach alert should exist per zone at a time, so
 * there is nothing to disambiguate by picking "the latest" one.
 */
export async function autoResolveGeofenceAlert(geofenceId) {
  const { rows } = await query(
    `UPDATE alerts
        SET status = 'resolved',
            resolved_at = now(),
            resolution_notes = 'Returned to the zone — resolved automatically.'
      WHERE geofence_id = $1 AND alert_type = 'geofence_breach' AND status = 'active'
      RETURNING *`,
    [geofenceId]
  );
  return rows[0] ?? null;
}

/** The caller's own alerts, newest first. */
export async function listAlertsForUser(userId, { status, limit }) {
  if (status) {
    const { rows } = await query(
      `SELECT * FROM alerts
        WHERE user_id = $1 AND status = $2
        ORDER BY triggered_at DESC
        LIMIT $3`,
      [userId, status, limit]
    );
    return rows;
  }

  const { rows } = await query(
    `SELECT * FROM alerts
      WHERE user_id = $1
      ORDER BY triggered_at DESC
      LIMIT $2`,
    [userId, limit]
  );
  return rows;
}

export async function findAlertById(id) {
  const { rows } = await query(`SELECT * FROM alerts WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

/**
 * Moves an active alert to 'cancelled' or 'resolved'. Only ever touches a row
 * that is still 'active' — the WHERE clause is the guard against acting on an
 * alert someone already closed, done as one atomic statement rather than a
 * read-then-write so two simultaneous requests cannot both succeed.
 *
 * Returns null if there was nothing active with that id to update, which the
 * caller uses to distinguish "no such alert" from "already closed".
 */
async function closeActiveAlert(id, status, actorUserId, note) {
  const { rows } = await query(
    `UPDATE alerts
        SET status = $2,
            resolved_at = now(),
            resolved_by = $3,
            resolution_notes = COALESCE($4, resolution_notes)
      WHERE id = $1 AND status = 'active'
      RETURNING *`,
    [id, status, actorUserId, note ?? null]
  );
  return rows[0] ?? null;
}

/** "That was a mistake" — only the person who triggered the alert calls this. */
export function cancelAlert(id, actorUserId, note) {
  return closeActiveAlert(id, 'cancelled', actorUserId, note);
}

/** "This is handled/over" — the owner or a permitted family member. */
export function resolveAlert(id, actorUserId, note) {
  return closeActiveAlert(id, 'resolved', actorUserId, note);
}

/**
 * "I've seen this and I'm responding" — a permitted family member only (see
 * routes.js; the alert's own owner can never have a family_links row to
 * themselves, so this naturally excludes them without a special case).
 *
 * Does not close the alert — status stays 'active'. Acknowledging and
 * closing are different facts: acknowledging stops escalation (see
 * notifications/records.js's findAlertsDueForEscalation, which filters on
 * acknowledged_at IS NULL); only cancel or resolve actually end the alert. A
 * family member acknowledging is not the same claim as them resolving it.
 *
 * Only ever touches a row that is still active and not yet acknowledged, for
 * the same reason cancel/resolve only touch 'active' rows — one atomic
 * statement so two family members acknowledging at once can only ever have
 * one winner.
 */
export async function acknowledgeAlert(id, actorUserId) {
  const { rows } = await query(
    `UPDATE alerts
        SET acknowledged_at = now(),
            acknowledged_by = $2
      WHERE id = $1 AND status = 'active' AND acknowledged_at IS NULL
      RETURNING *`,
    [id, actorUserId]
  );
  return rows[0] ?? null;
}

/**
 * The family_links row between a family member and an elderly user, or null
 * if none exists. routes.js uses this to decide both whether an alert may be
 * shown at all (link must be 'active') and whether it may be resolved
 * (can_acknowledge_alerts must be true).
 */
export async function findFamilyLink(familyUserId, elderlyUserId) {
  const { rows } = await query(
    `SELECT status, can_acknowledge_alerts
       FROM family_links
      WHERE family_user_id = $1 AND elderly_user_id = $2`,
    [familyUserId, elderlyUserId]
  );
  return rows[0] ?? null;
}

/**
 * Redacts coordinates when the viewer's family_links row doesn't grant
 * can_view_location — enforced here, in the query layer, not left to the
 * screen to hide. canAcknowledge already works this way for a different
 * permission; this is the same pattern for a different flag.
 */
function withLocationGate(publicAlert, canViewLocation) {
  return {
    ...publicAlert,
    latitude: canViewLocation ? publicAlert.latitude : null,
    longitude: canViewLocation ? publicAlert.longitude : null,
    locationAccuracyMeters: canViewLocation ? publicAlert.locationAccuracyMeters : null,
    locationIsApproximate: canViewLocation ? publicAlert.locationIsApproximate : null,
    locationCapturedAt: canViewLocation ? publicAlert.locationCapturedAt : null,
    canViewLocation,
  };
}

/**
 * Active alerts for every elderly user linked to this family member with an
 * 'active' family_links row. can_acknowledge_alerts is not filtered here —
 * decision (B): a view-only family member still sees that an emergency is
 * happening, they just cannot act on it. Each row carries canAcknowledge so
 * the screen knows whether to offer the "mark resolved" button.
 */
export async function listActiveFamilyAlerts(familyUserId) {
  const { rows } = await query(
    `SELECT a.*,
            u.full_name AS elderly_full_name,
            u.phone AS elderly_phone,
            ack.full_name AS acknowledged_by_name,
            fl.can_acknowledge_alerts,
            fl.can_view_location
       FROM alerts a
       JOIN family_links fl ON fl.elderly_user_id = a.user_id
       JOIN users u ON u.id = a.user_id
       LEFT JOIN users ack ON ack.id = a.acknowledged_by
      WHERE fl.family_user_id = $1
        AND fl.status = 'active'
        AND a.status = 'active'
      ORDER BY a.triggered_at DESC`,
    [familyUserId]
  );

  return rows.map((row) =>
    withLocationGate(
      {
        ...toPublicAlert(row),
        elderlyUser: { fullName: row.elderly_full_name, phone: row.elderly_phone },
        acknowledgedByName: row.acknowledged_by_name,
        canAcknowledge: row.can_acknowledge_alerts,
      },
      row.can_view_location
    )
  );
}

/**
 * Resolved/cancelled alerts from the last `windowDays` for every elderly user
 * linked to this family member with an 'active' family_links row — same
 * gating as listActiveFamilyAlerts, including the view-only-still-sees
 * decision. This is the trail an active alert leaves once it's closed, so a
 * cancelled SOS doesn't just vanish with no record for the family.
 *
 * resolved_by identifies who closed it, but not what relationship they have
 * to the alert — cancel is always the alert owner, resolve can be the owner
 * or a family member. resolvedByIsSelf (resolved_by === the alert's own
 * user_id) is what lets the screen say "resolved by them" vs "resolved by
 * family" rather than just repeating a name with no context.
 */
export async function listFamilyAlertHistory(familyUserId, { limit }) {
  const { rows } = await query(
    `SELECT a.*,
            u.full_name AS elderly_full_name,
            u.phone AS elderly_phone,
            r.full_name AS resolved_by_name,
            fl.can_view_location
       FROM alerts a
       JOIN family_links fl ON fl.elderly_user_id = a.user_id
       JOIN users u ON u.id = a.user_id
       LEFT JOIN users r ON r.id = a.resolved_by
      WHERE fl.family_user_id = $1
        AND fl.status = 'active'
        AND a.status IN ('resolved', 'cancelled')
        AND a.triggered_at >= now() - make_interval(days => $2)
      ORDER BY a.triggered_at DESC
      LIMIT $3`,
    [familyUserId, HISTORY_WINDOW_DAYS, limit]
  );

  return rows.map((row) =>
    withLocationGate(
      {
        ...toPublicAlert(row),
        elderlyUser: { fullName: row.elderly_full_name, phone: row.elderly_phone },
        resolvedByName: row.resolved_by_name,
        resolvedByIsSelf: row.resolved_by === row.user_id,
      },
      row.can_view_location
    )
  );
}

/**
 * Platform-wide alert listing for the admin dashboard.
 * Queries cross-user with optional status, type, severity filtering and pagination.
 */
export async function listAllAlerts({ status, type, severity, page = 1, limit = 25 } = {}) {
  const conditions = [];
  const params = [];

  if (status) {
    params.push(status);
    conditions.push(`a.status = $${params.length}`);
  }

  if (type) {
    params.push(type);
    conditions.push(`a.alert_type = $${params.length}`);
  }

  if (severity) {
    params.push(severity);
    conditions.push(`a.severity = $${params.length}`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const parsedPage = Math.max(1, parseInt(page, 10) || 1);
  const parsedLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 25));
  const offset = (parsedPage - 1) * parsedLimit;

  const countSql = `SELECT COUNT(*) AS total FROM alerts a ${whereClause}`;
  const { rows: countRows } = await query(countSql, params);
  const total = parseInt(countRows[0]?.total || 0, 10);

  params.push(parsedLimit);
  const limitParam = params.length;
  params.push(offset);
  const offsetParam = params.length;

  const dataSql = `
    SELECT a.*,
           u.full_name AS user_full_name,
           u.phone AS user_phone,
           u.role AS user_role,
           ack.full_name AS acknowledged_by_name,
           res.full_name AS resolved_by_name
      FROM alerts a
      JOIN users u ON u.id = a.user_id
      LEFT JOIN users ack ON ack.id = a.acknowledged_by
      LEFT JOIN users res ON res.id = a.resolved_by
    ${whereClause}
    ORDER BY a.triggered_at DESC
    LIMIT $${limitParam} OFFSET $${offsetParam}
  `;

  const { rows } = await query(dataSql, params);

  return {
    total,
    page: parsedPage,
    limit: parsedLimit,
    alerts: rows.map((row) => ({
      ...toPublicAlert(row),
      user: {
        id: row.user_id,
        fullName: row.user_full_name,
        phone: row.user_phone,
        role: row.user_role,
      },
      acknowledgedByName: row.acknowledged_by_name,
      resolvedByName: row.resolved_by_name,
    })),
  };
}

/**
 * Single alert detail for the admin view with full user info and acknowledger/resolver.
 */
export async function findAlertForAdmin(alertId) {
  const { rows } = await query(
    `SELECT a.*,
            u.full_name AS user_full_name,
            u.phone AS user_phone,
            u.role AS user_role,
            ack.full_name AS acknowledged_by_name,
            res.full_name AS resolved_by_name
       FROM alerts a
       JOIN users u ON u.id = a.user_id
       LEFT JOIN users ack ON ack.id = a.acknowledged_by
       LEFT JOIN users res ON res.id = a.resolved_by
      WHERE a.id = $1`,
    [alertId]
  );
  if (!rows[0]) return null;
  const row = rows[0];
  return {
    ...toPublicAlert(row),
    user: {
      id: row.user_id,
      fullName: row.user_full_name,
      phone: row.user_phone,
      role: row.user_role,
    },
    acknowledgedByName: row.acknowledged_by_name,
    resolvedByName: row.resolved_by_name,
  };
}

