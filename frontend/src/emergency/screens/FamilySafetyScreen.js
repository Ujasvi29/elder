// ============================================================================
// Safety Status — family side, Phase 3 step 4
//
// One screen to answer "is my elderly person okay right now?" without an
// emergency having to happen. Composed entirely from three endpoints that
// already exist — no new backend:
//
//   GET /emergency/locations/latest   last known reading + how long ago
//   GET /emergency/geofences          this elder's active safe zones
//   GET /emergency/family/alerts      active alerts for every linked elder,
//                                     filtered here to this one by alert.userId
//
// "Inside a safe zone" is computed here, not via a 4th fetch to
// GET /emergency/geofences/:id/history (which only answers per-zone, and
// would mean 1+N calls to check "any zone"). haversineMeters/classify below
// are copied from backend/emergency/geofenceMath.js — same call as
// backgroundLocationTask.js already made for the same formula ("no shared
// module between the two runtimes, small enough not to need one"); this is
// a second frontend call site for the same two functions, still small enough
// not to warrant its own shared module.
//
// Tracking health is not a separate section — there is no server-side "is
// tracking enabled" flag (checked; backgroundTracking.js's on/off state is
// local-only, never synced), so this screen cannot tell "tracking silently
// broke" apart from "they turned it off." Both look identical: an old
// timestamp. The Last Seen card states staleness as a fact ("hasn't updated
// in 3 hours"), never a diagnosis ("tracking has stopped working").
//
// The top status banner only turns red for a real recorded emergency (an
// active SOS/fall/geofence-breach alert) — never for staleness or being
// outside a safe zone on their own. Being outside every safe zone is
// routinely just a normal walk to the shops, not a problem; wording here
// stays factual and calm on purpose, not alarmed.
// ============================================================================

import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getLatestLocation } from '../api/locations';
import { listGeofences } from '../api/geofences';
import { listFamilyAlerts } from '../api/alerts';
import { NetworkError } from '../../shared/api/client';
import { colors, spacing, type } from '../../shared/ui/theme';
import { formatAge } from '../geofenceFormat';

const EARTH_RADIUS_METERS = 6371000;
function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}
function haversineMeters(lat1, lon1, lat2, lon2) {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(a));
}
function classify(distanceMeters, radiusMeters) {
  return distanceMeters <= radiusMeters ? 'inside' : 'outside';
}

// A fresh background-tracking reading arrives roughly every 90s while
// active (see backgroundLocationTask.js) — 15 minutes is comfortably past
// any normal gap, so past that point "getting stale" is a fair read whether
// or not it turns out to be an actual problem.
const FRESH_MINUTES = 15;

const ALERT_TYPE_LABELS = { sos: 'SOS', fall: 'Fall alert', geofence_breach: 'Left a safe zone' };
function alertTypeLabel(alertType) {
  return ALERT_TYPE_LABELS[alertType] ?? alertType;
}

function formatCoordinates(latitude, longitude) {
  return `${Number(latitude).toFixed(5)}, ${Number(longitude).toFixed(5)}`;
}
function openInMaps(latitude, longitude) {
  Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`);
}

export function FamilySafetyScreen({ navigation, route }) {
  const { elderlyUserId, elderlyName } = route.params;

  const [location, setLocation] = useState(null);
  const [geofences, setGeofences] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [locationResult, geofenceResult, alertResult] = await Promise.all([
        getLatestLocation({ elderlyUserId }),
        listGeofences({ elderlyUserId }),
        listFamilyAlerts(),
      ]);
      setLocation(locationResult.location);
      setGeofences(geofenceResult.geofences);
      setAlerts(alertResult.alerts.filter((a) => a.userId === elderlyUserId));
      setBanner(null);
    } catch (err) {
      setBanner({
        kind: 'error',
        text: err instanceof NetworkError ? 'Could not reach the server.' : 'Could not load safety status.',
      });
    } finally {
      setLoading(false);
    }
  }, [elderlyUserId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const ageMinutes = location ? Math.round((Date.now() - new Date(location.recordedAt).getTime()) / 60000) : null;
  const locationIsFresh = ageMinutes != null && ageMinutes < FRESH_MINUTES;

  let zoneStatus = 'none'; // 'none' | 'inside' | 'outside'
  let insideZoneName = null;
  if (geofences.length > 0 && location) {
    for (const zone of geofences) {
      const distance = haversineMeters(
        Number(location.latitude),
        Number(location.longitude),
        Number(zone.centerLatitude),
        Number(zone.centerLongitude)
      );
      if (classify(distance, zone.radiusMeters) === 'inside') {
        insideZoneName = zone.name;
        break;
      }
    }
    zoneStatus = insideZoneName ? 'inside' : 'outside';
  }

  const hasEmergencyAlert = alerts.length > 0;
  let overall = 'green';
  let overallText = 'All good';
  if (hasEmergencyAlert) {
    overall = 'red';
    overallText = 'Needs attention now';
  } else if (!location || !locationIsFresh || zoneStatus === 'outside') {
    overall = 'amber';
    overallText = 'Worth a check';
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable onPress={() => navigation.goBack()} accessibilityRole="button" style={styles.backRow}>
          <Text style={styles.backText}>‹ Back</Text>
        </Pressable>

        <Text style={styles.title}>Safety Status{elderlyName ? ` — ${elderlyName}` : ''}</Text>

        {banner && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText}>{banner.text}</Text>
          </View>
        )}

        {loading && <ActivityIndicator size="large" color={colors.primary} style={styles.spinner} />}

        {!loading && (
          <>
            <View style={[styles.statusBanner, STATUS_BANNER_STYLES[overall]]}>
              <Text style={[styles.statusBannerText, STATUS_TEXT_STYLES[overall]]}>{overallText}</Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardHeading}>Last Seen</Text>
              {location ? (
                <>
                  <Text style={[styles.cardMainText, !locationIsFresh && styles.cardMainTextMuted]}>
                    {formatAge(location.recordedAt)}
                  </Text>
                  <Pressable onPress={() => openInMaps(location.latitude, location.longitude)} accessibilityRole="button">
                    <Text style={styles.locationLink}>
                      {formatCoordinates(location.latitude, location.longitude)} · Open in Maps
                    </Text>
                  </Pressable>
                  {/* The primary way into the live map. This screen already
                      answers "are they okay" as a status; the map answers
                      "where are they" as it changes, which coordinates on
                      their own never could. */}
                  <Pressable
                    onPress={() => navigation.navigate('LiveMap', { elderlyUserId, elderlyName })}
                    accessibilityRole="button"
                    style={styles.mapButton}
                  >
                    <Text style={styles.mapButtonText}>Watch on Live Map</Text>
                  </Pressable>
                </>
              ) : (
                <Text style={styles.cardMainText}>No location has been recorded yet.</Text>
              )}
            </View>

            <View style={styles.card}>
              <Text style={styles.cardHeading}>Safe Zones</Text>
              {zoneStatus === 'inside' && <Text style={styles.cardMainText}>Inside "{insideZoneName}".</Text>}
              {zoneStatus === 'outside' && <Text style={styles.cardMainText}>Outside their safe zones.</Text>}
              {zoneStatus === 'none' && !location && (
                <Text style={styles.cardMainText}>No location yet to check against safe zones.</Text>
              )}
              {zoneStatus === 'none' && location && geofences.length === 0 && (
                <Text style={styles.cardMainText}>No safe zones set up yet.</Text>
              )}
            </View>

            {alerts.length > 0 && (
              <View style={styles.card}>
                <Text style={styles.cardHeading}>Active Alerts</Text>
                {alerts.map((alert) => (
                  <View key={alert.id} style={styles.alertRow}>
                    <Text style={styles.alertType}>{alertTypeLabel(alert.alertType)}</Text>
                    <Text style={styles.alertMeta}>{formatAge(alert.triggeredAt)}</Text>
                  </View>
                ))}
                <Pressable onPress={() => navigation.navigate('FamilyHome')} accessibilityRole="button">
                  <Text style={styles.locationLink}>Go to Family Dashboard to respond</Text>
                </Pressable>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const STATUS_BANNER_STYLES = StyleSheet.create({
  green: { backgroundColor: '#DCFCE7', borderColor: colors.success },
  amber: { backgroundColor: colors.warningBg, borderColor: colors.warning },
  red: { backgroundColor: '#FEE2E2', borderColor: colors.danger },
});

const STATUS_TEXT_STYLES = StyleSheet.create({
  green: { color: colors.success },
  amber: { color: colors.warning },
  red: { color: colors.danger },
});

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl * 2 },
  backRow: { paddingVertical: spacing.xs },
  backText: { fontSize: type.body, color: colors.primary, fontWeight: '700' },
  title: { fontSize: type.title, fontWeight: '900', color: colors.text },
  errorBanner: { borderRadius: 12, padding: spacing.md, borderWidth: 1.5, backgroundColor: '#FEE2E2', borderColor: colors.danger },
  errorBannerText: { fontSize: type.body - 1, fontWeight: '700', textAlign: 'center', color: colors.danger },
  spinner: { marginVertical: spacing.xl },
  statusBanner: { borderRadius: 16, borderWidth: 2, padding: spacing.lg, alignItems: 'center' },
  statusBannerText: { fontSize: type.title - 4, fontWeight: '900' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  cardHeading: { fontSize: type.body - 1, fontWeight: '800', color: colors.text },
  cardMainText: { fontSize: type.body, color: colors.text, fontWeight: '700' },
  cardMainTextMuted: { color: colors.warning },
  locationLink: { fontSize: type.small + 1, color: colors.primary, fontWeight: '700' },
  mapButton: {
    alignSelf: 'flex-start',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.primary,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    marginTop: spacing.sm / 2,
  },
  mapButtonText: { fontSize: type.body - 1, fontWeight: '800', color: colors.primary },
  alertRow: { flexDirection: 'row', justifyContent: 'space-between' },
  alertType: { fontSize: type.body - 1, fontWeight: '800', color: colors.danger },
  alertMeta: { fontSize: type.body - 1, color: colors.textMuted },
});
