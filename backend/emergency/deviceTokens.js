// ============================================================================
// Device tokens — database access
//
// Registers the Expo push token for the calling user's device. Was listed in
// API.md's "Not yet built" since Phase 0; nothing populated device_tokens
// until this step, which is why push had no destinations to send to before
// now.
// ============================================================================

import { query } from '../shared/db/pool.js';

function toPublicDeviceToken(row) {
  return {
    id: row.id,
    userId: row.user_id,
    platform: row.platform,
    deviceName: row.device_name,
    isActive: row.is_active,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
  };
}

/**
 * Upserts on the token itself (UNIQUE in the schema), not on (user, device) —
 * the same physical token can only ever belong to one user at a time, so a
 * reinstall or an account switch on the same device correctly reassigns it
 * rather than creating a duplicate.
 */
export async function registerDeviceToken(userId, { expoPushToken, previousExpoPushToken, platform, deviceName, deviceModel, appVersion, osVersion }) {
  // If rotating from an old token on this device, deactivate the previous token
  // scoped strictly to this authenticated user. Other devices belonging to this user
  // or other users are untouched.
  if (previousExpoPushToken && previousExpoPushToken !== expoPushToken) {
    await query(
      `UPDATE device_tokens
          SET is_active = FALSE,
              updated_at = now()
        WHERE expo_push_token = $1 AND user_id = $2 AND is_active = TRUE`,
      [previousExpoPushToken, userId]
    );
  }

  const { rows } = await query(
    `INSERT INTO device_tokens
       (user_id, expo_push_token, platform, device_name, device_model, app_version, os_version, is_active, last_seen_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, now())
     ON CONFLICT (expo_push_token) DO UPDATE
        SET user_id      = EXCLUDED.user_id,
            platform     = EXCLUDED.platform,
            device_name  = EXCLUDED.device_name,
            device_model = EXCLUDED.device_model,
            app_version  = EXCLUDED.app_version,
            os_version   = EXCLUDED.os_version,
            is_active    = TRUE,
            last_seen_at = now()
     RETURNING *`,
    [userId, expoPushToken, platform, deviceName ?? null, deviceModel ?? null, appVersion ?? null, osVersion ?? null]
  );
  return toPublicDeviceToken(rows[0]);
}

/**
 * Deactivates a push token scoped strictly to both the specific expoPushToken
 * and the authenticated user's ID. Prevents cross-user deactivation and leaves
 * other devices belonging to the user untouched.
 *
 * @param {string} userId - Authenticated user UUID
 * @param {string} expoPushToken - Device's Expo push token string
 * @returns {Promise<boolean>} True if matching token row was deactivated, false otherwise
 */
export async function deactivateDeviceTokenForUser(userId, expoPushToken) {
  const { rows } = await query(
    `UPDATE device_tokens
        SET is_active = FALSE,
            updated_at = now()
      WHERE expo_push_token = $1 AND user_id = $2 AND is_active = TRUE
      RETURNING id`,
    [expoPushToken, userId]
  );
  return rows.length > 0;
}

/**
 * Deactivates an invalid/dead token reported by push provider (e.g. DeviceNotRegistered).
 * Idempotent: safe to call multiple times for the same token.
 *
 * @param {string} expoPushToken - Device's Expo push token string
 * @param {Object} [options]
 * @param {string} [options.reason='DeviceNotRegistered']
 * @returns {Promise<boolean>} True if matching token row was deactivated, false otherwise
 */
export async function deactivateStaleToken(expoPushToken, { reason = 'DeviceNotRegistered' } = {}) {
  const { rows } = await query(
    `UPDATE device_tokens
        SET is_active = FALSE,
            failure_count = failure_count + 1,
            updated_at = now()
      WHERE expo_push_token = $1 AND is_active = TRUE
      RETURNING id, user_id, is_active, failure_count`,
    [expoPushToken]
  );
  return rows.length > 0;
}

/**
 * Periodic cleanup of stale tokens with high failure counts or long inactivity.
 * Idempotently marks them is_active = FALSE.
 *
 * @param {Object} [options]
 * @param {number} [options.inactiveDays=90]
 * @param {number} [options.maxFailures=5]
 * @returns {Promise<Array>} List of deactivated token rows
 */
export async function cleanStaleTokens({ inactiveDays = 90, maxFailures = 5 } = {}) {
  const { rows } = await query(
    `UPDATE device_tokens
        SET is_active = FALSE,
            updated_at = now()
      WHERE is_active = TRUE
        AND (
          failure_count >= $1
          OR (last_seen_at IS NOT NULL AND last_seen_at < now() - ($2 || ' days')::interval)
        )
      RETURNING id, expo_push_token, user_id`,
    [maxFailures, inactiveDays]
  );
  return rows;
}
