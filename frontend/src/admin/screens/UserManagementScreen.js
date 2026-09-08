// ============================================================================
// User Management Screen — Admin Dashboard
//
// Allows administrators to:
//   - Search users across name, email, and phone
//   - Filter by user role (Elderly, Family, Caregiver, Admin)
//   - Filter by account status (Active, Inactive)
//   - View full user details (expanded card)
//   - Activate or deactivate accounts (with self-deactivation protection)
//   - Paginate through user accounts
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '../../shared/auth/AuthContext';
import { listAdminUsers, updateUserActiveStatus } from '../api/admin';
import { NetworkError } from '../../shared/api/client';
import { colors, spacing, type } from '../../shared/ui/theme';

const ROLES = [
  { label: 'All Roles', value: '' },
  { label: 'Elderly', value: 'elderly' },
  { label: 'Family', value: 'family' },
  { label: 'Caregiver', value: 'caregiver' },
  { label: 'Admin', value: 'admin' },
];

const STATUS_FILTERS = [
  { label: 'All Status', value: '' },
  { label: 'Active', value: 'true' },
  { label: 'Inactive', value: 'false' },
];

export function UserManagementScreen({ navigation }) {
  const { user: currentAdmin } = useAuth();

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [banner, setBanner] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  // Filters & Pagination
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRole, setSelectedRole] = useState('');
  const [selectedActive, setSelectedActive] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 15;

  const loadUsers = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);

      try {
        const filters = {
          q: searchQuery.trim() || undefined,
          role: selectedRole || undefined,
          active: selectedActive !== '' ? selectedActive === 'true' : undefined,
          page,
          limit,
        };

        const res = await listAdminUsers(filters);
        setUsers(res.users ?? []);
        setTotal(res.total ?? 0);
        setBanner(null);
      } catch (err) {
        setBanner({
          kind: 'error',
          text:
            err instanceof NetworkError
              ? 'Could not reach the server. Please check your connection.'
              : err.message || 'Could not load users list.',
        });
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [searchQuery, selectedRole, selectedActive, page]
  );

  useFocusEffect(
    useCallback(() => {
      loadUsers();
    }, [loadUsers])
  );

  // Reset page to 1 when filters change
  const handleRoleSelect = (role) => {
    setSelectedRole(role);
    setPage(1);
  };

  const handleActiveSelect = (active) => {
    setSelectedActive(active);
    setPage(1);
  };

  const handleSearchSubmit = () => {
    setPage(1);
    loadUsers();
  };

  const toggleUserStatus = async (targetUser) => {
    if (targetUser.id === currentAdmin?.id && targetUser.isActive) {
      Alert.alert('Action Forbidden', 'You cannot deactivate your own admin account.');
      return;
    }

    const nextState = !targetUser.isActive;
    const actionWord = nextState ? 'activate' : 'deactivate';

    Alert.alert(
      `${nextState ? 'Activate' : 'Deactivate'} User`,
      `Are you sure you want to ${actionWord} ${targetUser.fullName || targetUser.phone || 'this user'}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: nextState ? 'Activate' : 'Deactivate',
          style: nextState ? 'default' : 'destructive',
          onPress: async () => {
            setBusyId(targetUser.id);
            try {
              const res = await updateUserActiveStatus(targetUser.id, nextState);
              setUsers((prev) =>
                prev.map((u) => (u.id === targetUser.id ? { ...u, isActive: res.user.isActive } : u))
              );
            } catch (err) {
              Alert.alert('Update Failed', err.message || `Could not ${actionWord} this user.`);
            } finally {
              setBusyId(null);
            }
          },
        },
      ]
    );
  };

  const totalPages = Math.max(1, Math.ceil(total / limit));

  const getRoleBadgeStyle = (role) => {
    switch (role) {
      case 'admin':
        return { bg: '#EDE9FE', text: '#6D28D9' };
      case 'caregiver':
        return { bg: '#E0F2FE', text: '#0369A1' };
      case 'elderly':
        return { bg: '#DCFCE7', text: '#15803D' };
      case 'family':
        return { bg: '#FEF3C7', text: '#B45309' };
      default:
        return { bg: '#F3F4F6', text: '#4B5563' };
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadUsers(true)} />}
      >
        {/* Navigation & Header */}
        <Pressable onPress={() => navigation.goBack()} accessibilityRole="button" style={styles.backRow}>
          <Text style={styles.backText}>‹ Back to Dashboard</Text>
        </Pressable>

        <View style={styles.headerRow}>
          <View>
            <Text style={styles.title}>User Management</Text>
            <Text style={styles.subtitle}>Manage platform accounts, roles, and status</Text>
          </View>
          <View style={styles.totalBadge}>
            <Text style={styles.totalText}>{total} Users</Text>
          </View>
        </View>

        {/* Error Banner */}
        {banner && (
          <Pressable onPress={() => setBanner(null)} style={styles.banner}>
            <Text style={styles.bannerText}>{banner.text}</Text>
          </Pressable>
        )}

        {/* Search Bar */}
        <View style={styles.searchContainer}>
          <TextInput
            style={styles.searchInput}
            placeholder="Search by name, email, or phone..."
            placeholderTextColor={colors.textMuted}
            value={searchQuery}
            onChangeText={setSearchQuery}
            onSubmitEditing={handleSearchSubmit}
            returnKeyType="search"
            autoCapitalize="none"
            clearButtonMode="while-editing"
          />
          <Pressable style={styles.searchButton} onPress={handleSearchSubmit}>
            <Text style={styles.searchButtonText}>Search</Text>
          </Pressable>
        </View>

        {/* Filter: Roles */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll}>
          {ROLES.map((r) => {
            const active = selectedRole === r.value;
            return (
              <Pressable
                key={r.value}
                onPress={() => handleRoleSelect(r.value)}
                style={[styles.filterChip, active && styles.filterChipActive]}
              >
                <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{r.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Filter: Active Status */}
        <View style={styles.statusFilterRow}>
          {STATUS_FILTERS.map((s) => {
            const active = selectedActive === s.value;
            return (
              <Pressable
                key={s.value}
                onPress={() => handleActiveSelect(s.value)}
                style={[styles.statusChip, active && styles.statusChipActive]}
              >
                <Text style={[styles.statusChipText, active && styles.statusChipTextActive]}>{s.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {/* User List */}
        {loading && !refreshing ? (
          <ActivityIndicator size="large" color={colors.primary} style={styles.spinner} />
        ) : users.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No users found</Text>
            <Text style={styles.emptySubtitle}>Try adjusting your search or filter criteria.</Text>
          </View>
        ) : (
          <View style={styles.listContainer}>
            {users.map((item) => {
              const roleBadge = getRoleBadgeStyle(item.role);
              const isExpanded = expandedId === item.id;
              const isBusy = busyId === item.id;

              return (
                <View key={item.id} style={styles.userCard}>
                  <Pressable
                    onPress={() => setExpandedId(isExpanded ? null : item.id)}
                    style={styles.cardHeader}
                  >
                    <View style={styles.cardMainInfo}>
                      <View style={styles.nameRow}>
                        <Text style={styles.userName}>{item.fullName || 'Unnamed User'}</Text>
                        <View style={[styles.roleBadge, { backgroundColor: roleBadge.bg }]}>
                          <Text style={[styles.roleBadgeText, { color: roleBadge.text }]}>
                            {item.role.toUpperCase()}
                          </Text>
                        </View>
                        <View
                          style={[
                            styles.statusDot,
                            { backgroundColor: item.isActive ? colors.success : colors.danger },
                          ]}
                        />
                      </View>

                      <Text style={styles.userContact}>
                        {item.phone} {item.email ? `• ${item.email}` : ''}
                      </Text>

                      {item.city && (
                        <Text style={styles.userMeta}>📍 {item.city}</Text>
                      )}

                      {item.role === 'caregiver' && item.verificationStatus && (
                        <View style={styles.verificationRow}>
                          <Text style={styles.verificationLabel}>Verification: </Text>
                          <Text
                            style={[
                              styles.verificationVal,
                              item.verificationStatus === 'verified'
                                ? { color: colors.success }
                                : item.verificationStatus === 'rejected'
                                ? { color: colors.danger }
                                : { color: colors.warning },
                            ]}
                          >
                            {item.verificationStatus.toUpperCase()}
                          </Text>
                        </View>
                      )}
                    </View>

                    <Text style={styles.expandChevron}>{isExpanded ? '▲' : '▼'}</Text>
                  </Pressable>

                  {/* Expanded Details */}
                  {isExpanded && (
                    <View style={styles.detailsContainer}>
                      <View style={styles.divider} />
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>User ID:</Text>
                        <Text style={styles.detailValue} numberOfLines={1}>
                          {item.id}
                        </Text>
                      </View>
                      {item.dateOfBirth && (
                        <View style={styles.detailRow}>
                          <Text style={styles.detailLabel}>DOB:</Text>
                          <Text style={styles.detailValue}>
                            {new Date(item.dateOfBirth).toLocaleDateString()}
                          </Text>
                        </View>
                      )}
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>Registered:</Text>
                        <Text style={styles.detailValue}>
                          {item.createdAt ? new Date(item.createdAt).toLocaleDateString() : 'Unknown'}
                        </Text>
                      </View>
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>Account Status:</Text>
                        <Text
                          style={[
                            styles.detailValue,
                            { color: item.isActive ? colors.success : colors.danger, fontWeight: '700' },
                          ]}
                        >
                          {item.isActive ? 'Active' : 'Deactivated'}
                        </Text>
                      </View>

                      {/* Action Button */}
                      <View style={styles.cardActions}>
                        <Pressable
                          style={[
                            styles.actionButton,
                            item.isActive ? styles.deactivateButton : styles.activateButton,
                            isBusy && styles.buttonDisabled,
                          ]}
                          disabled={isBusy}
                          onPress={() => toggleUserStatus(item)}
                        >
                          {isBusy ? (
                            <ActivityIndicator
                              size="small"
                              color={item.isActive ? colors.danger : colors.success}
                            />
                          ) : (
                            <Text
                              style={[
                                styles.actionButtonText,
                                item.isActive ? styles.deactivateText : styles.activateText,
                              ]}
                            >
                              {item.isActive ? 'Deactivate Account' : 'Reactivate Account'}
                            </Text>
                          )}
                        </Pressable>
                      </View>
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        )}

        {/* Pagination Bar */}
        {totalPages > 1 && (
          <View style={styles.paginationBar}>
            <Pressable
              style={[styles.pageBtn, page <= 1 && styles.pageBtnDisabled]}
              disabled={page <= 1}
              onPress={() => setPage((p) => Math.max(1, p - 1))}
            >
              <Text style={[styles.pageBtnText, page <= 1 && styles.pageBtnTextDisabled]}>‹ Prev</Text>
            </Pressable>

            <Text style={styles.pageInfo}>
              Page {page} of {totalPages}
            </Text>

            <Pressable
              style={[styles.pageBtn, page >= totalPages && styles.pageBtnDisabled]}
              disabled={page >= totalPages}
              onPress={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              <Text style={[styles.pageBtnText, page >= totalPages && styles.pageBtnTextDisabled]}>Next ›</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl * 2 },
  backRow: { alignSelf: 'flex-start', paddingVertical: 4 },
  backText: { fontSize: type.body, color: colors.primary, fontWeight: '700' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: type.title, fontWeight: '900', color: colors.text },
  subtitle: { fontSize: type.small, color: colors.textMuted, marginTop: 2 },
  totalBadge: {
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
  },
  totalText: { fontSize: type.small, fontWeight: '700', color: colors.primary },

  banner: {
    backgroundColor: '#FEE2E2',
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: 10,
    padding: spacing.sm,
  },
  bannerText: { color: colors.danger, fontSize: type.small },

  searchContainer: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
  },
  searchInput: {
    flex: 1,
    height: 44,
    fontSize: type.body - 1,
    color: colors.text,
  },
  searchButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  searchButtonText: { color: colors.surface, fontWeight: '700', fontSize: type.small },

  filterScroll: { gap: spacing.sm, paddingVertical: 2 },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  filterChipText: { fontSize: type.small, color: colors.text, fontWeight: '600' },
  filterChipTextActive: { color: colors.surface },

  statusFilterRow: { flexDirection: 'row', gap: spacing.sm },
  statusChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statusChipActive: {
    backgroundColor: '#EEF2FF',
    borderColor: colors.primary,
  },
  statusChipText: { fontSize: type.small - 1, color: colors.textMuted, fontWeight: '600' },
  statusChipTextActive: { color: colors.primary, fontWeight: '700' },

  spinner: { marginTop: spacing.xl },

  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: spacing.xl,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  emptyTitle: { fontSize: type.heading, fontWeight: '700', color: colors.text, marginBottom: 4 },
  emptySubtitle: { fontSize: type.body, color: colors.textMuted, textAlign: 'center' },

  listContainer: { gap: spacing.sm },
  userCard: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardMainInfo: { flex: 1, gap: 4 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  userName: { fontSize: type.body, fontWeight: '800', color: colors.text },
  roleBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  roleBadgeText: { fontSize: 11, fontWeight: '800' },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  userContact: { fontSize: type.small, color: colors.textMuted },
  userMeta: { fontSize: type.small - 1, color: colors.textMuted },
  verificationRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  verificationLabel: { fontSize: type.small - 1, color: colors.textMuted },
  verificationVal: { fontSize: type.small - 1, fontWeight: '700' },
  expandChevron: { fontSize: 14, color: colors.textMuted, paddingLeft: 8 },

  detailsContainer: { marginTop: spacing.sm, gap: 6 },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 4 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  detailLabel: { fontSize: type.small - 1, color: colors.textMuted },
  detailValue: { fontSize: type.small - 1, color: colors.text, fontWeight: '600', maxWidth: '65%' },

  cardActions: { marginTop: spacing.sm, alignItems: 'flex-end' },
  actionButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    minWidth: 140,
    alignItems: 'center',
  },
  deactivateButton: { borderColor: colors.danger, backgroundColor: '#FEF2F2' },
  deactivateText: { color: colors.danger, fontWeight: '700', fontSize: type.small },
  activateButton: { borderColor: colors.success, backgroundColor: '#F0FDF4' },
  activateText: { color: colors.success, fontWeight: '700', fontSize: type.small },
  buttonDisabled: { opacity: 0.5 },

  paginationBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  pageBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pageBtnDisabled: { opacity: 0.4 },
  pageBtnText: { color: colors.primary, fontWeight: '700', fontSize: type.small },
  pageBtnTextDisabled: { color: colors.textMuted },
  pageInfo: { fontSize: type.small, color: colors.textMuted, fontWeight: '600' },
});
