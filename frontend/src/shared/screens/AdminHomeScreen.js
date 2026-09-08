// ============================================================================
// Admin home screen — real dashboard
//
// Reachable only by an account whose role was set to 'admin' directly in the
// database — registration refuses to hand out that role.
//
// Provides direct access to:
//   1. Caregiver Verification Queue — review and approve caregiver applications
//   2. User Management — platform-wide user accounts, roles, search, status
//   3. Platform Alerts Overview — live emergency monitor, SOS, falls, resolutions
// ============================================================================

import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '../auth/AuthContext';
import { colors, spacing, type } from '../ui/theme';

export function AdminHomeScreen({ navigation }) {
  const { user, signOut } = useAuth();

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <Text style={styles.greetingTitle}>Hello, {user?.fullName ?? 'Admin'}</Text>
            <View style={styles.adminBadge}>
              <Text style={styles.adminBadgeText}>ADMIN</Text>
            </View>
          </View>
          <Text style={styles.greetingSubtitle}>Platform Management & Emergency Operations</Text>
        </View>

        {/* Action 1: Caregiver Verification */}
        <Pressable
          style={({ pressed }) => [styles.actionCard, pressed && styles.actionCardPressed]}
          onPress={() => navigation.navigate('CaregiverVerification')}
          accessibilityRole="button"
          accessibilityLabel="Caregiver Verification Queue"
        >
          <View style={styles.cardHeader}>
            <Text style={styles.cardIcon}>🛡️</Text>
            <View style={styles.cardTextContainer}>
              <Text style={styles.cardTitle}>Caregiver Verification Queue</Text>
              <Text style={styles.cardSubtitle}>Review, approve, or reject pending caregiver applications</Text>
            </View>
          </View>
        </Pressable>

        {/* Action 2: User Management */}
        <Pressable
          style={({ pressed }) => [styles.actionCard, pressed && styles.actionCardPressed]}
          onPress={() => navigation.navigate('UserManagement')}
          accessibilityRole="button"
          accessibilityLabel="User Management"
        >
          <View style={styles.cardHeader}>
            <Text style={styles.cardIcon}>👥</Text>
            <View style={styles.cardTextContainer}>
              <Text style={styles.cardTitle}>User Management</Text>
              <Text style={styles.cardSubtitle}>Search users, filter by role, inspect profiles & manage account status</Text>
            </View>
          </View>
        </Pressable>

        {/* Action 3: Platform Alerts Overview */}
        <Pressable
          style={({ pressed }) => [styles.actionCard, pressed && styles.actionCardPressed]}
          onPress={() => navigation.navigate('AlertOverview')}
          accessibilityRole="button"
          accessibilityLabel="Platform Alerts Overview"
        >
          <View style={styles.cardHeader}>
            <Text style={styles.cardIcon}>🚨</Text>
            <View style={styles.cardTextContainer}>
              <Text style={[styles.cardTitle, { color: colors.danger }]}>Platform Alerts Overview</Text>
              <Text style={styles.cardSubtitle}>Real-time system emergency feed, fall detection & audit trail</Text>
            </View>
          </View>
        </Pressable>

        {/* Sign Out */}
        <Pressable style={styles.signOutButton} onPress={signOut} accessibilityRole="button">
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xl * 2 },
  header: { gap: 6 },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  greetingTitle: { fontSize: type.title, fontWeight: '900', color: colors.text },
  adminBadge: {
    backgroundColor: '#EDE9FE',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  adminBadgeText: { fontSize: 11, fontWeight: '900', color: '#6D28D9' },
  greetingSubtitle: { fontSize: type.body - 1, color: colors.textMuted },

  actionCard: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: colors.border,
    padding: spacing.md,
  },
  actionCardPressed: { transform: [{ scale: 0.98 }], opacity: 0.9 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  cardIcon: { fontSize: 32 },
  cardTextContainer: { flex: 1, gap: 4 },
  cardTitle: { fontSize: type.heading - 2, fontWeight: '800', color: colors.primary },
  cardSubtitle: { fontSize: type.small, color: colors.textMuted, lineHeight: 18 },

  signOutButton: {
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    marginTop: spacing.sm,
  },
  signOutText: { fontSize: type.body, color: colors.danger, fontWeight: '700' },
});
