// ============================================================================
// Family links — database access
//
// Same split as emergency/alerts.js: routes.js decides what is allowed, this
// file only knows how to read and write family_links rows.
//
// A family_links row moves through at most these states:
//
//   (none) --invite--> pending --accept--> active --revoke--> revoked
//                          \--decline----------------------> revoked
//
// 'revoked' is reused for both "declined" and "access pulled after being
// active" — link_status has no separate 'declined' value, and adding one is a
// migration this feature does not need just to name a state that behaves
// identically to revoked everywhere it matters: dead link, re-invitable via
// createOrReissueInvite. See declineInvite for the point this is decided.
// ============================================================================

import { query } from '../shared/db/pool.js';

export function toPublicFamilyLink(row) {
  const link = {
    id: row.id,
    elderlyUserId: row.elderly_user_id,
    familyUserId: row.family_user_id,
    relationship: row.relationship,
    permissionLevel: row.permission_level,
    canViewLocation: row.can_view_location,
    canManageContacts: row.can_manage_contacts,
    // Enforced by caregiver module routes via hasManageCaregiversPermission —
    // a family member must have this true on their active link to manage
    // caregivers on the elderly person's behalf. Creating a booking is the
    // exception: any active link may (bookings.routes.js).
    canManageCaregivers: row.can_manage_caregivers,
    canAcknowledgeAlerts: row.can_acknowledge_alerts,
    status: row.status,
    invitedBy: row.invited_by,
    approvedAt: row.approved_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

  // Only present when the row came from listLinksForElderly/listLinksForFamily
  // below, which join `users` for exactly this — a plain family_links row (an
  // invite just created or accepted, say) has no full_name/phone to attach and
  // these keys are simply omitted rather than sent null. `relationship` alone
  // cannot tell two family members apart, and is often blank; this is the
  // caller's-eye-view name for whichever side of the link isn't them.
  if (row.family_full_name !== undefined) {
    link.familyUser = { fullName: row.family_full_name, phone: row.family_phone };
  }
  if (row.elderly_full_name !== undefined) {
    link.elderlyUser = { fullName: row.elderly_full_name, phone: row.elderly_phone };
  }

  return link;
}

export async function findLinkById(id) {
  const { rows } = await query(`SELECT * FROM family_links WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

/** The one row (if any) for this elderly/family pair, regardless of status. */
export async function findLinkByPair(elderlyUserId, familyUserId) {
  const { rows } = await query(
    `SELECT * FROM family_links WHERE elderly_user_id = $1 AND family_user_id = $2`,
    [elderlyUserId, familyUserId]
  );
  return rows[0] ?? null;
}

/** This family member's active link to one elderly user — permission checks read this. */
export async function findActiveLink(familyUserId, elderlyUserId) {
  const { rows } = await query(
    `SELECT * FROM family_links
      WHERE family_user_id = $1 AND elderly_user_id = $2 AND status = 'active'`,
    [familyUserId, elderlyUserId]
  );
  return rows[0] ?? null;
}

/**
 * Creates a pending invite, or reissues one over a row this same pair used
 * before and then declined or had revoked. (elderly_user_id, family_user_id)
 * is UNIQUE, so a second invite to the same pair cannot insert a second row —
 * it must reuse the one that already exists.
 *
 * The `WHERE family_links.status = 'revoked'` clause on the update is what
 * makes that reuse conditional: it only fires over a dead link. An existing
 * 'pending' or 'active' row for the same pair is left completely untouched —
 * DO UPDATE runs a no-op, RETURNING gives back zero rows, and the caller in
 * routes.js re-reads that row to report the correct conflict (already
 * pending vs. already linked) rather than silently overwriting it.
 */
export async function createOrReissueInvite({
  elderlyUserId,
  familyUserId,
  relationship,
  permissionLevel,
  canViewLocation,
  canManageContacts,
  canManageCaregivers,
  canAcknowledgeAlerts,
  invitedBy,
}) {
  const { rows } = await query(
    `INSERT INTO family_links (
       elderly_user_id, family_user_id, relationship, permission_level,
       can_view_location, can_manage_contacts, can_manage_caregivers, can_acknowledge_alerts,
       status, invited_by
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9)
     ON CONFLICT (elderly_user_id, family_user_id) DO UPDATE
        SET relationship           = EXCLUDED.relationship,
            permission_level       = EXCLUDED.permission_level,
            can_view_location      = EXCLUDED.can_view_location,
            can_manage_contacts    = EXCLUDED.can_manage_contacts,
            can_manage_caregivers  = EXCLUDED.can_manage_caregivers,
            can_acknowledge_alerts = EXCLUDED.can_acknowledge_alerts,
            status                 = 'pending',
            invited_by             = EXCLUDED.invited_by,
            approved_at            = NULL,
            revoked_at             = NULL
      WHERE family_links.status = 'revoked'
     RETURNING *`,
    [
      elderlyUserId,
      familyUserId,
      relationship,
      permissionLevel,
      canViewLocation,
      canManageContacts,
      canManageCaregivers,
      canAcknowledgeAlerts,
      invitedBy,
    ]
  );
  return rows[0] ?? null;
}

export async function acceptInvite(id, familyUserId) {
  const { rows } = await query(
    `UPDATE family_links
        SET status = 'active', approved_at = now()
      WHERE id = $1 AND family_user_id = $2 AND status = 'pending'
      RETURNING *`,
    [id, familyUserId]
  );
  return rows[0] ?? null;
}

/**
 * Declining an invite sets status = 'revoked' rather than a dedicated
 * 'declined' value — link_status (schema.sql) has no such value. This is a
 * deliberate semantic stretch, not an oversight: a declined invite was never
 * active, so calling it "revoked" isn't literally true, but it behaves
 * identically to a real revocation everywhere that matters — the link is
 * dead, and createOrReissueInvite can bring it back exactly the same way
 * either kind of dead link gets re-invited. Adding a real 'declined' enum
 * value would need a migration this feature doesn't otherwise need.
 */
export async function declineInvite(id, familyUserId) {
  const { rows } = await query(
    `UPDATE family_links
        SET status = 'revoked', revoked_at = now()
      WHERE id = $1 AND family_user_id = $2 AND status = 'pending'
      RETURNING *`,
    [id, familyUserId]
  );
  return rows[0] ?? null;
}

export async function revokeLink(id) {
  const { rows } = await query(
    `UPDATE family_links
        SET status = 'revoked', revoked_at = now()
      WHERE id = $1 AND status = 'active'
      RETURNING *`,
    [id]
  );
  return rows[0] ?? null;
}

/**
 * Revoking a link also deactivates the emergency_contacts row that link's
 * "add as emergency contact" action (POST /family/links/:id/emergency-contact,
 * family/routes.js) created, if that action was ever taken. Deliberate
 * default: leaving a phone-escalation path open to someone whose dashboard
 * access was just pulled for cause is the wrong default for an emergency
 * product.
 *
 * Matches on (user_id, contact_user_id) rather than the link's own id — there
 * is no foreign key from emergency_contacts back to family_links — so this
 * only ever touches a row actually linked to this family member's account,
 * never a hand-entered contact that happens to be the same person under a
 * different phone number. A no-op if that action was never taken for this
 * link, which is the common case now that accepting an invite no longer does
 * this automatically.
 */
export async function deactivateLinkedContact(elderlyUserId, familyUserId) {
  await query(
    `UPDATE emergency_contacts
        SET is_active = FALSE
      WHERE user_id = $1 AND contact_user_id = $2 AND is_active = TRUE`,
    [elderlyUserId, familyUserId]
  );
}

/**
 * Shared by /emergency/contacts (elderly-or-permitted-family-member contact
 * management) and POST /family/links/:id/emergency-contact (escalating a
 * link to contact status): true for the elderly user themselves, or for a
 * family member with an active link to that elderly user and
 * can_manage_contacts = true.
 */
export async function hasManageContactsPermission(actorUserId, elderlyUserId) {
  if (actorUserId === elderlyUserId) return true;
  const link = await findActiveLink(actorUserId, elderlyUserId);
  return !!link && link.can_manage_contacts === true;
}

/**
 * Joins `users` on family_user_id so the caller — the elderly user — gets
 * the linked family member's current name and phone, not just their id and
 * whatever `relationship` free text was typed at invite time (often blank,
 * and useless for telling two family members apart if it isn't). Read at
 * request time, not copied — unlike the emergency_contacts snapshot in
 * routes.js's .../emergency-contact, this always reflects the account's
 * current name.
 */
/**
 * Read access to an elderly user's location data: the elderly user
 * themselves, or a family member with an active link and
 * can_view_location = true. Backs GET /emergency/geofences (a safe zone is
 * location data, gated the same way any other location data already is) and
 * GET /emergency/locations/latest (Phase 3 step 3's "last known location"
 * zone-centre flow).
 */
export async function hasViewLocationPermission(actorUserId, elderlyUserId) {
  if (actorUserId === elderlyUserId) return true;
  const link = await findActiveLink(actorUserId, elderlyUserId);
  return !!link && link.can_view_location === true;
}

/**
 * Write access (create/edit/delete a zone): the same can_view_location gate
 * as read, plus permission_level 'manage' or 'owner' — the first real use of
 * 'manage', which existed in the enum but gated nothing until now (only
 * 'owner' has ever been checked anywhere, for sending invites and revoking
 * on someone else's behalf). can_view_location is required on top of the
 * tier check so a family member can never define boundaries around a
 * location they aren't themselves permitted to see.
 */
export async function hasManageGeofencesPermission(actorUserId, elderlyUserId) {
  if (actorUserId === elderlyUserId) return true;
  const link = await findActiveLink(actorUserId, elderlyUserId);
  return (
    !!link &&
    link.can_view_location === true &&
    (link.permission_level === 'manage' || link.permission_level === 'owner')
  );
}

/**
 * Read+write access to the caregiver module (bookings, schedules, care
 * plans, tasks, activity reports, verifying attendance) on an elderly user's
 * behalf — except creating a booking, which bookings.routes.js allows for
 * any active link: the elderly user themselves, or a family member with an active
 * link and can_manage_caregivers = true. One flag rather than the
 * view/manage split geofences uses — the caregiver module has no separate
 * "can see but not act" tier today, only "participates in this person's
 * caregiver arrangement or doesn't." can_manage_caregivers already existed
 * on family_links and was grantable via POST /family/invites and PATCH
 * /family/links/:id before this — it just gated nothing yet.
 */
export async function hasManageCaregiversPermission(actorUserId, elderlyUserId) {
  if (actorUserId === elderlyUserId) return true;
  const link = await findActiveLink(actorUserId, elderlyUserId);
  return (
    !!link &&
    link.can_manage_caregivers === true
  );
}

/**
 * Elderly-only edit of an active link's permission fields — this is the
 * surgical undo for granting 'manage'/'owner' (geofence-write access, among
 * other things): step the tier back down without severing the whole
 * relationship the way POST /links/:id/revoke does. Scoped to
 * (id, elderly_user_id, status='active') in the WHERE clause itself, not a
 * separate ownership check — only the elderly user who owns this link can
 * ever match, and a revoked or pending link can't be edited this way either.
 * An owner-tier family member editing another family member's permissions on
 * the elderly user's behalf is not built here — see API.md.
 */
export async function updateLinkPermissions(id, elderlyUserId, fields) {
  const columns = {
    permissionLevel: 'permission_level',
    canViewLocation: 'can_view_location',
    canManageContacts: 'can_manage_contacts',
    canManageCaregivers: 'can_manage_caregivers',
    canAcknowledgeAlerts: 'can_acknowledge_alerts',
  };

  const sets = [];
  const values = [];
  for (const [key, column] of Object.entries(columns)) {
    if (fields[key] !== undefined) {
      values.push(fields[key]);
      sets.push(`${column} = $${values.length}`);
    }
  }

  values.push(id, elderlyUserId);
  const { rows } = await query(
    `UPDATE family_links SET ${sets.join(', ')}
      WHERE id = $${values.length - 1} AND elderly_user_id = $${values.length} AND status = 'active'
      RETURNING *`,
    values
  );
  return rows[0] ?? null;
}

export async function listLinksForElderly(elderlyUserId, status) {
  const { rows } = await query(
    status
      ? `SELECT fl.*, u.full_name AS family_full_name, u.phone AS family_phone
           FROM family_links fl
           JOIN users u ON u.id = fl.family_user_id
          WHERE fl.elderly_user_id = $1 AND fl.status = $2
          ORDER BY fl.created_at DESC`
      : `SELECT fl.*, u.full_name AS family_full_name, u.phone AS family_phone
           FROM family_links fl
           JOIN users u ON u.id = fl.family_user_id
          WHERE fl.elderly_user_id = $1
          ORDER BY fl.created_at DESC`,
    status ? [elderlyUserId, status] : [elderlyUserId]
  );
  return rows;
}

/** Same idea as listLinksForElderly, joined the other way: the elderly account's name/phone for a family caller. */
export async function listLinksForFamily(familyUserId, status) {
  const { rows } = await query(
    status
      ? `SELECT fl.*, u.full_name AS elderly_full_name, u.phone AS elderly_phone
           FROM family_links fl
           JOIN users u ON u.id = fl.elderly_user_id
          WHERE fl.family_user_id = $1 AND fl.status = $2
          ORDER BY fl.created_at DESC`
      : `SELECT fl.*, u.full_name AS elderly_full_name, u.phone AS elderly_phone
           FROM family_links fl
           JOIN users u ON u.id = fl.elderly_user_id
          WHERE fl.family_user_id = $1
          ORDER BY fl.created_at DESC`,
    status ? [familyUserId, status] : [familyUserId]
  );
  return rows;
}
