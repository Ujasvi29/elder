// ============================================================================
// Push token registration & deactivation — generic device capability, no
// ElderCare-specific knowledge of what a notification means once it arrives.
//
// Unlike location (captureLocation.js), this doesn't show a custom
// plain-language rationale before the OS prompt — a notification permission
// is a much more familiar, lower-stakes ask than background location, and the
// product requirement didn't call for one here the way it did for GPS.
//
// Token lifecycle:
//   login  → registerForPushNotifications  → token cached + sent to backend
//   logout → unregisterForPushNotifications → cached token used to call
//            DELETE /emergency/device-tokens, then cache cleared.
//
// The logout path deliberately never calls getExpoPushTokenAsync: it must not
// request permissions, generate tokens, or depend on push infrastructure.
// If no cached token exists (registration was skipped or failed), deactivation
// is silently skipped and logout proceeds normally.
// ============================================================================

import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { apiRequest } from '../api/client';

// ---------------------------------------------------------------------------
// Local token cache — module-scoped, survives across renders but not app
// restarts. That's fine: if the app was killed and relaunched, the restore
// flow in AuthContext re-runs registerForPushNotifications which repopulates
// this. The only consumer of the cache is unregisterForPushNotifications at
// logout time, which is always preceded by a successful sign-in (and thus a
// successful registration) in the same app session.
// ---------------------------------------------------------------------------

let cachedExpoPushToken = null;

/** Exposed for testing/debugging only — not for production UI consumption. */
export function getCachedPushToken() {
  return cachedExpoPushToken;
}

/**
 * Requests permission if not already granted, gets this device's Expo push
 * token, and registers it with the backend. Returns the token, or null if
 * any step couldn't complete — permission denied, no EAS projectId configured
 * yet, or running on a simulator/emulator (push tokens don't exist there).
 * Never throws: registering for push is enrichment, not something that
 * should interrupt sign-in.
 */
export async function registerForPushNotifications() {
  if (!Device.isDevice) return null;

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== 'granted') {
    const requested = await Notifications.requestPermissionsAsync();
    status = requested.status;
  }
  if (status !== 'granted') return null;

  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId) {
    // Expected until `eas init` has been run once — see app.config.js's
    // "extra" comment. Not an error: the rest of the app works without it.
    console.warn('No EAS projectId configured — skipping push registration. See app.config.js.');
    return null;
  }

  let expoPushToken;
  try {
    const result = await Notifications.getExpoPushTokenAsync({ projectId });
    expoPushToken = result.data;
  } catch (err) {
    console.warn('Could not get an Expo push token:', err.message);
    return null;
  }

  try {
    await apiRequest('/emergency/device-tokens', {
      method: 'POST',
      body: {
        expoPushToken,
        platform: Platform.OS,
        deviceName: Device.deviceName ?? undefined,
        deviceModel: Device.modelName ?? undefined,
        osVersion: Device.osVersion != null ? String(Device.osVersion) : undefined,
      },
    });
  } catch (err) {
    // Backend unreachable, or the token was rejected — either way, the app
    // itself is unaffected. Whatever called this can retry another time.
    console.warn('Could not register push token with the backend:', err.message);
  }

  // Cache after everything succeeds or at least after the token was obtained.
  // Even if the backend POST failed, the token itself is valid and should be
  // deactivated on logout (the backend row may have been written on a previous
  // session and is still active).
  cachedExpoPushToken = expoPushToken;

  return expoPushToken;
}

/**
 * Deactivates this device's push token on the backend and clears the local
 * cache. Called during sign-out.
 *
 * Design constraints (see B3 audit fix prompt):
 *   - Uses ONLY the locally cached token — never calls getExpoPushTokenAsync.
 *   - If no cached token exists, skips deactivation silently.
 *   - Always clears the cache, regardless of backend response.
 *   - Never throws: a failed deactivation must not block or delay logout.
 */
export async function unregisterForPushNotifications() {
  const token = cachedExpoPushToken;

  // Always clear the cache, even if the DELETE call below fails — the user is
  // logging out and the token must not linger locally.
  cachedExpoPushToken = null;

  if (!token) {
    // Registration was skipped (simulator, permission denied, no projectId) or
    // the app was relaunched and restore hasn't run registerForPush yet. Either
    // way, there's nothing to deactivate.
    return;
  }

  try {
    await apiRequest('/emergency/device-tokens', {
      method: 'DELETE',
      body: { expoPushToken: token },
    });
  } catch (err) {
    // Offline, backend down, token already deactivated, or the row was already
    // reassigned to a different user (account switch). None of these should
    // prevent logout from completing.
    console.warn('Could not deactivate push token on logout:', err.message);
  }
}

/**
 * Sets up a listener for push token rotation events emitted by Expo Notifications.
 * When Expo rotates or issues a new token:
 *   - Checks that the token has actually changed (avoids redundant calls).
 *   - Registers the new token with the backend, passing previousExpoPushToken
 *     so the backend deactivates the old token for this user.
 *   - Preserves other active devices for the user.
 *   - Updates cachedExpoPushToken.
 *   - Catches errors gracefully so rotation failure never crashes the app or blocks auth.
 *
 * @returns {{ remove: () => void }} Subscription cleanup handle
 */
export function setupPushTokenRotationListener() {
  const subscription = Notifications.addPushTokenListener(async (tokenEvent) => {
    try {
      const newToken = typeof tokenEvent === 'string' ? tokenEvent : tokenEvent?.data;
      if (!newToken || newToken === cachedExpoPushToken) {
        return; // No change, ignore redundant event
      }

      if (!Device.isDevice) return;

      const previousToken = cachedExpoPushToken;

      try {
        await apiRequest('/emergency/device-tokens', {
          method: 'POST',
          body: {
            expoPushToken: newToken,
            previousExpoPushToken: previousToken ?? undefined,
            platform: Platform.OS,
            deviceName: Device.deviceName ?? undefined,
            deviceModel: Device.modelName ?? undefined,
            osVersion: Device.osVersion != null ? String(Device.osVersion) : undefined,
          },
        });
      } catch (err) {
        console.warn('Could not register rotated push token with the backend:', err.message);
      }

      cachedExpoPushToken = newToken;
    } catch (err) {
      console.warn('Error in push token rotation listener:', err.message);
    }
  });

  return subscription;
}

