// ============================================================================
// Family link routes — mounted at /family
//
//   POST /family/invites                     invite a registered person as family
//   POST /family/invites/:id/accept          invitee accepts — activates the link only
//   POST /family/invites/:id/decline         invitee declines — see links.js
//   POST /family/links/:id/revoke            pull an active link
//   GET  /family/links                       the caller's own links, either side
//   POST /family/links/:id/emergency-contact escalate a linked family member to
//                                             contact status — deliberate, separate
//                                             from accepting the invite
//
// Phase 1: family_links invitations, approval, revocation, and the deliberate
// escalation to emergency-contact status. Emergency contact CRUD for
// hand-entered contacts lives at /emergency/contacts (emergency/routes.js),
// not here — see API.md.
//
// Accepting an invite does NOT auto-add the invitee as an emergency contact.
// Dashboard access (family_links) and being phoned during SOS
// (emergency_contacts) are different permissions on purpose — see the
// family_links comment in schema.sql — so promoting one to the other is its
// own deliberate action (POST .../emergency-contact below), not a side effect
// of accepting.
// ============================================================================

import { Router } from 'express';
import { badRequest, notFound, forbidden, conflict } from '../shared/http/errors.js';
import { requireAuth } from '../shared/auth/middleware.js';
import { findUserByPhone, findUserById, toPublicUser } from '../shared/auth/users.js';
import { createFeedItem } from '../notifications/feedWriter.js';
import { NOTIFICATION_EVENTS } from '../notifications/constants.js';
import {
  toPublicFamilyLink,
  findLinkById,
  findLinkByPair,
  findActiveLink,
  createOrReissueInvite,
  acceptInvite,
  declineInvite,
  revokeLink,
  deactivateLinkedContact,
  hasManageContactsPermission,
  updateLinkPermissions,
  listLinksForElderly,
  listLinksForFamily,
} from './links.js';
import {
  toPublicContact,
  findContactByPhone,
  createContact,
  linkContactToUser,
  nextContactPriority,
} from '../emergency/contacts.js';
import { validateInviteBody, validateListLinksQuery, validateUpdateLinkPermissionsBody } from './validate.js';

const PG_UNIQUE_VIOLATION = '23505';

export const familyRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireLinkId(req) {
  const { id } = req.params;
  if (!UUID_RE.test(id)) {
    throw badRequest('validation_failed', 'Link id is not a valid identifier.', {
      details: [{ field: 'id', message: 'Must be a UUID.' }],
    });
  }
  return id;
}

// ---------------------------------------------------------------------------
// POST /family/invites
//
// Either the elderly user invites for their own account, or an existing
// owner-level family member invites on the elderly person's behalf — the
// common real case being a family member who set the account up in the first
// place bringing in a sibling who has nothing installed. 'view'/'manage'
// family members cannot send invites; only 'owner' can.
// ---------------------------------------------------------------------------

familyRouter.post('/invites', requireAuth, async (req, res) => {
  const input = validateInviteBody(req.body);

  let elderlyUserId;
  if (req.user.role === 'elderly') {
    elderlyUserId = req.user.id;
  } else {
    if (!input.elderlyUserId) {
      throw badRequest('validation_failed', 'One or more fields are invalid.', {
        details: [{ field: 'elderlyUserId', message: 'Required when the caller is not the elderly user themselves.' }],
      });
    }
    const actingLink = await findActiveLink(req.user.id, input.elderlyUserId);
    if (!actingLink || actingLink.permission_level !== 'owner') {
      throw forbidden('not_permitted', 'Only the elderly user or an owner-level family member may send invites.');
    }
    elderlyUserId = input.elderlyUserId;
  }

  // The one hard limitation of this whole flow: there is no way to invite
  // someone who has not registered yet. See BUILD_LOG.md, "known
  // limitations" — this is a documented gap, not an overlooked check.
  const invitee = await findUserByPhone(input.phone);
  if (!invitee) {
    throw notFound(
      'invitee_not_registered',
      'No account exists for that phone number. The person must register before they can be invited.'
    );
  }

  if (invitee.id === elderlyUserId) {
    throw badRequest('validation_failed', 'One or more fields are invalid.', {
      details: [{ field: 'phone', message: 'This phone number belongs to the elderly user themselves.' }],
    });
  }

  const link = await createOrReissueInvite({
    elderlyUserId,
    familyUserId: invitee.id,
    relationship: input.relationship,
    permissionLevel: input.permissionLevel,
    canViewLocation: input.canViewLocation,
    canManageContacts: input.canManageContacts,
    canManageCaregivers: input.canManageCaregivers,
    canAcknowledgeAlerts: input.canAcknowledgeAlerts,
    invitedBy: req.user.id,
  });

  if (!link) {
    const existing = await findLinkByPair(elderlyUserId, invitee.id);
    if (existing.status === 'active') {
      throw conflict('already_linked', 'This person already has active access to this account.', {
        link: toPublicFamilyLink(existing),
      });
    }
    throw conflict('invite_already_pending', 'An invite is already pending for this person.', {
      link: toPublicFamilyLink(existing),
    });
  }

  createFeedItem({
    recipientUserIds: [invitee.id],
    eventType: NOTIFICATION_EVENTS.INVITE_RECEIVED,
    eventId: link.id,
    title: 'Family Invite Received',
    body: `You received a family link invitation from ${req.user.full_name || 'a user'}.`,
    data: { screen: 'FamilyInvites', params: { id: link.id } },
    sendPush: true,
  });

  res.status(201).json({ status: 'ok', link: toPublicFamilyLink(link) });
});

// ---------------------------------------------------------------------------
// POST /family/invites/:id/accept — invitee only.
//
// Activates the link. Nothing else — no emergency_contacts row is created
// here. That's a separate, deliberate action; see
// POST /family/links/:id/emergency-contact below.
// ---------------------------------------------------------------------------

familyRouter.post('/invites/:id/accept', requireAuth, async (req, res) => {
  const id = requireLinkId(req);

  const link = await findLinkById(id);
  if (!link) throw notFound('invite_not_found', 'No invite with that id.');

  if (link.family_user_id !== req.user.id) {
    throw forbidden('not_invitee', 'Only the invited person can accept this invite.');
  }

  const updated = await acceptInvite(id, req.user.id);
  if (!updated) {
    throw conflict('invite_not_pending', 'This invite is no longer pending.');
  }

  createFeedItem({
    recipientUserIds: [link.elderly_user_id],
    eventType: NOTIFICATION_EVENTS.INVITE_ACCEPTED,
    eventId: link.id,
    title: 'Family Invite Accepted',
    body: `${req.user.full_name || 'Family member'} accepted your family invitation.`,
    data: { screen: 'FamilyLinks', params: { id: link.id } },
    sendPush: true,
  });

  res.json({ status: 'ok', link: toPublicFamilyLink(updated) });
});

// ---------------------------------------------------------------------------
// POST /family/invites/:id/decline — invitee only
// ---------------------------------------------------------------------------

familyRouter.post('/invites/:id/decline', requireAuth, async (req, res) => {
  const id = requireLinkId(req);

  const link = await findLinkById(id);
  if (!link) throw notFound('invite_not_found', 'No invite with that id.');

  if (link.family_user_id !== req.user.id) {
    throw forbidden('not_invitee', 'Only the invited person can decline this invite.');
  }

  const updated = await declineInvite(id, req.user.id);
  if (!updated) {
    throw conflict('invite_not_pending', 'This invite is no longer pending.');
  }

  createFeedItem({
    recipientUserIds: [link.elderly_user_id],
    eventType: NOTIFICATION_EVENTS.INVITE_DECLINED,
    eventId: link.id,
    title: 'Family Invite Declined',
    body: `${req.user.full_name || 'Family member'} declined your family invitation.`,
    data: { screen: 'FamilyLinks', params: { id: link.id } },
    sendPush: true,
  });

  res.json({ status: 'ok', link: toPublicFamilyLink(updated) });
});

// ---------------------------------------------------------------------------
// POST /family/links/:id/revoke — the elderly user, the family member
// themselves (leaving), or an owner-level family member for that same
// elderly account.
// ---------------------------------------------------------------------------

familyRouter.post('/links/:id/revoke', requireAuth, async (req, res) => {
  const id = requireLinkId(req);

  const link = await findLinkById(id);
  if (!link) throw notFound('link_not_found', 'No family link with that id.');

  let permitted = req.user.id === link.elderly_user_id || req.user.id === link.family_user_id;

  if (!permitted) {
    const actingLink = await findActiveLink(req.user.id, link.elderly_user_id);
    permitted = !!actingLink && actingLink.permission_level === 'owner';
  }

  if (!permitted) {
    throw forbidden('not_permitted', 'You are not permitted to revoke this family link.');
  }

  const updated = await revokeLink(id);
  if (!updated) {
    throw conflict('link_not_active', 'This family link is not active.');
  }

  await deactivateLinkedContact(updated.elderly_user_id, updated.family_user_id);

  const targetRecipient = req.user.id === link.elderly_user_id ? link.family_user_id : link.elderly_user_id;
  createFeedItem({
    recipientUserIds: [targetRecipient],
    eventType: NOTIFICATION_EVENTS.LINK_REVOKED,
    eventId: link.id,
    title: 'Family Link Revoked',
    body: `Family link connection was revoked by ${req.user.full_name || 'user'}.`,
    data: { screen: 'FamilyLinks', params: { id: link.id } },
    sendPush: true,
  });

  res.json({ status: 'ok', link: toPublicFamilyLink(updated) });
});

// ---------------------------------------------------------------------------
// PATCH /family/links/:id — elderly user only. Edits an active link's
// permission fields without revoking it outright
// ---------------------------------------------------------------------------

familyRouter.patch('/links/:id', requireAuth, async (req, res) => {
  const id = requireLinkId(req);
  const patch = validateUpdateLinkPermissionsBody(req.body);

  const link = await findLinkById(id);
  if (!link) throw notFound('link_not_found', 'No family link with that id.');

  if (req.user.id !== link.elderly_user_id) {
    throw forbidden('not_permitted', "Only the elderly user can change a family member's permissions.");
  }

  const updated = await updateLinkPermissions(id, req.user.id, patch);
  if (!updated) {
    throw conflict('link_not_active', 'This family link is not active.');
  }

  createFeedItem({
    recipientUserIds: [link.family_user_id],
    eventType: NOTIFICATION_EVENTS.PERMISSIONS_CHANGED,
    eventId: link.id,
    title: 'Family Permissions Updated',
    body: `Your access permissions for the elderly care account have been updated.`,
    data: { screen: 'FamilyLinks', params: { id: link.id } },
    sendPush: true,
  });

  res.json({ status: 'ok', link: toPublicFamilyLink(updated) });
});

// ---------------------------------------------------------------------------
// GET /family/links — the caller's own links, from whichever side they're on.
// ---------------------------------------------------------------------------

familyRouter.get('/links', requireAuth, async (req, res) => {
  const { status } = validateListLinksQuery(req.query);

  const rows =
    req.user.role === 'elderly'
      ? await listLinksForElderly(req.user.id, status)
      : await listLinksForFamily(req.user.id, status);

  res.json({ status: 'ok', count: rows.length, links: rows.map(toPublicFamilyLink) });
});

// ---------------------------------------------------------------------------
// POST /family/links/:id/emergency-contact — promote link to contact
// ---------------------------------------------------------------------------

familyRouter.post('/links/:id/emergency-contact', requireAuth, async (req, res) => {
  const id = requireLinkId(req);

  const link = await findLinkById(id);
  if (!link) throw notFound('link_not_found', 'No family link with that id.');

  const permitted = await hasManageContactsPermission(req.user.id, link.elderly_user_id);
  if (!permitted) {
    throw forbidden('not_permitted', 'You are not permitted to manage contacts for this account.');
  }

  if (link.status !== 'active') {
    throw conflict('link_not_active', 'This family link is not active.');
  }

  const familyUser = toPublicUser(await findUserById(link.family_user_id));

  // findContactByPhone sees soft-deleted rows too. A hand-entered row for
  // this same phone (contact_user_id null), or this family member's own row
  // soft-deleted by turning the toggle off, is reused rather than reported
  // as a conflict — otherwise ManageFamilyScreen's toggle could never turn
  // on for them. Only an already-active linked row, or one linked to a
  // different account, is a real conflict.
  const existingContact = await findContactByPhone(link.elderly_user_id, familyUser.phone);
  const reusable =
    !!existingContact &&
    (existingContact.contact_user_id === null ||
      (existingContact.contact_user_id === link.family_user_id && !existingContact.is_active));
  if (existingContact && !reusable) {
    throw conflict(
      'contact_already_exists',
      'This person is already an emergency contact for this account.',
      { contact: toPublicContact(existingContact) }
    );
  }

  let contact;
  if (reusable) {
    contact = await linkContactToUser(existingContact.id, link.family_user_id);
  } else {
    const priority = await nextContactPriority(link.elderly_user_id);
    try {
      contact = await createContact({
        userId: link.elderly_user_id,
        contactUserId: link.family_user_id,
        fullName: familyUser.fullName,
        phone: familyUser.phone,
        email: familyUser.email,
        relationship: link.relationship,
        priority,
        notifyBySms: true,
        notifyByCall: true,
        notifyByPush: true,
      });
    } catch (err) {
      if (err.code === PG_UNIQUE_VIOLATION) {
        throw conflict('contact_already_exists', 'This person is already an emergency contact for this account.');
      }
      throw err;
    }
  }

  createFeedItem({
    recipientUserIds: [link.family_user_id],
    eventType: NOTIFICATION_EVENTS.PROMOTED_TO_CONTACT,
    eventId: link.id,
    title: 'Promoted to Emergency Contact',
    body: `You have been added as an emergency contact for an elderly user.`,
    data: { screen: 'EmergencyContacts', params: { id: contact.id } },
    sendPush: true,
  });

  res.status(reusable ? 200 : 201).json({ status: 'ok', contact: toPublicContact(contact) });
});
