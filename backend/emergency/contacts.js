// ============================================================================
// Emergency contacts — database access
//
// Same split as alerts.js: routes.js decides what is allowed, this file only
// knows how to read and write emergency_contacts rows.
//
// Delete is soft (is_active = FALSE), never a real DELETE — notifications.
// emergency_contact_id references this table, and a hard delete would either
// orphan that history or need ON DELETE SET NULL to erase which contact a
// past alert actually notified. fanout.js already reads only is_active = TRUE
// contacts, so a soft-deleted row simply stops being tried without losing the
// audit trail. There is no way to undo a delete through POST /emergency/contacts
// — a phone number that was deleted and re-added collides with
// uq_contact_per_user and is reported as contact_already_exists, same as any
// other duplicate. The one path that does revive a row is escalating a family
// link (see linkContactToUser below), because that toggle has to be able to
// turn back on after it was turned off.
// ============================================================================

import { query } from '../shared/db/pool.js';

export function toPublicContact(row) {
  return {
    id: row.id,
    userId: row.user_id,
    contactUserId: row.contact_user_id,
    fullName: row.full_name,
    phone: row.phone,
    email: row.email,
    relationship: row.relationship,
    priority: row.priority,
    notifyBySms: row.notify_by_sms,
    notifyByCall: row.notify_by_call,
    notifyByPush: row.notify_by_push,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Next open priority slot for a new contact. Shared by the hand-entered
 * create path (routes.js, below) and the family-link escalation path
 * (family/routes.js) — both append after whatever's already there rather than
 * letting a new contact jump ahead of ones ranked higher by hand. Clamped to
 * the column's own CHECK (priority BETWEEN 1 AND 10); past 10 contacts, new
 * ones share the last slot and fall back to created_at ordering among
 * themselves, an acceptable degrade rather than a case worth its own error.
 */
export async function nextContactPriority(userId) {
  const { rows } = await query(
    `SELECT COALESCE(MAX(priority), 0) + 1 AS next FROM emergency_contacts WHERE user_id = $1`,
    [userId]
  );
  return Math.min(rows[0].next, 10);
}

export async function findContactById(id) {
  const { rows } = await query(`SELECT * FROM emergency_contacts WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

/**
 * Backs the friendly pre-check both create paths run ahead of the real
 * uq_contact_per_user constraint (this is a query-then-insert, so a
 * concurrent request could still race past it — the constraint, caught in
 * routes.js, is what actually guarantees no duplicate, this is just the
 * common-case nicer error message).
 */
export async function findContactByPhone(userId, phone) {
  const { rows } = await query(
    `SELECT * FROM emergency_contacts WHERE user_id = $1 AND phone = $2`,
    [userId, phone]
  );
  return rows[0] ?? null;
}

/** The owning elderly user's contact list, in fanout order. Excludes soft-deleted rows. */
export async function listContactsForUser(userId) {
  const { rows } = await query(
    `SELECT * FROM emergency_contacts
      WHERE user_id = $1 AND is_active = TRUE
      ORDER BY priority ASC, created_at ASC`,
    [userId]
  );
  return rows;
}

/**
 * `contactUserId` defaults null — the normal case for a hand-entered contact
 * is a neighbour or doctor with no account at all. Only the escalate-a-link
 * path (family/routes.js) ever passes a real one.
 */
export async function createContact({
  userId,
  contactUserId = null,
  fullName,
  phone,
  email,
  relationship,
  priority,
  notifyBySms,
  notifyByCall,
  notifyByPush,
}) {
  const { rows } = await query(
    `INSERT INTO emergency_contacts (
       user_id, contact_user_id, full_name, phone, email, relationship, priority,
       notify_by_sms, notify_by_call, notify_by_push, is_active
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, TRUE)
     RETURNING *`,
    [userId, contactUserId, fullName, phone, email, relationship, priority, notifyBySms, notifyByCall, notifyByPush]
  );
  return rows[0];
}

/**
 * The escalate-a-link path's answer to a phone number that is already on
 * this user's list — a hand-entered row for the same person (contact_user_id
 * null), or one soft-deleted when "also call them in an emergency" was
 * turned off. uq_contact_per_user rules out inserting a second row, so this
 * points the existing one at the linked account and makes it active again.
 * Name, priority and notify flags are left as they were.
 */
export async function linkContactToUser(id, contactUserId) {
  const { rows } = await query(
    `UPDATE emergency_contacts SET contact_user_id = $2, is_active = TRUE WHERE id = $1 RETURNING *`,
    [id, contactUserId]
  );
  return rows[0] ?? null;
}

/**
 * Partial update — only columns present in `fields` are touched. Built
 * dynamically because any subset of the editable columns, including just
 * `priority` on its own for reordering, is a valid PATCH — there is no
 * separate reorder endpoint (see API.md).
 */
export async function updateContact(id, fields) {
  const columns = {
    fullName: 'full_name',
    phone: 'phone',
    email: 'email',
    relationship: 'relationship',
    priority: 'priority',
    notifyBySms: 'notify_by_sms',
    notifyByCall: 'notify_by_call',
    notifyByPush: 'notify_by_push',
  };

  const sets = [];
  const values = [];
  for (const [key, column] of Object.entries(columns)) {
    if (fields[key] !== undefined) {
      values.push(fields[key]);
      sets.push(`${column} = $${values.length}`);
    }
  }

  values.push(id);
  const { rows } = await query(
    `UPDATE emergency_contacts SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING *`,
    values
  );
  return rows[0] ?? null;
}

/** Soft delete — is_active = FALSE, row kept so notifications.emergency_contact_id still points at something real. */
export async function deactivateContact(id) {
  const { rows } = await query(
    `UPDATE emergency_contacts SET is_active = FALSE WHERE id = $1 RETURNING *`,
    [id]
  );
  return rows[0] ?? null;
}
