// ============================================================================
// Live Map — family side, Phase 3
//
// The screen background GPS tracking existed for. Until now the family side
// could record a position every 90 seconds and then show it as two decimal
// numbers, which is not something anyone can read as "where is she" — the
// whole point of continuous tracking was lost at the last step.
//
// Composed from two endpoints that already exist; no new backend:
//
//   GET /emergency/locations/latest   the position, repolled every 20s
//   GET /emergency/geofences          the safe zones, drawn as circles
//
// Permission is the same gate as FamilySafetyScreen: an active family link
// with can_view_location. That is enforced server-side by
// requireLocationViewPermission on both endpoints — this screen is only ever
// reachable from an entry point already behind link.canViewLocation, and it
// additionally renders the 403 as a plain explanation rather than a generic
// failure, since "you don't have access" and "the server is down" are
// different facts and shouldn't look the same.
//
// The map is Leaflet inside a WebView, not react-native-maps — see
// liveMapHtml.js's header for why, and BUILD_LOG.md for the build cost that
// decision did and didn't carry.
//
// Two things this screen is careful about, both about honesty rather than
// features:
//
//   Staleness is stated, always, in seconds. A map is uniquely good at
//   implying "this is where she is right now" whether or not that's true, so
//   the age of the reading sits in the header at all times and the marker
//   itself turns amber past FRESH_MINUTES. A 40-minute-old position on a map
//   with no age on it is worse than no map.
//
//   A failed poll does not clear the marker. The last known position stays
//   drawn, with its age visibly counting up and a banner saying the update
//   failed. Blanking the map on a dropped request would read as "she has
//   disappeared," a much stronger claim than "the phone couldn't reach the
//   server for 20 seconds."
// ============================================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

import { getLatestLocation } from '../api/locations';
import { listGeofences } from '../api/geofences';
import { LIVE_MAP_HTML } from '../liveMapHtml';
import { ApiError, NetworkError } from '../../shared/api/client';
import { colors, spacing, type } from '../../shared/ui/theme';
import { formatFreshness } from '../geofenceFormat';

// 20s, the fast end of the range asked for. Readings arrive from the device
// roughly every 90s (backgroundLocationTask.js), so most polls return the
// same row — this cadence is about how quickly a new one surfaces once it
// exists, not about how often one exists.
const POLL_MS = 20_000;

// The header's age label recomputes on its own between polls, so a stalled
// poll shows as a number that keeps climbing rather than a frozen one that
// looks like a fresh reading.
const TICK_MS = 1_000;

// Same threshold FamilySafetyScreen uses, for the same reason: comfortably
// past a normal 90s gap, so past it "getting stale" is fair to say.
const FRESH_MINUTES = 15;

function toInjection(js) {
  // The trailing `true;` is required: injectJavaScript warns on iOS if the
  // injected script's last expression isn't a primitive.
  return `${js}; true;`;
}

export function FamilyLiveMapScreen({ navigation, route }) {
  const { elderlyUserId, elderlyName } = route.params;

  const webRef = useRef(null);

  const [location, setLocation] = useState(null);
  const [geofences, setGeofences] = useState([]);
  const [mapReady, setMapReady] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);
  const [follow, setFollow] = useState(true);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [banner, setBanner] = useState(null);
  const [now, setNow] = useState(() => Date.now());

  // -------------------------------------------------------------------------
  // Data
  // -------------------------------------------------------------------------

  const loadLocation = useCallback(
    async ({ silent = false } = {}) => {
      try {
        const { location: latest } = await getLatestLocation({ elderlyUserId });
        setLocation(latest);
        setBanner(null);
      } catch (err) {
        if (err instanceof ApiError && err.status === 403) {
          setDenied(true);
          return;
        }
        // A failed poll keeps the existing marker and only says the update
        // failed. The age label in the header is already telling the truth
        // about how old what's on screen is.
        setBanner(err instanceof NetworkError ? 'Could not reach the server.' : 'Could not update their location.');
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [elderlyUserId]
  );

  // Zones are fetched once per visit, not on the poll: they change when a
  // family member edits them, which is rare, and refetching a static shape
  // every 20 seconds would be work done for nothing.
  const loadGeofences = useCallback(async () => {
    try {
      const { geofences: zones } = await listGeofences({ elderlyUserId });
      setGeofences(zones);
    } catch {
      // A missing safe-zone overlay isn't worth a banner over the position
      // itself, which is what this screen is for.
    }
  }, [elderlyUserId]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      loadGeofences();
      loadLocation();

      const pollId = setInterval(() => {
        if (!cancelled) loadLocation({ silent: true });
      }, POLL_MS);
      const tickId = setInterval(() => {
        if (!cancelled) setNow(Date.now());
      }, TICK_MS);

      // Both intervals stop when the screen loses focus — no polling a map
      // nobody is looking at.
      return () => {
        cancelled = true;
        clearInterval(pollId);
        clearInterval(tickId);
      };
    }, [loadGeofences, loadLocation])
  );

  // -------------------------------------------------------------------------
  // Pushing data into the map
  // -------------------------------------------------------------------------

  const ageMs = location ? now - new Date(location.recordedAt).getTime() : null;
  const isStale = ageMs != null && ageMs > FRESH_MINUTES * 60_000;

  useEffect(() => {
    if (!mapReady || !webRef.current || geofences.length === 0) return;
    const zones = geofences.map((z) => ({
      lat: Number(z.centerLatitude),
      lng: Number(z.centerLongitude),
      radius: Number(z.radiusMeters),
      name: z.name,
    }));
    webRef.current.injectJavaScript(toInjection(`window.EC.setZones(${JSON.stringify(zones)})`));
  }, [mapReady, geofences]);

  useEffect(() => {
    if (!mapReady || !webRef.current || !location) return;
    const point = {
      lat: Number(location.latitude),
      lng: Number(location.longitude),
      accuracy: location.accuracyMeters != null ? Number(location.accuracyMeters) : null,
      stale: isStale,
      follow,
    };
    webRef.current.injectJavaScript(toInjection(`window.EC.setElder(${JSON.stringify(point)})`));
    // `isStale` is deliberately not a dependency: it flips once, fifteen
    // minutes in, and the marker's colour is refreshed by the next poll
    // anyway. Depending on it would re-inject on the tick that crosses the
    // boundary for no visible gain.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, location, follow]);

  function handleRecentre() {
    setFollow(true);
    webRef.current?.injectJavaScript(toInjection('window.EC.recentre()'));
  }

  function handleMessage(event) {
    let payload;
    try {
      payload = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }
    if (payload.type === 'ready') setMapReady(true);
    if (payload.type === 'leaflet_failed') setMapFailed(true);
    if (payload.type === 'panned') setFollow(false);
  }

  // Attribution links inside the map (OpenStreetMap's copyright page) belong
  // in the system browser, not loaded over the top of the map itself.
  function handleNavigationRequest(request) {
    if (request.navigationType === 'click' && request.url.startsWith('http')) {
      Linking.openURL(request.url);
      return false;
    }
    return true;
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const title = elderlyName ? `${elderlyName} — Live` : 'Live Location';

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} accessibilityRole="button" style={styles.backRow}>
          <Text style={styles.backText}>‹ Back</Text>
        </Pressable>
        <Text style={styles.title}>{title}</Text>
        {location && (
          <Text style={[styles.age, isStale && styles.ageStale]}>
            Updated {formatFreshness(location.recordedAt, now)}
            {location.accuracyMeters != null ? ` · within ${Math.round(Number(location.accuracyMeters))}m` : ''}
          </Text>
        )}
      </View>

      {banner && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{banner}</Text>
        </View>
      )}

      <View style={styles.mapArea}>
        {denied && (
          <View style={styles.stateCard}>
            <Text style={styles.stateHeading}>You can't see their location</Text>
            <Text style={styles.stateBody}>
              This account doesn't have location access on your family link. They can change that from their own
              Family screen.
            </Text>
          </View>
        )}

        {!denied && Platform.OS === 'web' && (
          <View style={styles.stateCard}>
            <Text style={styles.stateHeading}>Not available in the browser</Text>
            <Text style={styles.stateBody}>The live map runs on the phone app. Open ElderCare on your phone.</Text>
          </View>
        )}

        {!denied && Platform.OS !== 'web' && (
          <>
            <WebView
              ref={webRef}
              source={{ html: LIVE_MAP_HTML, baseUrl: 'https://eldercare.local/' }}
              originWhitelist={['*']}
              javaScriptEnabled
              domStorageEnabled
              onMessage={handleMessage}
              onShouldStartLoadWithRequest={handleNavigationRequest}
              setSupportMultipleWindows={false}
              style={styles.web}
            />

            {(loading || !mapReady) && !mapFailed && (
              <View style={styles.overlay} pointerEvents="none">
                <ActivityIndicator size="large" color={colors.primary} />
              </View>
            )}

            {mapFailed && (
              <View style={styles.overlay}>
                <View style={styles.stateCard}>
                  <Text style={styles.stateHeading}>Could not load the map</Text>
                  <Text style={styles.stateBody}>
                    The map needs an internet connection to draw. Their last known position is still recorded —
                    Safety Status shows it as coordinates.
                  </Text>
                </View>
              </View>
            )}

            {!loading && mapReady && !location && (
              <View style={styles.overlay}>
                <View style={styles.stateCard}>
                  <Text style={styles.stateHeading}>No location recorded yet</Text>
                  <Text style={styles.stateBody}>
                    Nothing will show here until their phone sends its first reading with location sharing turned
                    on.
                  </Text>
                </View>
              </View>
            )}
          </>
        )}
      </View>

      {!denied && Platform.OS !== 'web' && location && (
        <View style={styles.footer}>
          <Text style={styles.footerNote}>
            {geofences.length > 0
              ? `${geofences.length} safe zone${geofences.length === 1 ? '' : 's'} shown in green.`
              : 'No safe zones set up yet.'}
          </Text>
          {!follow && (
            <Pressable onPress={handleRecentre} accessibilityRole="button" style={styles.recentreButton}>
              <Text style={styles.recentreButtonText}>Recentre</Text>
            </Pressable>
          )}
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.xs, paddingBottom: spacing.sm, gap: 2 },
  backRow: { paddingVertical: spacing.xs },
  backText: { fontSize: type.body, color: colors.primary, fontWeight: '700' },
  title: { fontSize: type.heading, fontWeight: '900', color: colors.text },
  age: { fontSize: type.small + 1, color: colors.textMuted, fontWeight: '700' },
  ageStale: { color: colors.warning },
  banner: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    borderRadius: 12,
    padding: spacing.sm,
    borderWidth: 1.5,
    backgroundColor: colors.warningBg,
    borderColor: colors.warning,
  },
  bannerText: { fontSize: type.small + 1, fontWeight: '700', textAlign: 'center', color: colors.warning },
  mapArea: { flex: 1, overflow: 'hidden' },
  web: { flex: 1, backgroundColor: colors.background },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    backgroundColor: 'rgba(247, 248, 250, 0.92)',
  },
  stateCard: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
    margin: spacing.lg,
  },
  stateHeading: { fontSize: type.body, fontWeight: '800', color: colors.text },
  stateBody: { fontSize: type.body - 2, color: colors.textMuted, lineHeight: 22 },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  footerNote: { flex: 1, fontSize: type.small, color: colors.textMuted, fontWeight: '600' },
  recentreButton: {
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.primary,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
  },
  recentreButtonText: { fontSize: type.body - 1, fontWeight: '800', color: colors.primary },
});
