// ============================================================================
// Family Links screen — family side
//
// Pending invites (accept/decline) and the elderly accounts this family
// member is actively linked to, with an option to leave a link themselves —
// POST /family/links/:id/revoke permits the family member on their own side
// of the link, not only the elderly user.
//
// GET /family/links joins the elderly account's current name/phone onto
// each link for a family caller — link.elderlyUser.fullName — read live at
// request time, not copied. `relationship` (set by the elderly user at
// invite time, e.g. "daughter") is shown underneath as secondary text: it
// describes this family member's relation, not the elderly person's name,
// and is often blank.
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { acceptInvite, declineInvite, revokeLink, listLinks } from '../api/links';
import { NetworkError } from '../../shared/api/client';
import { colors, spacing, type } from '../../shared/ui/theme';

export function FamilyLinksScreen({ navigation }) {
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [banner, setBanner] = useState(null);

  const [respondingId, setRespondingId] = useState(null);
  const [confirmLeaveId, setConfirmLeaveId] = useState(null);
  const [leavingId, setLeavingId] = useState(null);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const { links: list } = await listLinks();
      setLinks(list);
      if (!silent) setBanner(null);
    } catch (err) {
      if (!silent) {
        setBanner({
          kind: 'error',
          text: err instanceof NetworkError ? 'Could not reach the server.' : 'Could not load your family links.',
        });
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    await load({ silent: true });
    setRefreshing(false);
  }

  const pendingInvites = links.filter((l) => l.status === 'pending');
  const activeLinks = links.filter((l) => l.status === 'active');

  async function handleAccept(id) {
    setRespondingId(id);
    try {
      await acceptInvite(id);
      await load({ silent: true });
      setBanner({ kind: 'success', text: 'You can now see their account.' });
    } catch (err) {
      setBanner({
        kind: 'error',
        text: err instanceof NetworkError ? 'Could not reach the server. Please try again.' : 'Could not accept that invite.',
      });
    } finally {
      setRespondingId(null);
    }
  }

  async function handleDecline(id) {
    setRespondingId(id);
    try {
      await declineInvite(id);
      setLinks((prev) => prev.filter((l) => l.id !== id));
    } catch (err) {
      setBanner({
        kind: 'error',
        text: err instanceof NetworkError ? 'Could not reach the server. Please try again.' : 'Could not decline that invite.',
      });
    } finally {
      setRespondingId(null);
    }
  }

  async function handleLeave(id) {
    setLeavingId(id);
    try {
      await revokeLink(id);
      setLinks((prev) => prev.filter((l) => l.id !== id));
      setConfirmLeaveId(null);
      setBanner({ kind: 'success', text: 'You left this link. You can no longer see that account.' });
    } catch (err) {
      setBanner({
        kind: 'error',
        text: err instanceof NetworkError ? 'Could not reach the server. Please try again.' : 'Could not leave that link.',
      });
    } finally {
      setLeavingId(null);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <Pressable onPress={() => navigation.goBack()} accessibilityRole="button" style={styles.backRow}>
          <Text style={styles.backText}>‹ Back</Text>
        </Pressable>

        <Text style={styles.title}>Family Links</Text>

        {banner && (
          <Pressable
            onPress={() => setBanner(null)}
            style={[styles.banner, banner.kind === 'error' ? styles.bannerError : styles.bannerSuccess]}
          >
            <Text style={[styles.bannerText, banner.kind === 'error' ? styles.bannerTextError : styles.bannerTextSuccess]}>
              {banner.text}
            </Text>
          </Pressable>
        )}

        {loading && <ActivityIndicator size="large" color={colors.primary} style={styles.spinner} />}

        <Text style={styles.sectionHeading}>Pending invites</Text>

        {!loading && pendingInvites.length === 0 && (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>No invites waiting on you right now.</Text>
          </View>
        )}

        {!loading &&
          pendingInvites.map((link) => (
            <View key={link.id} style={styles.card}>
              <Text style={styles.cardTitle}>{link.elderlyUser?.fullName || 'You’ve been invited'}</Text>
              <Text style={styles.cardMeta}>
                {link.relationship ? `They said you're their ${link.relationship}.` : 'They want to add you as family.'}
              </Text>
              {respondingId === link.id ? (
                <ActivityIndicator color={colors.primary} style={styles.spinner} />
              ) : (
                <View style={styles.actionRow}>
                  <Pressable onPress={() => handleDecline(link.id)} accessibilityRole="button" style={styles.declineButton}>
                    <Text style={styles.declineButtonText}>Decline</Text>
                  </Pressable>
                  <Pressable onPress={() => handleAccept(link.id)} accessibilityRole="button" style={styles.acceptButton}>
                    <Text style={styles.acceptButtonText}>Accept</Text>
                  </Pressable>
                </View>
              )}
            </View>
          ))}

        <Text style={styles.sectionHeading}>You're linked to</Text>

        {!loading && activeLinks.length === 0 && (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>You aren't linked to anyone yet.</Text>
          </View>
        )}

        {!loading &&
          activeLinks.map((link) => (
            <View key={link.id} style={styles.card}>
              <Text style={styles.cardTitle}>{link.elderlyUser?.fullName || 'Linked account'}</Text>
              {link.relationship ? <Text style={styles.cardRelationship}>Their {link.relationship}</Text> : null}
              <Text style={styles.cardMeta}>
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
                  style={styles.zonesButton}
                >
                  <Text style={styles.zonesButtonText}>Safety Status</Text>
                </Pressable>
              )}

              {/* Same can_view_location gate as Safety Status — the server
                  enforces it on both endpoints the map calls regardless. */}
              {link.canViewLocation && (
                <Pressable
                  onPress={() =>
                    navigation.navigate('LiveMap', {
                      elderlyUserId: link.elderlyUserId,
                      elderlyName: link.elderlyUser?.fullName || null,
                    })
                  }
                  accessibilityRole="button"
                  style={styles.zonesButton}
                >
                  <Text style={styles.zonesButtonText}>Live Map</Text>
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
                  style={styles.zonesButton}
                >
                  <Text style={styles.zonesButtonText}>Safe Zones</Text>
                </Pressable>
              )}

              {link.canManageCaregivers && (
                <Pressable
                  onPress={() =>
                    navigation.navigate('CaregiverSearch', {
                      elderlyUserId: link.elderlyUserId,
                      elderlyName: link.elderlyUser?.fullName || null,
                    })
                  }
                  accessibilityRole="button"
                  style={styles.zonesButton}
                >
                  <Text style={styles.zonesButtonText}>Find a Caregiver</Text>
                </Pressable>
              )}

              {link.canManageCaregivers && (
                <Pressable
                  onPress={() =>
                    navigation.navigate('CarePlan', {
                      elderlyUserId: link.elderlyUserId,
                      elderlyName: link.elderlyUser?.fullName || null,
                    })
                  }
                  accessibilityRole="button"
                  style={styles.zonesButton}
                >
                  <Text style={styles.zonesButtonText}>Care Plan</Text>
                </Pressable>
              )}

              {leavingId === link.id ? (
                <ActivityIndicator color={colors.danger} style={styles.spinner} />
              ) : confirmLeaveId === link.id ? (
                <View style={styles.confirmBlock}>
                  <Text style={styles.confirmText}>
                    Leave {link.elderlyUser?.fullName || 'this link'}? You'll no longer be able to see their account.
                  </Text>
                  <View style={styles.confirmButtons}>
                    <Pressable onPress={() => setConfirmLeaveId(null)} accessibilityRole="button" style={styles.confirmNoButton}>
                      <Text style={styles.confirmNoButtonText}>Stay Linked</Text>
                    </Pressable>
                    <Pressable onPress={() => handleLeave(link.id)} accessibilityRole="button" style={styles.confirmYesButton}>
                      <Text style={styles.confirmYesButtonText}>Yes, Leave</Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <Pressable onPress={() => setConfirmLeaveId(link.id)} accessibilityRole="button" style={styles.leaveButton}>
                  <Text style={styles.leaveButtonText}>Leave</Text>
                </Pressable>
              )}
            </View>
          ))}
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
  banner: { borderRadius: 12, padding: spacing.md, borderWidth: 1.5 },
  bannerError: { backgroundColor: '#FEE2E2', borderColor: colors.danger },
  bannerSuccess: { backgroundColor: '#DCFCE7', borderColor: colors.success },
  bannerText: { fontSize: type.body - 1, fontWeight: '700', textAlign: 'center' },
  bannerTextError: { color: colors.danger },
  bannerTextSuccess: { color: colors.success },
  spinner: { marginVertical: spacing.md },
  sectionHeading: { fontSize: type.heading, fontWeight: '800', color: colors.text, marginTop: spacing.sm },
  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  emptyText: { fontSize: type.body - 1, color: colors.textMuted },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  cardTitle: { fontSize: type.heading, fontWeight: '800', color: colors.text },
  cardRelationship: { fontSize: type.small + 1, color: colors.textMuted, marginTop: -4 },
  cardMeta: { fontSize: type.body - 1, color: colors.textMuted },
  actionRow: { flexDirection: 'row', gap: spacing.sm },
  declineButton: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingVertical: 12,
    alignItems: 'center',
  },
  declineButtonText: { fontSize: type.body - 1, fontWeight: '700', color: colors.text },
  acceptButton: { flex: 1, backgroundColor: colors.success, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  acceptButtonText: { fontSize: type.body - 1, fontWeight: '800', color: '#FFFFFF' },
  leaveButton: {
    alignSelf: 'flex-start',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.danger,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
  },
  leaveButtonText: { fontSize: type.body - 1, fontWeight: '800', color: colors.danger },
  zonesButton: {
    alignSelf: 'flex-start',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.primary,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
  },
  zonesButtonText: { fontSize: type.body - 1, fontWeight: '800', color: colors.primary },
  confirmBlock: { gap: spacing.sm },
  confirmText: { fontSize: type.body - 1, fontWeight: '700', color: colors.text, lineHeight: 22 },
  confirmButtons: { flexDirection: 'row', gap: spacing.sm },
  confirmNoButton: {
    flex: 1,
    backgroundColor: colors.background,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  confirmNoButtonText: { fontSize: type.body - 1, fontWeight: '700', color: colors.text },
  confirmYesButton: { flex: 1, backgroundColor: colors.danger, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  confirmYesButtonText: { fontSize: type.body - 1, fontWeight: '800', color: '#FFFFFF' },
});
