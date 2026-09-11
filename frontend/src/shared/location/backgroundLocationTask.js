// ============================================================================
// Background location task definition — Phase 3 step 2.
//
// TaskManager.defineTask must run at module scope, unconditionally, in a
// file that's part of the app's static import graph from the very top
// (imported at the top of App.js — see the comment there). Module-level code
// runs on every bundle load, headless or not, simply as a consequence of how
// JS module evaluation works; that's what makes it safe to rely on here even
// though nothing else about a headless run is safe to assume (no React tree,
// no AuthProvider — see backgroundLocationApi.js). If this were only
// imported from a screen component, a headless run would never import it at
// all, and Android would have a location task with nowhere to deliver to.
//
// Enabling/disabling what actually invokes this is backgroundTracking.js's
// job, driven from the UI. This file only has to be ready to receive.
// ============================================================================

import * as TaskManager from 'expo-task-manager';
import * as Battery from 'expo-battery';
import * as FileSystem from 'expo-file-system/legacy'; // '/legacy' is required on SDK 54 — see locationQueue.js

import { BACKGROUND_LOCATION_TASK, TIME_INTERVAL_MS, DISTANCE_INTERVAL_METERS } from './backgroundLocationTaskName';
import { enqueueLocation } from './locationQueue';
import { flushLocationQueue } from './backgroundLocationApi';

const EARTH_RADIUS_METERS = 6371000;

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

/** Same formula as the backend's geofenceCheck.js — no shared module between the two runtimes, small enough not to need one. */
function haversineMeters(lat1, lon1, lat2, lon2) {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(a));
}

// The last *accepted* reading — not the last delivery — so the 90s/75m floor
// holds regardless of how often Android actually invokes this task. File-
// backed rather than a module-level variable: whether this JS engine
// survives between headless invocations is not something to assume (see
// locationQueue.js's own reasoning for why its state is file-backed too).
const MARKER_FILE = `${FileSystem.documentDirectory}eldercare-location-throttle-marker.json`;

async function readMarker() {
  try {
    const info = await FileSystem.getInfoAsync(MARKER_FILE);
    if (!info.exists) return null;
    return JSON.parse(await FileSystem.readAsStringAsync(MARKER_FILE));
  } catch {
    return null; // corrupt or unreadable — treat as no marker, same as locationQueue.js's own recovery
  }
}

// Logged, never rethrown — same reasoning as locationQueue.js's writeState.
// A throw here rejects the whole task delivery, losing the readings already
// queued behind it and the flush at the end. A lost marker only costs the
// throttle its memory: readMarker returns null, the next delivery is
// accepted unconditionally, and the floor re-establishes itself from there.
async function writeMarker(marker) {
  try {
    await FileSystem.writeAsStringAsync(MARKER_FILE, JSON.stringify(marker));
    return true;
  } catch (err) {
    console.warn(`Location throttle marker write failed — next delivery will not be throttled: ${err?.message ?? err}`);
    return false;
  }
}

TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    console.warn('Background location task error:', error.message);
    return;
  }

  // expo-location can deliver more than one location per invocation if the
  // OS held several before it got a chance to wake the app.
  const locations = data?.locations ?? [];
  if (locations.length === 0) return;

  // Best-effort, same as the SOS-time capture in captureLocation.js — a
  // missing battery reading is never a reason to discard an otherwise-good
  // position fix, and some devices/emulators don't support it at all.
  const batteryLevel = await Battery.getBatteryLevelAsync().catch(() => null);
  const batteryPercent =
    typeof batteryLevel === 'number' && batteryLevel >= 0 ? Math.round(batteryLevel * 100) : null;

  for (const location of locations) {
    // Enforced here, not just requested via startLocationUpdatesAsync's own
    // options — confirmed live (BUILD_LOG.md, 2026-08-28) that Android can
    // and does invoke this task far more often than the 90s/75m request
    // asks for. A delivery that beats both floors since the last *accepted*
    // reading is dropped before it ever reaches the queue or the backend,
    // regardless of why the OS handed it over early.
    const marker = await readMarker();
    if (marker) {
      const elapsedMs = new Date(location.timestamp).getTime() - new Date(marker.recordedAt).getTime();
      const distanceMeters = haversineMeters(
        location.coords.latitude,
        location.coords.longitude,
        marker.latitude,
        marker.longitude
      );
      if (elapsedMs < TIME_INTERVAL_MS && distanceMeters < DISTANCE_INTERVAL_METERS) continue;
    }

    const recordedAt = new Date(location.timestamp).toISOString();

    await enqueueLocation({
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
      accuracyMeters: location.coords.accuracy ?? null,
      batteryLevel: batteryPercent,
      recordedAt,
      source: 'background_task',
    });

    await writeMarker({ recordedAt, latitude: location.coords.latitude, longitude: location.coords.longitude });
  }

  // Every delivery is also a chance to drain whatever's backed up, rather
  // than waiting for a separate retry timer — the common case (online)
  // clears the queue back down to nothing on almost every tick.
  await flushLocationQueue();
});
