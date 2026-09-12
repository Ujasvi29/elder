// ============================================================================
// My Schedule — caregiver side
//
// GET /caregiver/schedules, no params — the backend scopes to the caller's
// own assigned slots (c.user_id = caller). Each row already embeds the
// linked attendance's status/check-in/check-out, so this screen never calls
// GET /caregiver/attendance separately.
//
// Check-out-before-check-in: recordCheckOut (attendance.service.js) 400s
// with not_checked_in if there's no check-in yet for the slot. That can
// happen here even though the button only ever renders after a check-in
// exists in the last-loaded list — the list can be stale (another device,
// or a slow screen left open) by the time the button is pressed. Rather than
// just surfacing that 400 as an error banner, checkOutSchedule catches it
// specifically and offers "Check In Now" inline instead of leaving the
// caregiver stuck looking at a failed Check Out button with no way forward.
//
// GPS: captureCurrentLocation() (shared/location/captureLocation.js) — the
// same module SOS uses, not SOS's beginSosLocationCapture race-and-upgrade
// variant, since check-in/out isn't a send-fast path the way an alert is.
// The attendance endpoints have no accuracy field and do no distance
// validation against the elderly user's location — whatever is sent is
// stored as-is. Known gap, not fixed here; see BUILD_LOG.md.
// ============================================================================

import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { listSchedules } from '../api/schedules';
import { checkIn, checkOut } from '../api/attendance';
import { captureCurrentLocation } from '../../shared/location/captureLocation';
import { ApiError, NetworkError } from '../../shared/api/client';
import { colors, spacing, type } from '../../shared/ui/theme';
import { formatDate } from '../bookingFormat';
import { attendanceStatusLabel, formatTime, computeDurationMinutes, formatDuration } from '../scheduleFormat';

export function CaregiverScheduleScreen({ navigation }) {
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [checkoutBlockedId, setCheckoutBlockedId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { schedules: list } = await listSchedules();
      setSchedules(list);
      setBanner(null);
    } catch (err) {
      setBanner({
        kind: 'error',
        text: err instanceof NetworkError ? 'Could not reach the server.' : 'Could not load your schedule.',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function handleCheckIn(scheduleId) {
    setBusyId(scheduleId);
    setCheckoutBlockedId(null);
    try {
      const location = await captureCurrentLocation({ timeoutMs: 8000 });
      await checkIn(scheduleId, {
        latitude: location?.latitude,
        longitude: location?.longitude,
      });
      await load();
    } catch (err) {
      setBanner({
        kind: 'error',
        text: err instanceof NetworkError ? 'Could not reach the server. Please try again.' : 'Could not check in.',
      });
    } finally {
      setBusyId(null);
    }
  }

  async function handleCheckOut(scheduleId) {
    setBusyId(scheduleId);
    try {
      const location = await captureCurrentLocation({ timeoutMs: 8000 });
      await checkOut(scheduleId, {
        latitude: location?.latitude,
        longitude: location?.longitude,
      });
      setCheckoutBlockedId(null);
      await load();
    } catch (err) {
      if (err instanceof ApiError && err.status === 400 && err.code === 'not_checked_in') {
        // Stale list — this slot has no check-in on the server even though
        // it looked checked-in (or check-in-able) when the screen loaded.
        // Offer the way out instead of a dead-end error.
        setCheckoutBlockedId(scheduleId);
      } else {
        setBanner({
          kind: 'error',
          text: err instanceof NetworkError ? 'Could not reach the server. Please try again.' : 'Could not check out.',
        });
      }
    } finally {
      setBusyId(null);
    }
  }

  const upcoming = schedules.filter((s) => s.status === 'scheduled');
  const past = schedules.filter((s) => s.status !== 'scheduled');

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable onPress={() => navigation.goBack()} accessibilityRole="button" style={styles.backRow}>
          <Text style={styles.backText}>‹ Back</Text>
        </Pressable>

        <Text style={styles.title}>My Schedule</Text>

        {banner && (
          <Pressable onPress={() => setBanner(null)} style={styles.banner}>
            <Text style={styles.bannerText}>{banner.text}</Text>
          </Pressable>
        )}

        {loading && <ActivityIndicator size="large" color={colors.primary} style={styles.spinner} />}

        {!loading && (
          <>
            <Text style={styles.sectionHeading}>Upcoming</Text>
            {upcoming.length === 0 && <EmptyCard text="No upcoming visits." />}
            {upcoming.map((s) => (
              <ScheduleCard
                key={s.id}
                schedule={s}
                busy={busyId === s.id}
                checkoutBlocked={checkoutBlockedId === s.id}
                onCheckIn={() => handleCheckIn(s.id)}
                onCheckOut={() => handleCheckOut(s.id)}
                onViewCarePlan={() =>
                  navigation.navigate('CarePlan', { elderlyUserId: s.elderlyUserId, elderlyName: s.elderlyName })
                }
                onViewTasks={() =>
                  navigation.navigate('ScheduleTasks', {
                    scheduleId: s.id,
                    elderlyUserId: s.elderlyUserId,
                    elderlyName: s.elderlyName,
                    caregiverId: s.caregiverId,
                  })
                }
                onLogReport={() =>
                  navigation.navigate('ReportForm', {
                    scheduleId: s.id,
                    caregiverId: s.caregiverId,
                    elderlyUserId: s.elderlyUserId,
                    elderlyName: s.elderlyName,
                    reportDate: s.visitDate,
                  })
                }
              />
            ))}

            <Text style={styles.sectionHeading}>Past</Text>
            {past.length === 0 && <EmptyCard text="No past visits yet." />}
            {past.map((s) => (
              <ScheduleCard
                key={s.id}
                schedule={s}
                busy={busyId === s.id}
                checkoutBlocked={checkoutBlockedId === s.id}
                onCheckIn={() => handleCheckIn(s.id)}
                onCheckOut={() => handleCheckOut(s.id)}
                onViewCarePlan={() =>
                  navigation.navigate('CarePlan', { elderlyUserId: s.elderlyUserId, elderlyName: s.elderlyName })
                }
                onViewTasks={() =>
                  navigation.navigate('ScheduleTasks', {
                    scheduleId: s.id,
                    elderlyUserId: s.elderlyUserId,
                    elderlyName: s.elderlyName,
                    caregiverId: s.caregiverId,
                  })
                }
                onLogReport={() =>
                  navigation.navigate('ReportForm', {
                    scheduleId: s.id,
                    caregiverId: s.caregiverId,
                    elderlyUserId: s.elderlyUserId,
                    elderlyName: s.elderlyName,
                    reportDate: s.visitDate,
                  })
                }
              />
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function EmptyCard({ text }) {
  return (
    <View style={styles.emptyCard}>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

function ScheduleCard({ schedule, busy, checkoutBlocked, onCheckIn, onCheckOut, onViewCarePlan, onViewTasks, onLogReport }) {
  const notCheckedIn = !schedule.checkInAt;
  const checkedIn = !!schedule.checkInAt && !schedule.checkOutAt;
  const checkedOut = !!schedule.checkOutAt;
  const duration = checkedOut ? computeDurationMinutes(schedule.checkInAt, schedule.checkOutAt) : null;

  return (
    <View style={styles.card}>
      <Text style={styles.cardName}>{schedule.elderlyName}</Text>
      <Text style={styles.cardMeta}>
        {formatDate(schedule.visitDate)} · {formatTime(schedule.startTime)} – {formatTime(schedule.endTime)}
      </Text>
      <Text style={styles.cardMeta}>{attendanceStatusLabel(schedule.attendanceStatus)}</Text>
      {checkedOut && duration != null && <Text style={styles.cardMeta}>Duration: {formatDuration(duration)}</Text>}
      {schedule.notes ? <Text style={styles.cardInstructions}>"{schedule.notes}"</Text> : null}

      <View style={styles.linkRow}>
        <Pressable onPress={onViewCarePlan} accessibilityRole="button" style={styles.carePlanLink}>
          <Text style={styles.carePlanLinkText}>Care Plan</Text>
        </Pressable>
        {/* Tasks gets button chrome, Care Plan stays a plain link: this is the
            only route to the per-task "Mark Done" button (ScheduleTasksScreen),
            and as faint text beside the big Check In / Check Out buttons it
            read as a label, not a control. */}
        <Pressable onPress={onViewTasks} accessibilityRole="button" style={styles.tasksButton}>
          <Text style={styles.tasksButtonText}>Tasks</Text>
        </Pressable>
      </View>

      {checkedOut && (
        <Pressable onPress={onLogReport} accessibilityRole="button" style={styles.reportButton}>
          <Text style={styles.reportButtonText}>Log Activity Report</Text>
        </Pressable>
      )}

      {busy && <ActivityIndicator color={colors.primary} style={styles.spinner} />}

      {!busy && checkoutBlocked && (
        <View style={styles.confirmBlock}>
          <Text style={styles.confirmText}>You haven't checked in to this visit yet.</Text>
          <Pressable onPress={onCheckIn} accessibilityRole="button" style={styles.checkInButton}>
            <Text style={styles.checkInButtonText}>Check In Now</Text>
          </Pressable>
        </View>
      )}

      {!busy && !checkoutBlocked && schedule.status === 'scheduled' && notCheckedIn && (
        <Pressable onPress={onCheckIn} accessibilityRole="button" style={styles.checkInButton}>
          <Text style={styles.checkInButtonText}>Check In</Text>
        </Pressable>
      )}

      {!busy && !checkoutBlocked && checkedIn && (
        <Pressable onPress={onCheckOut} accessibilityRole="button" style={styles.checkOutButton}>
          <Text style={styles.checkOutButtonText}>Check Out</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl * 2 },
  backRow: { paddingVertical: spacing.xs },
  backText: { fontSize: type.body, color: colors.primary, fontWeight: '700' },
  title: { fontSize: type.title, fontWeight: '900', color: colors.text },
  banner: { borderRadius: 12, padding: spacing.md, borderWidth: 1.5, backgroundColor: '#FEE2E2', borderColor: colors.danger },
  bannerText: { fontSize: type.body - 1, fontWeight: '700', textAlign: 'center', color: colors.danger },
  spinner: { marginVertical: spacing.sm },
  sectionHeading: { fontSize: type.heading, fontWeight: '800', color: colors.text, marginTop: spacing.sm },
  emptyCard: { backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1.5, borderColor: colors.border, padding: spacing.md },
  emptyText: { fontSize: type.body - 1, color: colors.textMuted },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: colors.border,
    padding: spacing.md,
    gap: 4,
  },
  cardName: { fontSize: type.heading, fontWeight: '800', color: colors.text },
  cardMeta: { fontSize: type.body - 1, color: colors.textMuted },
  cardInstructions: { fontSize: type.small + 1, color: colors.text, fontStyle: 'italic', marginTop: 4 },
  linkRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'center', marginTop: 4 },
  carePlanLink: { paddingVertical: 4 },
  carePlanLinkText: { fontSize: type.small + 1, fontWeight: '700', color: colors.primary },
  tasksButton: {
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.primary,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
  },
  tasksButtonText: { fontSize: type.body - 1, fontWeight: '800', color: colors.primary },
  reportButton: {
    alignSelf: 'flex-start',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.primary,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
  },
  reportButtonText: { fontSize: type.body - 1, fontWeight: '800', color: colors.primary },
  checkInButton: { backgroundColor: colors.success, borderRadius: 12, paddingVertical: 12, alignItems: 'center', marginTop: spacing.sm },
  checkInButtonText: { fontSize: type.body - 1, fontWeight: '800', color: '#FFFFFF' },
  checkOutButton: { backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 12, alignItems: 'center', marginTop: spacing.sm },
  checkOutButtonText: { fontSize: type.body - 1, fontWeight: '800', color: '#FFFFFF' },
  confirmBlock: { gap: spacing.sm, marginTop: spacing.sm, alignItems: 'center' },
  confirmText: { fontSize: type.body - 1, fontWeight: '700', color: colors.warning, textAlign: 'center', lineHeight: 22 },
});
