// ============================================================================
// Geofence breach detection — Phase 3 step 3.
//
// Runs after every stored location reading, from POST /emergency/locations,
// fire-and-forget — same "never a precondition" principle the SOS fanout
// already uses: evaluating geofences must never delay the response to a
// routine location write.
//
// Server-side, not on the device: the background location task already posts
// a reading roughly every 90s (or on 75m of movement — see
// backgroundTracking.js on the frontend), which is the only place a fix
// reliably lands regardless of which screen is open. Doing this on the phone
// instead would mean syncing zone definitions to the device and keeping them
// in sync when a family member edits one remotely, or reaching for OS-level
// geofencing (a separate API from the tracking already built). The trade is
// latency — detection is bounded by however often a reading arrives, not
// instant — accepted because nothing here needs to be pushed to the device.
//
// State is never stored on `geofences` itself. Whether the elderly user was
// last inside or outside a zone is derived by comparing the new reading
// against the *previous* stored `locations` row for the same user — the same
// "derive, don't store" instinct fanout.js already applies to escalation
// progress (there: notifications joined to emergency_contacts.priority;
// here: two consecutive location rows). No previous reading means nothing to
// compare against, so the first reading after a restart — or the first ever
// — just establishes a baseline silently, never fires an alert on its own.
//
// Hysteresis: a transition only counts if the new reading clears the
// boundary by more than its own accuracy_meters (or a fixed fallback when a
// reading has none) — otherwise two GPS fixes a few metres apart near the
// line would flap an exit/enter/exit alert storm out of nothing but noise.
// ============================================================================

import { query } from '../shared/db/pool.js';
import { listGeofencesForUser } from './geofences.js';
import { createGeofenceAlert, autoResolveGeofenceAlert } from './alerts.js';
import { advanceFanout } from './notifications/fanout.js';
import { haversineMeters, classify } from './geofenceMath.js';
import { createFeedItem } from '../notifications/feedWriter.js';
import { NOTIFICATION_EVENTS } from '../notifications/constants.js';
import { listLinksForElderly } from '../family/links.js';

// Applied when a reading has no accuracy_meters of its own to judge
// confidence by — conservative enough to absorb ordinary consumer-GPS jitter
// without being so wide that a real, sustained move stops registering as one.
const DEFAULT_ACCURACY_MARGIN_METERS = 20;

async function findPreviousLocation(userId, beforeRecordedAt) {
  const { rows } = await query(
    `SELECT * FROM locations
      WHERE user_id = $1 AND recorded_at < $2
      ORDER BY recorded_at DESC
      LIMIT 1`,
    [userId, beforeRecordedAt]
  );
  return rows[0] ?? null;
}

async function fireBreach(userId, geofence, direction, location) {
  const alert = await createGeofenceAlert(userId, geofence.id, direction, geofence.name, {
    latitude: location.latitude,
    longitude: location.longitude,
    accuracyMeters: location.accuracy_meters,
  });

  advanceFanout(alert.id).catch((err) =>
    console.error(`Initial fanout failed for geofence alert ${alert.id}:`, err)
  );

  listLinksForElderly(userId, 'active')
    .then((links) => {
      const familyUserIds = links.map((l) => l.family_user_id);
      const allRecipients = [...new Set([userId, ...familyUserIds])];
      createFeedItem({
        recipientUserIds: allRecipients,
        eventType: NOTIFICATION_EVENTS.ALERT_FIRED,
        eventId: alert.id,
        title: `Geofence ${direction === 'exit' ? 'Exit' : 'Entry'} Alert`,
        body: `Geofence boundary breach detected for zone ${geofence.name}`,
        data: { screen: 'AlertDetails', params: { id: alert.id } },
        sendPush: false,
      });
    })
    .catch((err) => console.error('Feed error for geofence breach:', err));
}

/**
 * Evaluates every active geofence for this user against the just-written
 * location row. `newLocation` is the raw row `createLocation` returned
 * (snake_case columns, NUMERIC fields as strings) — called directly from
 * routes.js, never awaited by the response.
 *
 * Per geofence, a confirmed transition does up to two things, independently:
 *   - fires a new breach alert, if the zone is configured to alert in that
 *     direction (alert_on_exit / alert_on_enter);
 *   - auto-resolves whatever active geofence_breach alert already exists for
 *     that zone, if the zone alerts in the *opposite* direction — leaving a
 *     zone you were alerted for entering, or returning to a zone you were
 *     alerted for leaving, both close the loop the same way. For the common
 *     safe-zone case (alert_on_exit only) this is exactly "auto-resolve on
 *     return"; the same rule also covers a restricted-zone zone configured
 *     the other way around, without needing a second code path.
 */
export async function checkGeofences(userId, newLocation) {
  const previous = await findPreviousLocation(userId, newLocation.recorded_at);
  if (!previous) return;

  const geofences = await listGeofencesForUser(userId);
  if (geofences.length === 0) return;

  const lat = Number(newLocation.latitude);
  const lon = Number(newLocation.longitude);
  const prevLat = Number(previous.latitude);
  const prevLon = Number(previous.longitude);
  const margin =
    newLocation.accuracy_meters != null ? Number(newLocation.accuracy_meters) : DEFAULT_ACCURACY_MARGIN_METERS;

  for (const geofence of geofences) {
    const centerLat = Number(geofence.center_latitude);
    const centerLon = Number(geofence.center_longitude);
    const radius = geofence.radius_meters;

    const currentDistance = haversineMeters(lat, lon, centerLat, centerLon);
    const previousDistance = haversineMeters(prevLat, prevLon, centerLat, centerLon);

    const currentClass = classify(currentDistance, radius);
    const previousClass = classify(previousDistance, radius);

    if (currentClass === previousClass) continue;

    // Low-confidence flip — the fix isn't far enough past the boundary to
    // trust over its own reported accuracy. Skip rather than risk an alert
    // fired on GPS noise.
    if (Math.abs(currentDistance - radius) < margin) continue;

    if (currentClass === 'outside') {
      if (geofence.alert_on_exit) await fireBreach(userId, geofence, 'exit', newLocation);
      if (geofence.alert_on_enter) await autoResolveGeofenceAlert(geofence.id);
    } else {
      if (geofence.alert_on_enter) await fireBreach(userId, geofence, 'enter', newLocation);
      if (geofence.alert_on_exit) await autoResolveGeofenceAlert(geofence.id);
    }
  }
}
