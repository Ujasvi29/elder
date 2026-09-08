// ============================================================================
// Family home screen — active alerts
//
// Phase 1, steps 1-2. Shows active alerts for elderly users this family member
// is linked to. Every linked (status='active') elderly user's alerts are
// shown — a view-only family member still needs to know an emergency is
// happening. Only alerts where the link's can_acknowledge_alerts is true get
// a "mark resolved" button; the server enforces this regardless of what this
// screen shows. See BUILD_LOG.md for the open question on whether
// can_acknowledge_alerts should also allow cancelling, not just resolving.
//
// Below active alerts, a "Recent alerts" section shows the last 7 days of
// resolved/cancelled alerts for the same linked elderly users — so a
// cancelled SOS still leaves a trace instead of just disappearing. Fetched
// alongside the active list on the same poll cadence rather than its own
// interval; see BUILD_LOG.md for why that's an acceptable trade at this
// scale.
//
// Active alert cards show coordinates (plain text + an "Open in Maps" link)
// where the alert has them and family_links.can_view_location allows it —
// the server redacts latitude/longitude to null otherwise, this screen just
// renders what it's given. Not shown on "Recent alerts" cards, not asked for
// there. Still no in-app map, no live tracking — those are Phase 3. No
// caregiver or care-plan sections — those are Phase 2/4, owned by the
// caregiver module.
//
// Phase 1 step 3 adds "Acknowledge", alongside "Mark resolved" on the same
// canAcknowledge gate. Acknowledging does not close the alert — it stops the
// backend escalating to the next emergency contact, nothing more — so the
// card stays in this list and just shows who acknowledged it. The same
// acknowledge endpoint is also reachable straight from the push notification
// itself; see emergency/notifications/alertNotifications.js.
//
// Phase 1 step 4 adds the approximate-location badge: when
// alert.locationIsApproximate is true, the reading came from a cached
// getLastKnownPositionAsync fix rather than a fresh one at press time — the
// person may have moved since. Deliberately loud (a fixed amber badge next to
// the coordinates, not a tooltip), with wording that states how stale the fix
// is rather than just "approximate," since staleness is the actual risk. When
// a later poll (10s cadence, see POLL_WITH_ACTIVE_MS) picks up an
// async-attached fresh fix that clears the flag, AlertCard shows a brief
// "Confirmed location" transition rather than swapping the badge silently —
// see the wasApproximateRef/justConfirmed state below.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { listFamilyAlerts, listFamilyAlertHistory, resolveAlert, acknowledgeAlert } from '../api/alerts';
import { ApiError, NetworkError } from '../../shared/api/client';
import { useAuth } from '../../shared/auth/AuthContext';
import { colors, spacing, type } from '../../shared/ui/theme';

const POLL_WITH_ACTIVE_MS = 10_000;
const POLL_IDLE_MS = 20_000;

export function FamilyHomeScreen({ navigation }) {
  const { user, signOut } = useAuth();

  const [alerts, setAlerts] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [banner, setBanner] = useState(null);
  const [confirmingId, setConfirmingId] = useState(null);
  const [resolvingId, setResolvingId] = useState(null);
  const [acknowledgingId, setAcknowledgingId] = useState(null);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const [{ alerts: active }, { alerts: recent }] = await Promise.all([
        listFamilyAlerts(),
        listFamilyAlertHistory(),
      ]);
      setAlerts(active);
      setHistory(recent);
      setBanner(null);
    } catch (err) {
      // A background poll failing should not overwrite a list that is still
      // showing correctly — only the initial load surfaces the problem.
      if (!silent) {
        setBanner(
          err instanceof NetworkError
            ? 'Could not reach the server.'
            : 'Could not load alerts.'
        );
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Poll faster while there is an open alert to watch than while the list is
  // quiet — matches the elderly screen's rhythm.
  useEffect(() => {
    const intervalMs = alerts.length > 0 ? POLL_WITH_ACTIVE_MS : POLL_IDLE_MS;
    const id = setInterval(() => load({ silent: true }), intervalMs);
    return () => clearInterval(id);
  }, [alerts.length, load]);

  async function onRefresh() {
    setRefreshing(true);
    await load({ silent: true });
    setRefreshing(false);
  }

  async function handleResolve(alertId) {
    setResolvingId(alertId);
    try {
      await resolveAlert(alertId);
      setAlerts((prev) => prev.filter((a) => a.id !== alertId));
      setConfirmingId(null);
    } catch (err) {
      setBanner(
        err instanceof NetworkError
          ? 'Could not reach the server. Please try again.'
          : 'Could not resolve that alert. Please try again.'
      );
    } finally {
      setResolvingId(null);
    }
  }

  async function handleAcknowledge(alertId) {
    setAcknowledgingId(alertId);
    try {
      await acknowledgeAlert(alertId);
      await load({ silent: true }); // picks up acknowledgedAt/acknowledgedByName from the server
    } catch (err) {
      if (err instanceof ApiError && err.code === 'alert_already_acknowledged') {
        // Someone else got there first — reassurance, not a failure on this
        // person's part. Same pattern as sos_already_active on the elderly
        // screen: never show this as an error.
        setBanner('Already acknowledged by someone else.');
        await load({ silent: true });
        return;
      }
      setBanner(
        err instanceof NetworkError
          ? 'Could not reach the server. Please try again.'
          : 'Could not acknowledge that alert. Please try again.'
      );
    } finally {
      setAcknowledgingId(null);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Family dashboard</Text>
            <Text style={styles.subtitle}>Signed in as {user?.fullName}</Text>
          </View>
          <Pressable
            style={styles.notificationBellButton}
            onPress={() => navigation.navigate('NotificationFeed')}
            accessibilityRole="button"
            accessibilityLabel="Notifications feed"
          >
            <Text style={{ fontSize: 22 }}>🔔</Text>
          </Pressable>
        </View>

        <Pressable
          style={styles.familyLinksButton}
          onPress={() => navigation.navigate('FamilyLinks')}
          accessibilityRole="button"
          accessibilityLabel="Family links: pending invites and who you're linked to"
        >
          <Text style={styles.familyLinksButtonText}>Family Links</Text>
          <Text style={styles.familyLinksButtonSubtext}>Pending invites & who you're linked to</Text>
        </Pressable>

        <Pressable
          style={styles.familyLinksButton}
          onPress={() => navigation.navigate('Bookings')}
          accessibilityRole="button"
          accessibilityLabel="My caregiver bookings"
        >
          <Text style={styles.familyLinksButtonText}>My Bookings</Text>
          <Text style={styles.familyLinksButtonSubtext}>Caregiver requests, confirmed and past visits</Text>
        </Pressable>

        <Pressable
          style={styles.familyLinksButton}
          onPress={() => navigation.navigate('Visits')}
          accessibilityRole="button"
          accessibilityLabel="Visits"
        >
          <Text style={styles.familyLinksButtonText}>Visits</Text>
          <Text style={styles.familyLinksButtonSubtext}>Scheduled visits and attendance status</Text>
        </Pressable>

        {banner && (
          <Pressable onPress={() => setBanner(null)} style={styles.banner}>
            <Text style={styles.bannerText}>{banner}</Text>
          </Pressable>
        )}

        <Text style={styles.sectionHeading}>Active alerts</Text>

        {loading && <ActivityIndicator size="large" color={colors.primary} style={styles.spinner} />}

        {!loading && alerts.length === 0 && (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>No active alerts. Everyone you're linked to is safe.</Text>
          </View>
        )}

        {!loading &&
          alerts.map((alert) => (
            <AlertCard
              key={alert.id}
              alert={alert}
              confirming={confirmingId === alert.id}
              resolving={resolvingId === alert.id}
              acknowledging={acknowledgingId === alert.id}
              onRequestResolve={() => setConfirmingId(alert.id)}
              onBackOut={() => setConfirmingId(null)}
              onConfirmResolve={() => handleResolve(alert.id)}
              onAcknowledge={() => handleAcknowledge(alert.id)}
            />
          ))}

        <Text style={styles.sectionHeading}>Recent alerts</Text>

        {!loading && history.length === 0 && (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>No alerts in the past 7 days.</Text>
          </View>
        )}

        {!loading && history.map((alert) => <HistoryCard key={alert.id} alert={alert} />)}

        <Pressable style={styles.signOutButton} onPress={signOut} accessibilityRole="button">
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

// How stale an approximate fix has to be before the wording escalates from a
// plain "how long ago" statement to an explicit caution. 30 minutes is enough
// time for someone to have genuinely moved, not just drifted GPS noise.
const APPROXIMATE_STALE_MINUTES = 30;

// How long the "Confirmed location" transition state stays visible after an
// approximate fix gets upgraded, before it settles to no badge at all — long
// enough to be noticed on a screen already open, short enough to not linger.
const CONFIRMED_TRANSITION_MS = 8000;

function AlertCard({
  alert,
  confirming,
  resolving,
  acknowledging,
  onRequestResolve,
  onBackOut,
  onConfirmResolve,
  onAcknowledge,
}) {
  const minutesAgo = Math.max(0, Math.round((Date.now() - new Date(alert.triggeredAt)) / 60000));
  const elapsed = minutesAgo === 0 ? 'Just now' : `${minutesAgo} minute${minutesAgo === 1 ? '' : 's'} ago`;
  const hasLocation = alert.latitude != null && alert.longitude != null;
  const busy = resolving || acknowledging;

  // Tracks the approximate -> confirmed transition across polls (10s
  // cadence) so an async-attached fresh fix gets a visible "Confirmed
  // location" moment instead of the badge just silently disappearing on the
  // next render.
  const wasApproximateRef = useRef(alert.locationIsApproximate);
  const [justConfirmed, setJustConfirmed] = useState(false);

  useEffect(() => {
    if (wasApproximateRef.current && !alert.locationIsApproximate && hasLocation) {
      setJustConfirmed(true);
      const timer = setTimeout(() => setJustConfirmed(false), CONFIRMED_TRANSITION_MS);
      wasApproximateRef.current = alert.locationIsApproximate;
      return () => clearTimeout(timer);
    }
    wasApproximateRef.current = alert.locationIsApproximate;
  }, [alert.locationIsApproximate, hasLocation]);

  return (
    <View style={styles.card}>
      <Text style={styles.cardName}>{alert.elderlyUser.fullName}</Text>
      <Text style={styles.cardType}>{alert.alertType.toUpperCase()} · {elapsed}</Text>

      {hasLocation && alert.locationIsApproximate && (
        <View style={styles.approximateBadge}>
          <Text style={styles.approximateBadgeText}>
            {formatApproximateWarning(alert.triggeredAt, alert.locationCapturedAt)}
          </Text>
        </View>
      )}

      {hasLocation && !alert.locationIsApproximate && justConfirmed && (
        <View style={styles.confirmedBadge}>
          <Text style={styles.confirmedBadgeText}>Confirmed location — updated fix received</Text>
        </View>
      )}

      {hasLocation && (
        <Pressable onPress={() => openInMaps(alert.latitude, alert.longitude)} accessibilityRole="button">
          <Text style={styles.locationLink}>
            {formatCoordinates(alert.latitude, alert.longitude)} · Open in Maps
          </Text>
        </Pressable>
      )}

      {alert.acknowledgedAt && (
        <Text style={styles.acknowledgedText}>
          Acknowledged by {alert.acknowledgedByName ?? 'a family member'} — escalation stopped
        </Text>
      )}

      {busy && <ActivityIndicator color={colors.text} style={styles.spinner} />}

      {!busy && !confirming && alert.canAcknowledge && (
        <View style={styles.actionRow}>
          {!alert.acknowledgedAt && (
            <Pressable onPress={onAcknowledge} accessibilityRole="button" style={styles.acknowledgeButton}>
              <Text style={styles.acknowledgeButtonText}>Acknowledge</Text>
            </Pressable>
          )}
          <Pressable onPress={onRequestResolve} accessibilityRole="button" style={styles.resolveButton}>
            <Text style={styles.resolveButtonText}>Mark resolved</Text>
          </Pressable>
        </View>
      )}

      {!busy && !confirming && !alert.canAcknowledge && (
        <Text style={styles.viewOnlyText}>You have view-only access to this alert.</Text>
      )}

      {!busy && confirming && (
        <View style={styles.confirmButtons}>
          <Pressable onPress={onBackOut} accessibilityRole="button" style={styles.confirmNoButton}>
            <Text style={styles.confirmNoButtonText}>Not yet</Text>
          </Pressable>
          <Pressable onPress={onConfirmResolve} accessibilityRole="button" style={styles.confirmYesButton}>
            <Text style={styles.confirmYesButtonText}>Yes, mark resolved</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function formatCoordinates(latitude, longitude) {
  return `${Number(latitude).toFixed(5)}, ${Number(longitude).toFixed(5)}`;
}

/**
 * Wording for the approximate-location badge — states how stale the fix is
 * rather than just flagging uncertainty, since staleness (has this person
 * moved since?) is the actual risk. Escalates past
 * APPROXIMATE_STALE_MINUTES to an explicit caution rather than a bare
 * duration, and falls back to a generic warning when locationCapturedAt is
 * missing (an older row, or a floor value the client sent without a
 * timestamp) rather than showing a nonsensical duration.
 */
function formatApproximateWarning(triggeredAt, locationCapturedAt) {
  if (!locationCapturedAt) {
    return 'Approximate location — may not be current.';
  }

  const staleMinutes = Math.round((new Date(triggeredAt) - new Date(locationCapturedAt)) / 60000);

  if (staleMinutes <= 0) {
    return 'Approximate — from just before the alert.';
  }

  if (staleMinutes > APPROXIMATE_STALE_MINUTES) {
    return 'Approximate — may be significantly out of date. Treat with caution.';
  }

  if (staleMinutes < 60) {
    return `Approximate — from ${staleMinutes} minute${staleMinutes === 1 ? '' : 's'} before the alert.`;
  }

  const hours = Math.floor(staleMinutes / 60);
  const minutes = staleMinutes % 60;
  const hourPart = `${hours} hour${hours === 1 ? '' : 's'}`;
  const suffix = minutes === 0 ? hourPart : `${hourPart} ${minutes} minute${minutes === 1 ? '' : 's'}`;
  return `Approximate — from ${suffix} before the alert.`;
}

/** Universal Google Maps link — opens the native maps app if one is installed, else a browser. */
function openInMaps(latitude, longitude) {
  Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`);
}

/** "active for 4 minutes" / "active for 1 hour 12 minutes" / "active for 2 days" */
function formatActiveDuration(triggeredAt, resolvedAt) {
  const totalMinutes = Math.max(0, Math.round((new Date(resolvedAt) - new Date(triggeredAt)) / 60000));

  if (totalMinutes < 1) return 'Active for less than a minute';
  if (totalMinutes < 60) {
    return `Active for ${totalMinutes} minute${totalMinutes === 1 ? '' : 's'}`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours < 24) {
    const hourPart = `${hours} hour${hours === 1 ? '' : 's'}`;
    return minutes === 0 ? `Active for ${hourPart}` : `Active for ${hourPart} ${minutes} minute${minutes === 1 ? '' : 's'}`;
  }

  const days = Math.floor(hours / 24);
  return `Active for ${days} day${days === 1 ? '' : 's'}`;
}

/** Who closed it and how — cancel is always the alert owner; resolve can be either. */
function formatEndedBy(alert) {
  const name = alert.resolvedByName ?? alert.elderlyUser.fullName;

  if (alert.status === 'cancelled') {
    return `Cancelled by ${name} — they said it was a mistake`;
  }
  return alert.resolvedByIsSelf
    ? `Marked resolved by ${name}`
    : `Resolved by ${name} (family)`;
}

function HistoryCard({ alert }) {
  const cancelled = alert.status === 'cancelled';

  return (
    <View style={[styles.historyCard, cancelled ? styles.historyCardCancelled : styles.historyCardResolved]}>
      <Text style={styles.cardName}>{alert.elderlyUser.fullName}</Text>
      <Text style={styles.historyMeta}>Triggered {new Date(alert.triggeredAt).toLocaleString()}</Text>
      <Text style={styles.historyMeta}>{formatActiveDuration(alert.triggeredAt, alert.resolvedAt)}</Text>
      <Text style={styles.historyEndedBy}>{formatEndedBy(alert)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, gap: spacing.md },
  title: { fontSize: type.title, fontWeight: '700', color: colors.text },
  subtitle: { fontSize: type.body, color: colors.textMuted, marginTop: -spacing.sm },
  familyLinksButton: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 14,
    padding: spacing.md,
    gap: 2,
  },
  familyLinksButtonText: { fontSize: type.body, fontWeight: '800', color: colors.primary },
  familyLinksButtonSubtext: { fontSize: type.small, color: colors.textMuted },
  banner: { backgroundColor: '#FEF3C7', borderRadius: 12, padding: spacing.md },
  bannerText: { fontSize: type.body, color: colors.text, fontWeight: '600' },
  sectionHeading: { fontSize: type.heading, fontWeight: '700', color: colors.text },
  spinner: { marginVertical: spacing.md },
  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  emptyText: { fontSize: type.body, color: colors.textMuted },
  card: {
    backgroundColor: '#FEE2E2',
    borderRadius: 16,
    padding: spacing.md,
    gap: spacing.sm,
  },
  cardName: { fontSize: type.heading, fontWeight: '700', color: colors.text },
  cardType: { fontSize: type.small, fontWeight: '700', color: colors.danger, letterSpacing: 0.5 },
  approximateBadge: {
    backgroundColor: colors.warningBg,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.warning,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  approximateBadgeText: { fontSize: type.small, fontWeight: '700', color: colors.warning },
  confirmedBadge: {
    backgroundColor: '#DCFCE7',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.success,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  confirmedBadgeText: { fontSize: type.small, fontWeight: '700', color: colors.success },
  locationLink: { fontSize: type.small, color: colors.primary, fontWeight: '600' },
  acknowledgedText: { fontSize: type.small, color: colors.text, fontWeight: '600' },
  actionRow: { gap: spacing.sm },
  acknowledgeButton: {
    backgroundColor: colors.text,
    borderRadius: 10,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  acknowledgeButtonText: { fontSize: type.body, fontWeight: '700', color: colors.surface },
  resolveButton: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  resolveButtonText: { fontSize: type.body, fontWeight: '700', color: colors.text },
  viewOnlyText: { fontSize: type.small, color: colors.textMuted, fontStyle: 'italic' },
  confirmButtons: { gap: spacing.sm },
  confirmNoButton: { backgroundColor: colors.surface, borderRadius: 10, paddingVertical: spacing.sm, alignItems: 'center' },
  confirmNoButtonText: { fontSize: type.body, fontWeight: '600', color: colors.text },
  confirmYesButton: { backgroundColor: colors.success, borderRadius: 10, paddingVertical: spacing.sm, alignItems: 'center' },
  confirmYesButtonText: { fontSize: type.body, fontWeight: '700', color: colors.surface },
  historyCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: spacing.md,
    gap: 4,
  },
  historyCardResolved: { backgroundColor: '#DCFCE7', borderColor: '#BBF7D0' },
  historyCardCancelled: { backgroundColor: colors.surface, borderColor: colors.border },
  historyMeta: { fontSize: type.small, color: colors.textMuted },
  historyEndedBy: { fontSize: type.small, color: colors.text, fontWeight: '600' },
  notificationBellButton: {
    padding: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  signOutButton: { alignItems: 'center', paddingVertical: spacing.sm },
  signOutText: { fontSize: type.small, color: colors.textMuted },
});
