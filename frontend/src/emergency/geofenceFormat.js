// ============================================================================
// Geofence screen formatting helpers
//
// Kept out of the screens themselves so GeofencesScreen (the list, "check
// recent activity" per card) and GeofenceFormScreen (the post-create panel,
// and the family "last known location" age line) share exactly one
// implementation instead of two copies drifting apart.
// ============================================================================

// Plain-language radius choices. No number field — an elderly user shouldn't
// have to think in metres, so metres is shown as secondary text under each
// choice rather than being the thing they pick.
export const RADIUS_OPTIONS = [
  { meters: 100, label: 'Just this building' },
  { meters: 250, label: 'This street' },
  { meters: 500, label: 'This neighbourhood' },
];

/**
 * A zone's radius almost always came from RADIUS_OPTIONS, but nothing stops
 * one existing with a different value (seed data, a future admin tool) — so
 * this always has a safe fallback rather than assuming a match exists.
 */
export function radiusLabel(radiusMeters) {
  const match = RADIUS_OPTIONS.find((o) => o.meters === radiusMeters);
  return match ? match.label : 'Custom area';
}

/**
 * How long ago a timestamp was, in the roughest unit that's still honest —
 * "2 hours ago" not "127 minutes ago". Used prominently, not as a fine-print
 * timestamp: a stale reading used as a zone's centre is a real correctness
 * risk (see GeofenceFormScreen), and "from 2 hours ago" reads very
 * differently from "from 3 days ago".
 */
export function formatAge(isoString) {
  const ms = Date.now() - new Date(isoString).getTime();
  const minutes = Math.round(ms / 60000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;

  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/**
 * Turns GET /emergency/geofences/:id/history's aggregate into the plain-
 * language sanity check ("you've been inside this zone for the last 3
 * days") the elderly user actually reads. `sampleCount: 0` is a distinct,
 * honest state — "not enough data" is not the same claim as "never inside".
 */
export function summarizeHistory(history) {
  if (!history || history.sampleCount === 0) {
    return {
      headline: 'Not enough recent location data yet to check this.',
      detail: 'Check back once a few more location readings have come in.',
      currentlyText: null,
    };
  }

  const dayWord = history.days === 1 ? 'day' : 'days';
  const pct = history.percentInside;

  let headline;
  if (pct >= 90) {
    headline = `You've been inside this zone for most of the last ${history.days} ${dayWord}.`;
  } else if (pct <= 10) {
    headline = `You've mostly been outside this zone over the last ${history.days} ${dayWord}.`;
  } else {
    headline = `You've been inside this zone about ${pct}% of the last ${history.days} ${dayWord}.`;
  }

  return {
    headline,
    detail: `Based on ${history.sampleCount} location reading${history.sampleCount === 1 ? '' : 's'}.`,
    currentlyText: history.currentlyInside ? 'Right now: inside the zone.' : 'Right now: outside the zone.',
  };
}

/**
 * The same idea as formatAge, at a resolution live tracking actually needs:
 * seconds. formatAge deliberately rounds to the roughest honest unit and
 * calls anything under a minute "just now" — right for a zone's centre, wrong
 * for a map that repolls every 20 seconds, where "just now" would sit
 * unchanged through three polls and give no sign the marker is still being
 * updated. This one counts in seconds under a minute ("15s ago") so the
 * label visibly moves, which is itself the evidence that tracking is alive.
 *
 * Kept alongside formatAge rather than replacing it — the two are used for
 * different jobs and the wording of each is load-bearing where it's used.
 */
export function formatFreshness(isoString, now = Date.now()) {
  const seconds = Math.max(0, Math.round((now - new Date(isoString).getTime()) / 1000));

  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
