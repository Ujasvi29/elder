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
//
// "The people you look after" sits above the alerts, and exists because of a
// device finding: Safety Status, Live Map and Find a Caregiver were only ever
// reachable from FamilyLinksScreen's per-elder cards, so the three headline
// family features were invisible from the family home screen. A tester read
// this screen as a dead end for exactly that reason. The cards here are the
// same five actions, with the same permission gates and the same navigate
// targets FamilyLinksScreen uses — deliberately duplicated rather than
// extracted, because that screen also does invites, leaving and permission
// display, and lifting one section out of it would mean rewriting a working
// screen to fix a discoverability bug on a different one. If a third caller
// ever needs these cards, that is the moment to extract a component.
//
// The links themselves ride the existing alert poll (GET /family/links), so
// this adds no new endpoint and no second interval.
//
// The Family Links and My Bookings cards state counts, not fixed captions.
// They used to read "Pending invites & who you're linked to" and "Caregiver
// requests, confirmed and past visits" — sentences, hardcoded, with no data
// behind them, which is why an accepted invite and a confirmed booking both
// looked like the home screen was stuck: it had never been showing that state
// to begin with, and the numbers only appeared once you opened the screen
// behind the card. Both now count from the same endpoints those screens use.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { ActivityIndicator, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { listFamilyAlerts, listFamilyAlertHistory, resolveAlert, acknowledgeAlert } from '../api/alerts';
import { listLinks } from '../../family/api/links';
import { listBookings } from '../../caregiver/api/bookings';
import { ApiError, NetworkError } from '../../shared/api/client';
import { useAuth } from '../../shared/auth/AuthContext';
import { colors, spacing, type } from '../../shared/ui/theme';
import { bookingStatusLabel } from '../../caregiver/bookingFormat';

const POLL_WITH_ACTIVE_MS = 10_000;
const POLL_IDLE_MS = 20_000;

// The booking states worth counting on a summary card: the ones still going
// to change. Completed, cancelled and rejected bookings are history — real,
// but not what someone glances at the home screen to find out.
const LIVE_BOOKING_STATUSES = ['requested', 'confirmed', 'active'];

/**
 * "1 invite waiting · Linked to 2 people", or a plain description when there
 * is nothing to count. Deliberately states the numbers rather than a status
 * word: "pending" on a card that never changed is what made this screen look
 * stale in the first place.
 */
function linksSummary(pendingCount, activeCount) {
  const parts = [];
  if (pendingCount > 0) parts.push(`${pendingCount} invite${pendingCount === 1 ? '' : 's'} waiting`);
  if (activeCount > 0) parts.push(`Linked to ${activeCount} ${activeCount === 1 ? 'person' : 'people'}`);
  return parts.length ? parts.join(' · ') : 'No invites or links yet';
}

/**
 * "1 Confirmed · 2 Waiting for caregiver" — counted by status, worded with
 * the same bookingStatusLabel the bookings screen itself uses, so the home
 * card and the screen behind it never disagree about what a state is called.
 */
function bookingsSummary(bookings) {
  const counts = new Map();
  for (const booking of bookings) {
    if (!LIVE_BOOKING_STATUSES.includes(booking.status)) continue;
    counts.set(booking.status, (counts.get(booking.status) ?? 0) + 1);
  }

  const parts = LIVE_BOOKING_STATUSES.filter((s) => counts.has(s)).map(
    (s) => `${counts.get(s)} ${bookingStatusLabel(s)}`
  );

  return parts.length ? parts.join(' · ') : 'No bookings in progress';
}

export function FamilyHomeScreen({ navigation }) {
  const { user, signOut } = useAuth();

  const [alerts, setAlerts] = useState([]);
  const [history, setHistory] = useState([]);
  const [links, setLinks] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [banner, setBanner] = useState(null);
  const [confirmingId, setConfirmingId] = useState(null);
  const [resolvingId, setResolvingId] = useState(null);
  const [acknowledgingId, setAcknowledgingId] = useState(null);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      // Links and bookings ride the same poll as the alerts, but each one's
      // failure is swallowed rather than allowed to reject the Promise.all: a
      // family member whose links or bookings call fails still needs to see an
      // active SOS, and the previously loaded summary is better than none.
      // Same reasoning as the silent-poll catch below, one level down.
      //
      // Links are fetched unfiltered, not status='active': the Family Links
      // card counts pending invites too, and a pending invite that never shows
      // up on this screen until you tap through is the bug this fetch exists
      // to close.
      const [{ alerts: active }, { alerts: recent }, linkResult, bookingResult] = await Promise.all([
        listFamilyAlerts(),
        listFamilyAlertHistory(),
        listLinks().catch(() => null),
        listBookings().catch(() => null),
      ]);
      setAlerts(active);
      setHistory(recent);
      if (linkResult) setLinks(linkResult.links ?? []);
      if (bookingResult) setBookings(bookingResult.bookings ?? []);
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

  // Refetch every time this screen is focused, not only on mount. The stack
  // keeps FamilyHome mounted underneath while someone is in Family Links or
  // My Bookings, so a plain mount effect never runs again — an invite accepted
  // or a booking confirmed while they were in there would sit unreflected here
  // until the next poll tick, and the summary cards showed nothing live at all.
  // Coming back to home is the exact moment the numbers must already be right.
  //
  // The first focus loads with the spinner; every later one is silent, so
  // returning to this screen never blanks a list or an active alert while the
  // request is in flight. Same pattern the sub-screens use (BookingsScreen,
  // FamilyLinksScreen), which is how they looked fresh and this screen didn't.
  const hasLoadedRef = useRef(false);

  useFocusEffect(
    useCallback(() => {
      load({ silent: hasLoadedRef.current });
      hasLoadedRef.current = true;
    }, [load])
  );

  // Poll faster while there is an open alert to watch than while the list is
  // quiet — matches the elderly screen's rhythm.
  useEffect(() => {
    const intervalMs = alerts.length > 0 ? POLL_WITH_ACTIVE_MS : POLL_IDLE_MS;
    const id = setInterval(() => load({ silent: true }), intervalMs);
    return () => clearInterval(id);
  }, [alerts.length, load]);

  // The same two filters FamilyLinksScreen applies to the same unfiltered
  // GET /family/links response. Both screens showing the same links must agree
  // on what "linked" and "invited" mean, and the cheapest way to guarantee
  // that is to apply the identical test rather than a server-side filter here
  // and a client-side one there.
  const activeLinks = links.filter((l) => l.status === 'active');
  const pendingInvites = links.filter((l) => l.status === 'pending');

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
          accessibilityLabel={`Family links. ${linksSummary(pendingInvites.length, activeLinks.length)}`}
        >
          <Text style={styles.familyLinksButtonText}>Family Links</Text>
          <Text style={styles.familyLinksButtonSubtext}>
            {linksSummary(pendingInvites.length, activeLinks.length)}
          </Text>
        </Pressable>

        <Pressable
          style={styles.familyLinksButton}
          onPress={() => navigation.navigate('Bookings')}
          accessibilityRole="button"
          accessibilityLabel={`My caregiver bookings. ${bookingsSummary(bookings)}`}
        >
          <Text style={styles.familyLinksButtonText}>My Bookings</Text>
          <Text style={styles.familyLinksButtonSubtext}>{bookingsSummary(bookings)}</Text>
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

        <Text style={styles.sectionHeading}>The people you look after</Text>

        {!loading && activeLinks.length === 0 && (
          <Pressable
            style={styles.emptyCard}
            onPress={() => navigation.navigate('FamilyLinks')}
            accessibilityRole="button"
            accessibilityLabel="You aren't linked to anyone yet. Open Family Links."
          >
            <Text style={styles.emptyText}>
              You aren't linked to anyone yet. Open Family Links to accept an invite — safety status,
              live map and caregiver tools appear here once you're linked.
            </Text>
          </Pressable>
        )}

        {!loading &&
          activeLinks.map((link) => (
            <View key={link.id} style={styles.linkCard}>
              <Text style={styles.linkCardTitle}>{link.elderlyUser?.fullName || 'Linked account'}</Text>
              {link.relationship ? <Text style={styles.linkCardRelationship}>Their {link.relationship}</Text> : null}
              <Text style={styles.linkCardMeta}>
                {link.canViewLocation ? 'You can see their location.' : "You don't have access to their location."}
              </Text>

              {link.canViewLocation && (
                <Pressable
                  onPress={() =>
                    navigation.navigate('SafetyStatus', {
                      elderlyUserId: link.elderlyUserId,
                      elderlyName: link.elderlyUser?.fullName || null,
                    })
                  }
                  accessibilityRole="button"
                  style={styles.linkActionButton}
                >
                  <Text style={styles.linkActionButtonText}>Safety Status</Text>
                </Pressable>
              )}

              {link.canViewLocation && (
                <Pressable
                  onPress={() =>
                    navigation.navigate('LiveMap', {
                      elderlyUserId: link.elderlyUserId,
                      elderlyName: link.elderlyUser?.fullName || null,
                    })
                  }
                  accessibilityRole="button"
                  style={styles.linkActionButton}
                >
                  <Text style={styles.linkActionButtonText}>Live Map</Text>
                </Pressable>
              )}

              {link.canViewLocation && (
                <Pressable
                  onPress={() =>
                    navigation.navigate('Geofences', {
                      elderlyUserId: link.elderlyUserId,
                      elderlyName: link.elderlyUser?.fullName || null,
                      canManage: link.permissionLevel === 'manage' || link.permissionLevel === 'owner',
                    })
                  }
                  accessibilityRole="button"
                  style={styles.linkActionButton}
                >
                  <Text style={styles.linkActionButtonText}>Safe Zones</Text>
                </Pressable>
              )}

              {/* Any active link may book — no in-app payment, so booking
                  isn't behind canManageCaregivers (bookings.routes.js). */}
              <Pressable
                onPress={() =>
                  navigation.navigate('CaregiverSearch', {
                    elderlyUserId: link.elderlyUserId,
                    elderlyName: link.elderlyUser?.fullName || null,
                  })
                }
                accessibilityRole="button"
                style={styles.linkActionButton}
              >
                <Text style={styles.linkActionButtonText}>Find a Caregiver</Text>
              </Pressable>

              {link.canManageCaregivers && (
                <Pressable
                  onPress={() =>
                    navigation.navigate('CarePlan', {
                      elderlyUserId: link.elderlyUserId,
                      elderlyName: link.elderlyUser?.fullName || null,
                    })
                  }
                  accessibilityRole="button"
                  style={styles.linkActionButton}
                >
                  <Text style={styles.linkActionButtonText}>Care Plan</Text>
                </Pressable>
              )}
            </View>
          ))}

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
  // Matches FamilyLinksScreen's `card` / `zonesButton` so the same actions
  // look the same on both screens. Named separately because `card` on this
  // screen is already taken by the red active-alert card.
  linkCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  linkCardTitle: { fontSize: type.heading, fontWeight: '800', color: colors.text },
  linkCardRelationship: { fontSize: type.small + 1, color: colors.textMuted, marginTop: -4 },
  linkCardMeta: { fontSize: type.body - 1, color: colors.textMuted },
  linkActionButton: {
    alignSelf: 'flex-start',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.primary,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
  },
  linkActionButtonText: { fontSize: type.body - 1, fontWeight: '800', color: colors.primary },
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
