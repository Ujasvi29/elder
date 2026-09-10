// ============================================================================
// Admin — user queries
//
// Every query an admin endpoint needs against the `users` table (and
// optionally `caregivers` for verification-status context). Separated from
// shared/auth/users.js: those lookups serve login and session middleware and
// never return cross-user result sets.
// ============================================================================

import { query } from '../../shared/db/pool.js';

/**
 * Maps a snake_case user row to the camelCase shape admin endpoints return.
 * Deliberately excludes password_hash (never selected) and includes fields
 * the admin view needs that toPublicUser in shared/auth/users.js omits
 * (date_of_birth, city, phone — all useful on a user-management screen).
 */
export function toAdminUser(row) {
  return {
    id: row.id,
    phone: row.phone,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    dateOfBirth: row.date_of_birth,
    city: row.city,
    profilePhotoUrl: row.profile_photo_url,
    isActive: row.is_active,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    // Present only when the row is a caregiver and the LEFT JOIN hit.
    verificationStatus: row.verification_status ?? null,
  };
}

/**
 * Paginated, filterable, searchable user listing for the admin dashboard.
 *
 * Filters:
 *   q       — ILIKE search across full_name, email, and phone
 *   role    — exact match on user_role enum
 *   active  — boolean filter on is_active
 *
 * Sorting is newest-first (created_at DESC), same order the existing
 * GET /auth/admin/users stub used. LEFT JOIN to caregivers so the admin
 * can see verification_status inline for caregiver-role users without a
 * second round-trip.
 */
export async function listUsers({ q, role, active, page = 1, limit = 25 }) {
  const conditions = [];
  const params = [];

  if (q && q.trim()) {
    const term = `%${q.trim().toLowerCase()}%`;
    params.push(term);
    conditions.push(
      `(LOWER(u.full_name) LIKE $${params.length} OR LOWER(u.email) LIKE $${params.length} OR u.phone LIKE $${params.length})`
    );
  }

  if (role) {
    params.push(role);
    conditions.push(`u.role = $${params.length}`);
  }

  if (active !== undefined) {
    params.push(active);
    conditions.push(`u.is_active = $${params.length}`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const offset = (Math.max(1, page) - 1) * Math.max(1, limit);

  // Count total matching users for pagination metadata.
  const countSql = `SELECT COUNT(*) AS total FROM users u ${whereClause}`;
  const { rows: countRows } = await query(countSql, params);
  const total = parseInt(countRows[0]?.total || 0, 10);

  // Data query with LEFT JOIN to caregivers for verification_status.
  params.push(limit);
  const limitParam = params.length;
  params.push(offset);
  const offsetParam = params.length;

  const dataSql = `
    SELECT u.id, u.phone, u.email, u.full_name, u.role,
           u.date_of_birth, u.city, u.profile_photo_url,
           u.is_active, u.last_login_at, u.created_at,
           c.verification_status
      FROM users u
      LEFT JOIN caregivers c ON c.user_id = u.id
    ${whereClause}
    ORDER BY u.created_at DESC
    LIMIT $${limitParam} OFFSET $${offsetParam}
  `;
  const { rows } = await query(dataSql, params);

  return {
    total,
    page: parseInt(page, 10),
    limit: parseInt(limit, 10),
    users: rows.map(toAdminUser),
  };
}

/**
 * Single-user detail for the admin view. Same shape as listUsers rows,
 * with the addition of address and state fields useful on a detail screen.
 */
export async function findUserForAdmin(userId) {
  const { rows } = await query(
    `SELECT u.id, u.phone, u.email, u.full_name, u.role,
            u.date_of_birth, u.gender, u.preferred_language,
            u.profile_photo_url, u.address_line, u.city, u.state, u.postal_code,
            u.is_active, u.last_login_at, u.created_at, u.updated_at,
            c.verification_status
       FROM users u
       LEFT JOIN caregivers c ON c.user_id = u.id
      WHERE u.id = $1`,
    [userId]
  );
  if (!rows[0]) return null;

  const row = rows[0];
  return {
    id: row.id,
    phone: row.phone,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    dateOfBirth: row.date_of_birth,
    gender: row.gender,
    preferredLanguage: row.preferred_language,
    profilePhotoUrl: row.profile_photo_url,
    addressLine: row.address_line,
    city: row.city,
    state: row.state,
    postalCode: row.postal_code,
    isActive: row.is_active,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    verificationStatus: row.verification_status ?? null,
  };
}

/**
 * Toggle a user's is_active flag. Returns the updated user, or null if
 * no user with that id exists.
 *
 * Does not allow deactivating the caller's own account — the route layer
 * enforces this, not the query, so this function stays a pure data accessor.
 */
export async function setUserActiveStatus(userId, isActive) {
  const { rows } = await query(
    `UPDATE users SET is_active = $2 WHERE id = $1
     RETURNING id, phone, email, full_name, role, date_of_birth, city,
               profile_photo_url, is_active, last_login_at, created_at`,
    [userId, isActive]
  );
  if (!rows[0]) return null;
  return toAdminUser(rows[0]);
}
