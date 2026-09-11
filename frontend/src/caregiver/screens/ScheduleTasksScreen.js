// ============================================================================
// Tasks — one visit's task list, shared by every viewer role
//
// GET /caregiver/tasks?scheduleId= — scoped server-side same as everywhere
// else in this module: elderly sees their own, family sees linked, caregiver
// sees tasks assigned to them, admin sees all.
//
// Caregiver viewer: "Mark Done" per pending/in-progress task — the literal
// ask ("caregiver marks it done"). Not built: a caregiver self-assigning a
// new task to themselves — requireTaskCreatePermission (tasks.routes.js)
// actually allows it (assignedToCaregiverId = self), but it's outside what
// was asked here. Flagged in BUILD_LOG.md, not built.
//
// Elderly/family viewer: read-only list + "Add Task", gated on
// role !== 'caregiver' — the same optimistic-show pattern CarePlanScreen
// uses, for the same reason: write access here is hasManageCaregiversPermission,
// the identical all-or-nothing flag, so any family member who can even see
// this screen already either has it or doesn't, and there's no cheap way to
// tell which before they press the button. A 403 on submit gets a clear
// message, not a silent failure.
// ============================================================================

import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { listTasks, updateTaskStatus } from '../api/tasks';
import { ApiError, NetworkError } from '../../shared/api/client';
import { useAuth } from '../../shared/auth/AuthContext';
import { colors, spacing, type } from '../../shared/ui/theme';
import { formatDate } from '../bookingFormat';
import { formatTime } from '../scheduleFormat';
import { taskPriorityLabel, taskStatusLabel } from '../taskFormat';

const OPEN_STATUSES = ['pending', 'in_progress'];

export function ScheduleTasksScreen({ navigation, route }) {
  // `?? {}` because a notification tap can land here with no params at all —
  // a feed item written before the payload carried them, say. Destructuring
  // undefined throws during render, which takes the whole app down (there is
  // no error boundary); the default degrades to the viewer's unfiltered task
  // list instead, which is a wider list but a live screen.
  const { scheduleId, elderlyUserId, elderlyName, caregiverId } = route.params ?? {};
  const { user } = useAuth();

  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { tasks: list } = await listTasks({ scheduleId });
      setTasks(list);
      setBanner(null);
    } catch (err) {
      setBanner({
        kind: 'error',
        text: err instanceof NetworkError ? 'Could not reach the server.' : 'Could not load tasks.',
      });
    } finally {
      setLoading(false);
    }
  }, [scheduleId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function handleMarkDone(taskId) {
    setBusyId(taskId);
    try {
      await updateTaskStatus(taskId, { status: 'completed' });
      await load();
    } catch (err) {
      setBanner({
        kind: 'error',
        text: err instanceof NetworkError ? 'Could not reach the server. Please try again.' : 'Could not update that task.',
      });
    } finally {
      setBusyId(null);
    }
  }

  const canAdd = user.role !== 'caregiver';
  const canMarkDone = user.role === 'caregiver';

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable onPress={() => navigation.goBack()} accessibilityRole="button" style={styles.backRow}>
          <Text style={styles.backText}>‹ Back</Text>
        </Pressable>

        <Text style={styles.title}>Tasks{elderlyName ? ` — ${elderlyName}` : ''}</Text>

        {banner && (
          <Pressable onPress={() => setBanner(null)} style={styles.banner}>
            <Text style={styles.bannerText}>{banner.text}</Text>
          </Pressable>
        )}

        {loading && <ActivityIndicator size="large" color={colors.primary} style={styles.spinner} />}

        {!loading && tasks.length === 0 && (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>No tasks for this visit yet.</Text>
          </View>
        )}

        {!loading &&
          tasks.map((t) => (
            <View key={t.id} style={styles.card}>
              <Text style={styles.cardTitle}>{t.title}</Text>
              <Text style={styles.cardMeta}>
                {taskStatusLabel(t.status)} · {taskPriorityLabel(t.priority)} priority
              </Text>
              {t.dueDate ? (
                <Text style={styles.cardMeta}>
                  Due {formatDate(t.dueDate)}
                  {t.dueTime ? ` at ${formatTime(t.dueTime)}` : ''}
                </Text>
              ) : null}
              {t.description ? <Text style={styles.cardDescription}>{t.description}</Text> : null}
              {t.status === 'completed' && t.completedByName ? (
                <Text style={styles.cardMeta}>Completed by {t.completedByName}</Text>
              ) : null}

              {busyId === t.id ? (
                <ActivityIndicator color={colors.primary} style={styles.spinner} />
              ) : (
                canMarkDone &&
                OPEN_STATUSES.includes(t.status) && (
                  <Pressable onPress={() => handleMarkDone(t.id)} accessibilityRole="button" style={styles.doneButton}>
                    <Text style={styles.doneButtonText}>Mark Done</Text>
                  </Pressable>
                )
              )}
            </View>
          ))}

        {canAdd && (
          <Pressable
            onPress={() => navigation.navigate('TaskForm', { scheduleId, elderlyUserId, elderlyName, caregiverId })}
            accessibilityRole="button"
            style={styles.addButton}
          >
            <Text style={styles.addButtonText}>Add Task</Text>
          </Pressable>
        )}
      </ScrollView>
    </SafeAreaView>
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
  cardTitle: { fontSize: type.heading, fontWeight: '800', color: colors.text },
  cardMeta: { fontSize: type.body - 1, color: colors.textMuted },
  cardDescription: { fontSize: type.body - 1, color: colors.text, lineHeight: 21, marginTop: 4 },
  doneButton: { backgroundColor: colors.success, borderRadius: 12, paddingVertical: 12, alignItems: 'center', marginTop: spacing.sm },
  doneButtonText: { fontSize: type.body - 1, fontWeight: '800', color: '#FFFFFF' },
  addButton: { backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  addButtonText: { fontSize: type.body, fontWeight: '800', color: '#FFFFFF' },
});
