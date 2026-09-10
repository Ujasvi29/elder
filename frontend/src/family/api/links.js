// ============================================================================
// Family link endpoints
//
// One function per endpoint in API.md's "Family Links" section — a screen
// never writes a URL, same pattern as emergency/api/alerts.js.
//
// family_links controls dashboard access (who can see this account). It is
// deliberately separate from emergency_contacts (who gets called during
// SOS) — see promoteToEmergencyContact below, the one deliberate bridge
// between the two.
// ============================================================================

import { apiRequest } from '../../shared/api/client';

/**
 * POST /family/invites — invite a registered person as family, by phone.
 * The invitee must already have an account; a 404 `invitee_not_registered`
 * means they don't.
 *
 * @param {object} input
 * @param {string} input.phone               as typed; the server normalises it
 * @param {string} [input.relationship]       free text, e.g. "daughter"
 * @param {boolean} [input.canViewLocation]   default true — the elderly user
 *   chooses this at invite time, see ManageFamilyScreen
 * @param {boolean} [input.canManageCaregivers] default false — whether they can
 *   manage care plans and caregiver visits (booking needs only an active link)
 */
export function sendInvite({ phone, relationship, canViewLocation, canManageCaregivers }) {
  return apiRequest('/family/invites', {
    method: 'POST',
    body: {
      phone,
      relationship: relationship || undefined,
      canViewLocation: canViewLocation ?? undefined,
      canManageCaregivers: canManageCaregivers ?? undefined,
    },
  });
}

/** POST /family/invites/:id/accept — invitee only. Activates the link, nothing else. */
export function acceptInvite(id) {
  return apiRequest(`/family/invites/${id}/accept`, { method: 'POST' });
}

/** POST /family/invites/:id/decline — invitee only. */
export function declineInvite(id) {
  return apiRequest(`/family/invites/${id}/decline`, { method: 'POST' });
}

/**
 * POST /family/links/:id/revoke — pulls an active link. Permitted: the
 * elderly user, the family member themselves (leaving), or an owner-level
 * family member. Also deactivates the matching emergency-contact row, if
 * this link was ever promoted — see promoteToEmergencyContact.
 */
export function revokeLink(id) {
  return apiRequest(`/family/links/${id}/revoke`, { method: 'POST' });
}

/**
 * GET /family/links — the caller's own links, either side.
 * @param {{ status?: 'pending' | 'active' | 'revoked' }} [options]
 */
export function listLinks({ status } = {}) {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  const query = params.toString();
  return apiRequest(`/family/links${query ? `?${query}` : ''}`);
}

/**
 * POST /family/links/:id/emergency-contact — the deliberate, separate
 * action that promotes an active link to "also call this person during
 * SOS." Copies the family member's current name/phone/email onto a new
 * emergency_contacts row; not a live reference (see API.md's known
 * limitations — EmergencyContactsScreen surfaces this).
 */
export function promoteToEmergencyContact(linkId) {
  return apiRequest(`/family/links/${linkId}/emergency-contact`, { method: 'POST' });
}

/**
 * PATCH /family/links/:id — elderly-only. Edits an active link's permission
 * fields without revoking it — same idea as the emergency-contact toggle,
 * a second independent dial on the same relationship. Used by
 * ManageFamilyScreen for `canManageCaregivers` ("let them manage care
 * plans and caregiver visits for you"); any of the other permission
 * fields work the same way if a screen needs them later.
 */
export function updateLinkPermissions(linkId, patch) {
  return apiRequest(`/family/links/${linkId}`, { method: 'PATCH', body: patch });
}
