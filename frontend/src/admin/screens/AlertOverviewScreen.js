// ============================================================================
// Alert Overview Screen — Admin Dashboard
//
// Allows administrators to:
//   - View all emergency alerts platform-wide in real-time
//   - Filter by status (Active, Acknowledged, Resolved, Cancelled)
//   - Filter by alert type (SOS, Fall, Geofence, Disaster)
//   - Filter by severity (Critical, High, Medium, Low)
//   - Inspect alert details, user info, GPS coordinates, acknowledgements, resolutions
//   - Paginate through alerts history
// ============================================================================

import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { listAdminAlerts } from '../api/admin';
import { NetworkError } from '../../shared/api/client';
import { colors, spacing, type } from '../../shared/ui/theme';

const STATUS_OPTIONS = [
  { label: 'All Status', value: '' },
  { label: 'Active', value: 'active' },
  { label: 'Acknowledged', value: 'acknowledged' },
  { label: 'Resolved', value: 'resolved' },
  { label: 'Cancelled', value: 'cancelled' },
];

const TYPE_OPTIONS = [
  { label: 'All Types', value: '' },
  { label: 'SOS', value: 'sos' },
  { label: 'Fall', value: 'fall' },
  { label: 'Geofence', value: 'geofence_breach' },
  { label: 'Disaster', value: 'disaster' },
];

const SEVERITY_OPTIONS = [
  { label: 'All Severities', value: '' },
  { label: 'Critical', value: 'critical' },
  { label: 'High', value: 'high' },
  { label: 'Medium', value: 'medium' },
  { label: 'Low', value: 'low' },
];

export function AlertOverviewScreen({ navigation }) {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [banner, setBanner] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  // Filters & Pagination
  const [selectedStatus, setSelectedStatus] = useState('');
  const [selectedType, setSelectedType] = useState('');
  const [selectedSeverity, setSelectedSeverity] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 15;

  const loadAlerts = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);

      try {
        const filters = {
          status: selectedStatus || undefined,
          type: selectedType || undefined,
          severity: selectedSeverity || undefined,
          page,
          limit,
        };

        const res = await listAdminAlerts(filters);
        setAlerts(res.alerts ?? []);
        setTotal(res.total ?? 0);
        setBanner(null);
      } catch (err) {
        setBanner({
          kind: 'error',
          text:
            err instanceof NetworkError
              ? 'Could not reach the server. Please check your connection.'
              : err.message || 'Could not load platform alerts.',
        });
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [selectedStatus, selectedType, selectedSeverity, page]
  );

  useFocusEffect(
    useCallback(() => {
      loadAlerts();
    }, [loadAlerts])
  );

  const handleFilterChange = (setter, value) => {
    setter(value);
    setPage(1);
  };

  const totalPages = Math.max(1, Math.ceil(total / limit));

  const getSeverityBadge = (severity) => {
    switch (severity) {
      case 'critical':
        return { bg: '#FEE2E2', text: '#991B1B', border: '#FCA5A5' };
      case 'high':
        return { bg: '#FFEDD5', text: '#9A3412', border: '#FDBA74' };
      case 'medium':
        return { bg: '#FEF3C7', text: '#92400E', border: '#FCD34D' };
      case 'low':
      default:
        return { bg: '#E0F2FE', text: '#075985', border: '#BAE6FD' };
    }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'active':
        return { bg: '#EF4444', text: '#FFFFFF' };
      case 'acknowledged':
        return { bg: '#F59E0B', text: '#FFFFFF' };
      case 'resolved':
        return { bg: '#10B981', text: '#FFFFFF' };
      case 'cancelled':
      default:
        return { bg: '#9CA3AF', text: '#FFFFFF' };
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadAlerts(true)} />}
      >
        {/* Header & Back */}
        <Pressable onPress={() => navigation.goBack()} accessibilityRole="button" style={styles.backRow}>
          <Text style={styles.backText}>‹ Back to Dashboard</Text>
        </Pressable>

        <View style={styles.headerRow}>
          <View>
            <Text style={styles.title}>Platform Alerts</Text>
            <Text style={styles.subtitle}>System-wide emergency monitor and audit overview</Text>
          </View>
          <View style={styles.totalBadge}>
            <Text style={styles.totalText}>{total} Total</Text>
          </View>
        </View>

        {/* Error Banner */}
        {banner && (
          <Pressable onPress={() => setBanner(null)} style={styles.banner}>
            <Text style={styles.bannerText}>{banner.text}</Text>
          </Pressable>
        )}

        {/* Status Filter Tabs */}
        <View style={styles.filterSection}>
          <Text style={styles.sectionLabel}>Status</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pillRow}>
            {STATUS_OPTIONS.map((opt) => {
              const active = selectedStatus === opt.value;
              return (
                <Pressable
                  key={opt.value}
                  onPress={() => handleFilterChange(setSelectedStatus, opt.value)}
                  style={[styles.filterPill, active && styles.filterPillActive]}
                >
                  <Text style={[styles.filterPillText, active && styles.filterPillTextActive]}>
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        {/* Type Filter Tabs */}
        <View style={styles.filterSection}>
          <Text style={styles.sectionLabel}>Alert Type</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pillRow}>
            {TYPE_OPTIONS.map((opt) => {
              const active = selectedType === opt.value;
              return (
                <Pressable
                  key={opt.value}
                  onPress={() => handleFilterChange(setSelectedType, opt.value)}
                  style={[styles.filterPill, active && styles.filterPillActive]}
                >
                  <Text style={[styles.filterPillText, active && styles.filterPillTextActive]}>
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        {/* Severity Filter Tabs */}
        <View style={styles.filterSection}>
          <Text style={styles.sectionLabel}>Severity</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pillRow}>
            {SEVERITY_OPTIONS.map((opt) => {
              const active = selectedSeverity === opt.value;
              return (
                <Pressable
                  key={opt.value}
                  onPress={() => handleFilterChange(setSelectedSeverity, opt.value)}
                  style={[styles.filterPill, active && styles.filterPillActive]}
                >
                  <Text style={[styles.filterPillText, active && styles.filterPillTextActive]}>
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        {/* Alerts List */}
        {loading && !refreshing ? (
          <ActivityIndicator size="large" color={colors.primary} style={styles.spinner} />
        ) : alerts.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No alerts recorded</Text>
            <Text style={styles.emptySubtitle}>There are no alerts matching the selected filter criteria.</Text>
          </View>
        ) : (
          <View style={styles.alertsContainer}>
            {alerts.map((item) => {
              const severityBadge = getSeverityBadge(item.severity);
              const statusBadge = getStatusBadge(item.status);
              const isExpanded = expandedId === item.id;
              const formattedDate = item.triggeredAt
                ? new Date(item.triggeredAt).toLocaleString()
                : 'Unknown time';

              return (
                <View
                  key={item.id}
                  style={[
                    styles.alertCard,
                    item.status === 'active' && styles.alertCardActive,
                  ]}
                >
                  <Pressable
                    onPress={() => setExpandedId(isExpanded ? null : item.id)}
                    style={styles.cardHeader}
                  >
                    <View style={styles.cardMain}>
                      <View style={styles.badgesRow}>
                        <View
                          style={[
                            styles.typeBadge,
                            item.alertType === 'sos'
                              ? { backgroundColor: '#EF4444' }
                              : item.alertType === 'fall'
                              ? { backgroundColor: '#F97316' }
                              : { backgroundColor: colors.primary },
                          ]}
                        >
                          <Text style={styles.typeBadgeText}>
                            {item.alertType?.toUpperCase() || 'ALERT'}
                          </Text>
                        </View>

                        <View
                          style={[
                            styles.severityBadge,
                            {
                              backgroundColor: severityBadge.bg,
                              borderColor: severityBadge.border,
                            },
                          ]}
                        >
                          <Text style={[styles.severityBadgeText, { color: severityBadge.text }]}>
                            {item.severity?.toUpperCase()}
                          </Text>
                        </View>

                        <View style={[styles.statusBadge, { backgroundColor: statusBadge.bg }]}>
                          <Text style={styles.statusBadgeText}>
                            {item.status?.toUpperCase()}
                          </Text>
                        </View>
                      </View>

                      <Text style={styles.personName}>
                        {item.user?.fullName || 'User'} ({item.user?.role || 'elderly'})
                      </Text>

                      <Text style={styles.phoneText}>📞 {item.user?.phone || 'No phone'}</Text>
                      <Text style={styles.timeText}>🕒 {formattedDate}</Text>

                      {item.message && (
                        <Text style={styles.alertMsg} numberOfLines={isExpanded ? undefined : 2}>
                          "{item.message}"
                        </Text>
                      )}
                    </View>

                    <Text style={styles.chevron}>{isExpanded ? '▲' : '▼'}</Text>
                  </Pressable>

                  {/* Expanded Detail Panel */}
                  {isExpanded && (
                    <View style={styles.detailPanel}>
                      <View style={styles.divider} />
                      <View style={styles.detailRow}>
                        <Text style={styles.detailKey}>Alert ID:</Text>
                        <Text style={styles.detailVal} numberOfLines={1}>
                          {item.id}
                        </Text>
                      </View>

                      <View style={styles.detailRow}>
                        <Text style={styles.detailKey}>User ID:</Text>
                        <Text style={styles.detailVal} numberOfLines={1}>
                          {item.userId}
                        </Text>
                      </View>

                      {item.latitude && item.longitude && (
                        <View style={styles.detailRow}>
                          <Text style={styles.detailKey}>GPS Location:</Text>
                          <Text style={styles.detailVal}>
                            {item.latitude.toFixed(5)}, {item.longitude.toFixed(5)}
                            {item.locationAccuracyMeters ? ` (±${Math.round(item.locationAccuracyMeters)}m)` : ''}
                          </Text>
                        </View>
                      )}

                      {item.acknowledgedAt && (
                        <View style={styles.detailRow}>
                          <Text style={styles.detailKey}>Acknowledged:</Text>
                          <Text style={styles.detailVal}>
                            {new Date(item.acknowledgedAt).toLocaleString()}
                            {item.acknowledgedByName ? ` by ${item.acknowledgedByName}` : ''}
                          </Text>
                        </View>
                      )}

                      {item.resolvedAt && (
                        <View style={styles.detailRow}>
                          <Text style={styles.detailKey}>Resolved:</Text>
                          <Text style={styles.detailVal}>
                            {new Date(item.resolvedAt).toLocaleString()}
                            {item.resolvedByName ? ` by ${item.resolvedByName}` : ''}
                          </Text>
                        </View>
                      )}

                      {item.resolutionNotes && (
                        <View style={styles.detailRow}>
                          <Text style={styles.detailKey}>Resolution Notes:</Text>
                          <Text style={styles.detailVal}>{item.resolutionNotes}</Text>
                        </View>
                      )}
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        )}

        {/* Pagination */}
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
  totalText: { fontSize: type.small, fontWeight: '700', color: colors.danger },

  banner: {
    backgroundColor: '#FEE2E2',
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: 10,
    padding: spacing.sm,
  },
  bannerText: { color: colors.danger, fontSize: type.small },

  filterSection: { gap: 4 },
  sectionLabel: { fontSize: 12, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase' },
  pillRow: { gap: spacing.sm, paddingVertical: 2 },
  filterPill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterPillActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  filterPillText: { fontSize: type.small - 1, color: colors.text, fontWeight: '600' },
  filterPillTextActive: { color: colors.surface },

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

  alertsContainer: { gap: spacing.sm },
  alertCard: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  alertCardActive: {
    borderColor: '#FCA5A5',
    backgroundColor: '#FFFBFB',
    borderLeftWidth: 4,
    borderLeftColor: '#EF4444',
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardMain: { flex: 1, gap: 4 },
  badgesRow: { flexDirection: 'row', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 2 },
  typeBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  typeBadgeText: { fontSize: 11, fontWeight: '900', color: '#FFFFFF' },
  severityBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, borderWidth: 1 },
  severityBadgeText: { fontSize: 11, fontWeight: '800' },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  statusBadgeText: { fontSize: 11, fontWeight: '800' },

  personName: { fontSize: type.body, fontWeight: '800', color: colors.text },
  phoneText: { fontSize: type.small, color: colors.textMuted },
  timeText: { fontSize: type.small - 1, color: colors.textMuted },
  alertMsg: { fontSize: type.small, color: colors.text, fontStyle: 'italic', marginTop: 2 },
  chevron: { fontSize: 14, color: colors.textMuted, paddingLeft: 8, paddingTop: 4 },

  detailPanel: { marginTop: spacing.sm, gap: 6 },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 4 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  detailKey: { fontSize: type.small - 1, color: colors.textMuted },
  detailVal: { fontSize: type.small - 1, color: colors.text, fontWeight: '600', maxWidth: '65%' },

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
