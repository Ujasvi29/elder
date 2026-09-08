// ============================================================================
// Manage Family screen — elderly side
//
// Answers two questions at a glance: who can see where I am, and who will
// also be called if I press SOS. Those are deliberately two different
// controls on the same card, not one — accepting a family invite only ever
// grants dashboard access (family_links); being called during an emergency
// is a separate, deliberate toggle backed by POST
// /family/links/:id/emergency-contact and DELETE /emergency/contacts/:id.
// See API.md's "Family Links" section for why these stay separate.
//
// Loads GET /family/links and GET /emergency/contacts together and joins
// them client-side: a link's family member is "also called in an
// emergency" exactly when an active contact exists with
// contact.contactUserId === link.familyUserId. That join is what lets the
// toggle work in both directions — there is no single "is this person an
// emergency contact" field on the link itself.
//
// Removing a linked family member is one tap to open a confirmation, one
// more to actually revoke (same inline-confirm pattern as
// FamilyHomeScreen's "Mark resolved" and ElderlyHomeScreen's "Cancel
// alert") — deliberately not a silent single tap, since it removes someone
// who may be relied on to notice an emergency.
//
// GET /family/links joins the linked family member's current name/phone
// onto each link — link.familyUser.fullName — so cards show that name, with
// `relationship` (free text, often blank) underneath as secondary detail
// rather than the only label.
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { sendInvite, revokeLink, listLinks, promoteToEmergencyContact, updateLinkPermissions } from '../api/links';
import { listContacts, deleteContact } from '../../emergency/api/contacts';
import { ApiError, NetworkError } from '../../shared/api/client';
import { useAuth } from '../../shared/auth/AuthContext';
import { colors, spacing, type } from '../../shared/ui/theme';

export function ManageFamilyScreen({ navigation }) {
  const { user } = useAuth();

  const [links, setLinks] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState(null);

  const [confirmRevokeId, setConfirmRevokeId] = useState(null);
  const [revokingId, setRevokingId] = useState(null);
  const [togglingLinkId, setTogglingLinkId] = useState(null);
  const [togglingCaregiverPermissionId, setTogglingCaregiverPermissionId] = useState(null);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [invitePhone, setInvitePhone] = useState('');
  const [inviteRelationship, setInviteRelationship] = useState('');
  const [inviteCanViewLocation, setInviteCanViewLocation] = useState(true);
  const [inviteCanManageCaregivers, setInviteCanManageCaregivers] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState(null);
  const [inviteFieldErrors, setInviteFieldErrors] = useState({});

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const [linksResult, contactsResult] = await Promise.all([listLinks(), listContacts()]);
      setLinks(linksResult.links);
      setContacts(contactsResult.contacts);
      if (!silent) setBanner(null);
    } catch (err) {
      if (!silent) {
        setBanner({
          kind: 'error',
          text: err instanceof NetworkError ? 'Could not reach the server.' : 'Could not load your family list.',
        });
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const activeLinks = links.filter((l) => l.status === 'active');
  const pendingLinks = links.filter((l) => l.status === 'pending');

  function matchedContact(link) {
    return contacts.find((c) => c.contactUserId === link.familyUserId) ?? null;
  }

  async function handleSendInvite() {
    setInviteError(null);
    setInviteFieldErrors({});

    if (!invitePhone.trim()) {
      setInviteFieldErrors({ phone: 'Enter a phone number.' });
      return;
    }

    setInviting(true);
    try {
      await sendInvite({
        phone: invitePhone.trim(),
        relationship: inviteRelationship.trim() || undefined,
        canViewLocation: inviteCanViewLocation,
        canManageCaregivers: inviteCanManageCaregivers,
      });
      setInvitePhone('');
      setInviteRelationship('');
      setInviteCanViewLocation(true);
      setInviteCanManageCaregivers(false);
      setInviteOpen(false);
      setBanner({ kind: 'success', text: 'Invite sent. They will see it once they open ElderCare.' });
      await load({ silent: true });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'invitee_not_registered') {
          setInviteError("This phone number doesn't have an ElderCare account yet. Ask them to create one, then try again.");
        } else if (err.code === 'already_linked') {
          setInviteError('This person can already see your account.');
        } else if (err.code === 'invite_already_pending') {
          setInviteError("You've already invited this person. They haven't answered yet.");
        } else if (err.code === 'validation_failed' && Array.isArray(err.details)) {
          const mapped = {};
          err.details.forEach((d) => {
            if (d.field) mapped[d.field] = d.message;
          });
          setInviteFieldErrors(mapped);
          setInviteError('Please check the phone number.');
        } else {
          setInviteError(err.message || 'Could not send the invite.');
        }
      } else {
        setInviteError('Could not reach the server. Please try again.');
      }
    } finally {
      setInviting(false);
    }
  }

  async function handleRevoke(linkId) {
    setRevokingId(linkId);
    try {
      await revokeLink(linkId);
      setLinks((prev) => prev.filter((l) => l.id !== linkId));
      setConfirmRevokeId(null);
      setBanner({ kind: 'success', text: 'Removed. They can no longer see your account.' });
    } catch (err) {
      setBanner({
        kind: 'error',
        text: err instanceof NetworkError ? 'Could not reach the server. Please try again.' : 'Could not remove them. Please try again.',
      });
    } finally {
      setRevokingId(null);
    }
  }

  async function handleToggleEmergencyContact(link) {
    const existing = matchedContact(link);
    setTogglingLinkId(link.id);
    try {
      if (existing) {
        await deleteContact(existing.id);
      } else {
        await promoteToEmergencyContact(link.id);
      }
      await load({ silent: true });
    } catch (err) {
      setBanner({
        kind: 'error',
        text: err instanceof NetworkError ? 'Could not reach the server. Please try again.' : 'Could not update that. Please try again.',
      });
    } finally {
      setTogglingLinkId(null);
    }
  }

  async function handleToggleManageCaregivers(link) {
    setTogglingCaregiverPermissionId(link.id);
    try {
      await updateLinkPermissions(link.id, { canManageCaregivers: !link.canManageCaregivers });
      await load({ silent: true });
    } catch (err) {
      setBanner({
        kind: 'error',
        text: err instanceof NetworkError ? 'Could not reach the server. Please try again.' : 'Could not update that. Please try again.',
      });
    } finally {
      setTogglingCaregiverPermissionId(null);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Pressable onPress={() => navigation.goBack()} accessibilityRole="button" style={styles.backRow}>
            <Text style={styles.backText}>‹ Back</Text>
          </Pressable>

          <Text style={styles.title}>Who Can See You</Text>
          <Text style={styles.subtitle}>People here can see your account. You can remove anyone at any time.</Text>

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

          {!loading && activeLinks.length === 0 && (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>Nobody can see your account yet. Invite someone below.</Text>
            </View>
          )}

          {!loading &&
            activeLinks.map((link) => (
              <FamilyCard
                key={link.id}
                link={link}
                contact={matchedContact(link)}
                confirmingRevoke={confirmRevokeId === link.id}
                revoking={revokingId === link.id}
                togglingEmergencyContact={togglingLinkId === link.id}
                togglingManageCaregivers={togglingCaregiverPermissionId === link.id}
                onRequestRevoke={() => setConfirmRevokeId(link.id)}
                onBackOut={() => setConfirmRevokeId(null)}
                onConfirmRevoke={() => handleRevoke(link.id)}
                onToggleEmergencyContact={() => handleToggleEmergencyContact(link)}
                onToggleManageCaregivers={() => handleToggleManageCaregivers(link)}
              />
            ))}

          {pendingLinks.length > 0 && (
            <>
              <Text style={styles.sectionHeading}>Waiting to accept</Text>
              {pendingLinks.map((link) => (
                <View key={link.id} style={styles.pendingCard}>
                  <Text style={styles.pendingName}>{link.familyUser?.fullName || 'Invited'}</Text>
                  {link.relationship ? <Text style={styles.pendingRelationship}>{link.relationship}</Text> : null}
                  <Text style={styles.pendingText}>Waiting for them to accept your invite.</Text>
                </View>
              ))}
            </>
          )}

          {!inviteOpen && (
            <Pressable
              style={({ pressed }) => [styles.inviteButton, pressed && styles.inviteButtonPressed]}
              onPress={() => setInviteOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Invite someone"
            >
              <Text style={styles.inviteButtonText}>+ Invite Someone</Text>
            </Pressable>
          )}

          {inviteOpen && (
            <View style={styles.inviteForm}>
              <Text style={styles.inviteFormTitle}>Invite Someone</Text>
              <Text style={styles.inviteFormHint}>They must already have an ElderCare account.</Text>

              {inviteError ? (
                <View style={styles.inviteErrorBanner}>
                  <Text style={styles.inviteErrorText}>{inviteError}</Text>
                </View>
              ) : null}

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Phone Number</Text>
                <View style={styles.phoneRow}>
                  <View style={styles.countryBadge}>
                    <Text style={styles.countryCode}>+91</Text>
                  </View>
                  <TextInput
                    style={[styles.input, styles.phoneInput, inviteFieldErrors.phone && styles.inputError]}
                    value={invitePhone}
                    onChangeText={setInvitePhone}
                    placeholder="10-digit mobile number"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="phone-pad"
                    autoCapitalize="none"
                    autoCorrect={false}
                    accessibilityLabel="Their phone number"
                  />
                </View>
                {inviteFieldErrors.phone ? <Text style={styles.fieldErrorText}>{inviteFieldErrors.phone}</Text> : null}
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>How are they related? (Optional)</Text>
                <TextInput
                  style={styles.input}
                  value={inviteRelationship}
                  onChangeText={setInviteRelationship}
                  placeholder="e.g. Daughter, Son, Neighbour"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="words"
                  accessibilityLabel="Relationship"
                />
              </View>

              <View style={styles.toggleRow}>
                <View style={styles.toggleTextGroup}>
                  <Text style={styles.toggleLabel}>They can see your location</Text>
                  <Text style={styles.toggleHint}>
                    Turn this off if you only want them to have access to your account, without seeing where you are.
                  </Text>
                </View>
                <Switch
                  value={inviteCanViewLocation}
                  onValueChange={setInviteCanViewLocation}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  accessibilityLabel="They can see your location"
                />
              </View>

              <View style={styles.toggleRow}>
                <View style={styles.toggleTextGroup}>
                  <Text style={styles.toggleLabel}>They can manage caregivers</Text>
                  <Text style={styles.toggleHint}>
                    Turn this on to let them book caregivers and manage care plans for you.
                  </Text>
                </View>
                <Switch
                  value={inviteCanManageCaregivers}
                  onValueChange={setInviteCanManageCaregivers}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  accessibilityLabel="They can manage caregivers"
                />
              </View>

              <View style={styles.inviteFormButtons}>
                <Pressable
                  style={({ pressed }) => [styles.inviteCancelButton, pressed && styles.inviteCancelButtonPressed]}
                  onPress={() => {
                    setInviteOpen(false);
                    setInviteError(null);
                    setInviteFieldErrors({});
                    setInviteCanManageCaregivers(false);
                  }}
                  accessibilityRole="button"
                >
                  <Text style={styles.inviteCancelButtonText}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.inviteSendButton, pressed && styles.inviteSendButtonPressed]}
                  onPress={handleSendInvite}
                  disabled={inviting}
                  accessibilityRole="button"
                >
                  {inviting ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={styles.inviteSendButtonText}>Send Invite</Text>}
                </Pressable>
              </View>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function FamilyCard({
  link,
  contact,
  confirmingRevoke,
  revoking,
  togglingEmergencyContact,
  togglingManageCaregivers,
  onRequestRevoke,
  onBackOut,
  onConfirmRevoke,
  onToggleEmergencyContact,
  onToggleManageCaregivers,
}) {
  const isEmergencyContact = !!contact;
  const displayName = link.familyUser?.fullName || 'Family member';

  return (
    <View style={styles.card}>
      <View style={styles.cardHeaderRow}>
        <Text style={styles.cardName}>{displayName}</Text>
        {link.relationship ? <Text style={styles.cardRelationship}>{link.relationship}</Text> : null}
        <View style={[styles.locationPill, link.canViewLocation ? styles.locationPillOn : styles.locationPillOff]}>
          <Text style={[styles.locationPillText, link.canViewLocation ? styles.locationPillTextOn : styles.locationPillTextOff]}>
            {link.canViewLocation ? 'Can see your location' : "Can't see your location"}
          </Text>
        </View>
      </View>

      <View style={styles.emergencyToggleRow}>
        <View style={styles.toggleTextGroup}>
          <Text style={styles.toggleLabel}>Also call them in an emergency</Text>
          <Text style={styles.toggleHint}>
            This is different from seeing your location. Turn this on to have them called if you press SOS.
          </Text>
        </View>
        {togglingEmergencyContact ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <Switch
            value={isEmergencyContact}
            onValueChange={onToggleEmergencyContact}
            trackColor={{ false: colors.border, true: colors.success }}
            accessibilityLabel="Also call them in an emergency"
          />
        )}
      </View>

      <View style={styles.emergencyToggleRow}>
        <View style={styles.toggleTextGroup}>
          <Text style={styles.toggleLabel}>Let them manage caregivers</Text>
          <Text style={styles.toggleHint}>
            They'll be able to book caregivers, edit care plans, and manage caregiver visits for you.
          </Text>
        </View>
        {togglingManageCaregivers ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <Switch
            value={!!link.canManageCaregivers}
            onValueChange={onToggleManageCaregivers}
            trackColor={{ false: colors.border, true: colors.success }}
            accessibilityLabel="Let them manage caregivers"
          />
        )}
      </View>

      {!revoking && !confirmingRevoke && (
        <Pressable onPress={onRequestRevoke} accessibilityRole="button" style={styles.removeButton}>
          <Text style={styles.removeButtonText}>Remove</Text>
        </Pressable>
      )}

      {!revoking && confirmingRevoke && (
        <View style={styles.confirmBlock}>
          <Text style={styles.confirmText}>
            Remove {displayName}? They'll no longer see where you are.
          </Text>
          <View style={styles.confirmButtons}>
            <Pressable onPress={onBackOut} accessibilityRole="button" style={styles.confirmNoButton}>
              <Text style={styles.confirmNoButtonText}>Keep Them</Text>
            </Pressable>
            <Pressable onPress={onConfirmRevoke} accessibilityRole="button" style={styles.confirmYesButton}>
              <Text style={styles.confirmYesButtonText}>Yes, Remove</Text>
            </Pressable>
          </View>
        </View>
      )}

      {revoking && <ActivityIndicator color={colors.danger} style={styles.spinner} />}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  fill: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl * 2 },
  backRow: { paddingVertical: spacing.xs },
  backText: { fontSize: type.body, color: colors.primary, fontWeight: '700' },
  title: { fontSize: type.title, fontWeight: '900', color: colors.text },
  subtitle: { fontSize: type.body, color: colors.textMuted, lineHeight: 23 },
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
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  emptyText: { fontSize: type.body, color: colors.textMuted, lineHeight: 23 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.md,
  },
  cardHeaderRow: { gap: 4 },
  cardName: { fontSize: type.heading, fontWeight: '800', color: colors.text },
  cardRelationship: { fontSize: type.small + 1, color: colors.textMuted, marginBottom: 2 },
  locationPill: { alignSelf: 'flex-start', borderRadius: 10, paddingVertical: 6, paddingHorizontal: 12 },
  locationPillOn: { backgroundColor: '#DCFCE7' },
  locationPillOff: { backgroundColor: '#F3F4F6' },
  locationPillText: { fontSize: type.body - 2, fontWeight: '800' },
  locationPillTextOn: { color: colors.success },
  locationPillTextOff: { color: colors.textMuted },
  emergencyToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
  },
  toggleTextGroup: { flex: 1, gap: 4 },
  toggleLabel: { fontSize: type.body - 1, fontWeight: '800', color: colors.text },
  toggleHint: { fontSize: type.small, color: colors.textMuted, lineHeight: 19 },
  removeButton: {
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.danger,
    paddingVertical: 12,
    alignItems: 'center',
  },
  removeButtonText: { fontSize: type.body - 1, fontWeight: '800', color: colors.danger },
  confirmBlock: { gap: spacing.sm },
  confirmText: { fontSize: type.body - 1, fontWeight: '700', color: colors.text, textAlign: 'center', lineHeight: 22 },
  confirmButtons: { gap: spacing.sm },
  confirmNoButton: {
    backgroundColor: colors.background,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  confirmNoButtonText: { fontSize: type.body - 1, fontWeight: '700', color: colors.text },
  confirmYesButton: { backgroundColor: colors.danger, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  confirmYesButtonText: { fontSize: type.body - 1, fontWeight: '800', color: '#FFFFFF' },
  pendingCard: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.border,
    padding: spacing.md,
    gap: 4,
  },
  pendingName: { fontSize: type.body, fontWeight: '800', color: colors.text },
  pendingRelationship: { fontSize: type.small, color: colors.textMuted },
  pendingText: { fontSize: type.small + 1, color: colors.textMuted },
  inviteButton: {
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  inviteButtonPressed: { backgroundColor: '#1D4ED8' },
  inviteButtonText: { fontSize: type.body, fontWeight: '800', color: '#FFFFFF' },
  inviteForm: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.md,
  },
  inviteFormTitle: { fontSize: type.heading, fontWeight: '800', color: colors.text },
  inviteFormHint: { fontSize: type.small + 1, color: colors.textMuted },
  inviteErrorBanner: { backgroundColor: '#FEE2E2', borderRadius: 10, padding: spacing.sm },
  inviteErrorText: { fontSize: type.small + 1, color: colors.danger, fontWeight: '700' },
  inputGroup: { gap: spacing.xs },
  label: { fontSize: type.body - 1, fontWeight: '700', color: colors.text },
  input: {
    backgroundColor: colors.background,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    fontSize: type.body,
    color: colors.text,
  },
  inputError: { borderColor: colors.danger },
  fieldErrorText: { fontSize: type.small, color: colors.danger, fontWeight: '600' },
  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  countryBadge: {
    backgroundColor: '#F3F4F6',
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
  },
  countryCode: { fontSize: type.body, fontWeight: '700', color: colors.text },
  phoneInput: { flex: 1 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  inviteFormButtons: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  inviteCancelButton: {
    flex: 1,
    backgroundColor: colors.background,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  inviteCancelButtonPressed: { backgroundColor: colors.border },
  inviteCancelButtonText: { fontSize: type.body - 1, fontWeight: '700', color: colors.text },
  inviteSendButton: { flex: 1, backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  inviteSendButtonPressed: { backgroundColor: '#1D4ED8' },
  inviteSendButtonText: { fontSize: type.body - 1, fontWeight: '800', color: '#FFFFFF' },
});
