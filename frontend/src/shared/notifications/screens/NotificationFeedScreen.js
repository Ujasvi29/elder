// ============================================================================
// Notification Feed Screen
//
// Displays the authenticated user's notification feed with unread indicators,
// category-specific icons, relative timestamps, pull-to-refresh, pagination,
// mark-as-read actions, and deep-link routing.
// ============================================================================

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  listNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
} from '../../api/notifications';
import { colors, spacing, type } from '../../ui/theme';

// ---------------------------------------------------------------------------
// Helpers: Time formatting & Category styling
// ---------------------------------------------------------------------------

function formatRelativeTime(dateString) {
  if (!dateString) return '';
  const now = Date.now();
  const date = new Date(dateString).getTime();
  const diffSec = Math.max(0, Math.floor((now - date) / 1000));

  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;

  return new Date(dateString).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

function getEventBadgeInfo(eventType) {
  switch (eventType) {
    case 'alert_fired':
    case 'fall_detected':
      return { label: 'EMERGENCY', color: colors.danger, bg: '#FEE2E2', icon: '🚨' };
    case 'alert_acknowledged':
      return { label: 'ACKNOWLEDGED', color: colors.warning, bg: colors.warningBg, icon: '⚠️' };
    case 'alert_cancelled':
    case 'alert_resolved':
      return { label: 'RESOLVED', color: colors.success, bg: '#D1FAE5', icon: '✅' };
    case 'geofence_breach':
      return { label: 'GEOFENCE', color: colors.warning, bg: colors.warningBg, icon: '📍' };
    case 'booking_created':
    case 'booking_status_changed':
      return { label: 'BOOKING', color: colors.primary, bg: '#DBEAFE', icon: '📅' };
    case 'task_assigned':
    case 'task_status_changed':
      return { label: 'TASK', color: '#0D9488', bg: '#CCFBF1', icon: '📋' };
    case 'invite_received':
    case 'invite_accepted':
    case 'invite_declined':
    case 'permissions_changed':
    case 'caregiver_promoted':
      return { label: 'FAMILY', color: '#7C3AED', bg: '#EDE9FE', icon: '👥' };
    default:
      return { label: 'UPDATE', color: colors.textMuted, bg: '#F3F4F6', icon: '🔔' };
  }
}

// React Navigation does not throw when asked to navigate to a route the
// current navigator doesn't have — it logs a dev warning and does nothing.
// So wrapping navigate() in try/catch never falls through to a fallback, and
// a feed item naming a screen this role's stack doesn't register (the
// backend sends 'AlertDetails' and 'BookingDetails', which no navigator
// registers) was a tap that went nowhere. Check the stack's route names
// first instead.
function firstRegisteredRoute(navigation, names) {
  const routeNames = navigation?.getState?.()?.routeNames ?? [];
  return names.find((name) => routeNames.includes(name)) ?? null;
}

export function NotificationFeedScreen({ navigation }) {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState(null);

  // Fetch first page
  const fetchInitial = useCallback(async () => {
    try {
      setError(null);
      const res = await listNotifications({ limit: 20 });
      setNotifications(res.notifications || []);
      setHasMore(res.hasMore || false);
    } catch (err) {
      setError(err.message || 'Could not load notifications');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchInitial();
  }, [fetchInitial]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    fetchInitial();
  }, [fetchInitial]);

  // Pagination: load next page using before cursor
  const handleLoadMore = useCallback(async () => {
    if (loadingMore || !hasMore || notifications.length === 0) return;
    const lastItem = notifications[notifications.length - 1];
    if (!lastItem) return;

    try {
      setLoadingMore(true);
      const res = await listNotifications({ limit: 20, before: lastItem.id });
      if (res.notifications && res.notifications.length > 0) {
        setNotifications((prev) => {
          const map = new Map(prev.map((n) => [n.id, n]));
          for (const item of res.notifications) {
            map.set(item.id, item);
          }
          return Array.from(map.values()).sort(
            (a, b) => new Date(b.created_at) - new Date(a.created_at)
          );
        });
      }
      setHasMore(res.hasMore || false);
    } catch (err) {
      console.warn('Could not load more notifications:', err.message);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, notifications]);

  // Mark single as read
  const handlePressItem = useCallback(
    async (item) => {
      if (!item.is_read) {
        // Optimistic UI update
        setNotifications((prev) =>
          prev.map((n) => (n.id === item.id ? { ...n, is_read: true } : n))
        );
        try {
          await markNotificationAsRead(item.id);
        } catch (err) {
          console.warn('Failed to mark notification as read:', err.message);
        }
      }

      // Deep-linking routing based on event type / payload data
      if (item.data?.screen && firstRegisteredRoute(navigation, [item.data.screen])) {
        navigation.navigate(item.data.screen, item.data.params);
        return;
      }

      switch (item.event_type) {
        case 'alert_fired':
        case 'fall_detected':
        case 'alert_acknowledged':
        case 'alert_cancelled':
        case 'alert_resolved':
          if (navigation?.canGoBack()) navigation.goBack();
          break;
        case 'geofence_breach':
          try { navigation.navigate('LiveMap'); } catch {}
          break;
        case 'booking_created':
        case 'booking_status_changed': {
          // 'Bookings' on the elderly/family stacks, 'CaregiverBookings' on
          // the caregiver's — navigate() won't throw for the missing one.
          const target = firstRegisteredRoute(navigation, ['Bookings', 'CaregiverBookings']);
          if (target) navigation.navigate(target);
          break;
        }
        case 'task_assigned':
        case 'task_status_changed':
          try { navigation.navigate('ScheduleTasks'); } catch {}
          break;
        case 'invite_received':
        case 'invite_accepted':
        case 'permissions_changed':
          try { navigation.navigate('FamilyLinks'); } catch {
            try { navigation.navigate('ManageFamily'); } catch {}
          }
          break;
        default:
          break;
      }
    },
    [navigation]
  );

  // Mark all as read
  const handleMarkAllRead = useCallback(async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    try {
      await markAllNotificationsAsRead();
    } catch (err) {
      console.warn('Failed to mark all notifications as read:', err.message);
      fetchInitial();
    }
  }, [fetchInitial]);

  const renderItem = useCallback(
    ({ item }) => {
      const badge = getEventBadgeInfo(item.event_type);
      return (
        <Pressable
          style={[styles.card, !item.is_read && styles.cardUnread]}
          onPress={() => handlePressItem(item)}
          android_ripple={{ color: '#E2E8F0' }}
        >
          <View style={styles.cardHeader}>
            <View style={[styles.badge, { backgroundColor: badge.bg }]}>
              <Text style={styles.icon}>{badge.icon}</Text>
              <Text style={[styles.badgeText, { color: badge.color }]}>
                {badge.label}
              </Text>
            </View>
            <View style={styles.headerRight}>
              <Text style={styles.timeText}>
                {formatRelativeTime(item.created_at)}
              </Text>
              {!item.is_read && <View style={styles.unreadDot} />}
            </View>
          </View>

          <Text style={[styles.title, !item.is_read && styles.titleUnread]}>
            {item.title}
          </Text>

          {!!item.body && (
            <Text style={styles.body} numberOfLines={3}>
              {item.body}
            </Text>
          )}
        </Pressable>
      );
    },
    [handlePressItem]
  );

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerTitleRow}>
          {navigation?.canGoBack() && (
            <Pressable
              onPress={() => navigation.goBack()}
              style={styles.backButton}
              hitSlop={8}
            >
              <Text style={styles.backButtonText}>←</Text>
            </Pressable>
          )}
          <Text style={styles.screenTitle}>Notifications</Text>
        </View>

        {notifications.some((n) => !n.is_read) && (
          <Pressable onPress={handleMarkAllRead} style={styles.markAllButton}>
            <Text style={styles.markAllText}>Mark all read</Text>
          </Pressable>
        )}
      </View>

      {/* Content States */}
      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading notifications...</Text>
        </View>
      ) : error ? (
        <View style={styles.centerContainer}>
          <Text style={styles.errorIcon}>⚠️</Text>
          <Text style={styles.errorTitle}>Could not load notifications</Text>
          <Text style={styles.errorBody}>{error}</Text>
          <Pressable style={styles.retryButton} onPress={fetchInitial}>
            <Text style={styles.retryButtonText}>Try Again</Text>
          </Pressable>
        </View>
      ) : notifications.length === 0 ? (
        <View style={styles.centerContainer}>
          <Text style={styles.emptyIcon}>🔔</Text>
          <Text style={styles.emptyTitle}>No notifications yet</Text>
          <Text style={styles.emptyBody}>
            You're all caught up! New alerts, invites, and task updates will appear here.
          </Text>
          <Pressable style={styles.refreshEmptyButton} onPress={fetchInitial}>
            <Text style={styles.refreshEmptyButtonText}>Refresh</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              colors={[colors.primary]}
              tintColor={colors.primary}
            />
          }
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.3}
          ListFooterComponent={
            loadingMore ? (
              <View style={styles.footerLoader}>
                <ActivityIndicator size="small" color={colors.primary} />
              </View>
            ) : null
          }
        />
      )}
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  backButton: {
    marginRight: spacing.sm,
    padding: spacing.xs || 4,
  },
  backButtonText: {
    fontSize: 24,
    color: colors.text,
    fontWeight: 'bold',
  },
  screenTitle: {
    fontSize: type.heading,
    fontWeight: '700',
    color: colors.text,
  },
  markAllButton: {
    paddingVertical: 4,
    paddingHorizontal: spacing.sm,
    borderRadius: 6,
    backgroundColor: '#EFF6FF',
  },
  markAllText: {
    fontSize: type.small,
    color: colors.primary,
    fontWeight: '600',
  },
  listContent: {
    padding: spacing.md,
    paddingBottom: spacing.xl,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  cardUnread: {
    backgroundColor: '#F8FAFC',
    borderColor: '#BFDBFE',
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  icon: {
    fontSize: 12,
    marginRight: 4,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  timeText: {
    fontSize: type.small - 1,
    color: colors.textMuted,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
    marginLeft: 6,
  },
  title: {
    fontSize: type.body,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 4,
  },
  titleUnread: {
    fontWeight: '700',
    color: '#0F172A',
  },
  body: {
    fontSize: type.small,
    color: colors.textMuted,
    lineHeight: 20,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  loadingText: {
    marginTop: spacing.md,
    fontSize: type.body,
    color: colors.textMuted,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: spacing.md,
  },
  emptyTitle: {
    fontSize: type.heading,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  emptyBody: {
    fontSize: type.body,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: spacing.lg,
  },
  refreshEmptyButton: {
    backgroundColor: colors.surface,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  refreshEmptyButtonText: {
    fontSize: type.small,
    fontWeight: '600',
    color: colors.primary,
  },
  errorIcon: {
    fontSize: 40,
    marginBottom: spacing.sm,
  },
  errorTitle: {
    fontSize: type.heading,
    fontWeight: '700',
    color: colors.danger,
    marginBottom: spacing.xs || 4,
  },
  errorBody: {
    fontSize: type.small,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  retryButton: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#FFF',
    fontWeight: '600',
    fontSize: type.body,
  },
  footerLoader: {
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
});
