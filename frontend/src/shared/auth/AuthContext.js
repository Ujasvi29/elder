// ============================================================================
// Auth state
//
// Who is signed in, and whether we know yet. Three states:
//
//   restoring  — reading stored tokens on launch. Nothing is decided.
//   signedOut  — no valid session. The login screen is shown.
//   signedIn   — `user` is populated and the role decides the home screen.
//
// "restoring" exists as its own state on purpose. Reading SecureStore and
// confirming the token with the server takes a moment, and without it the app
// would show the login screen for a heartbeat on every launch before replacing
// it — a returning user would see a login flash they never had to act on.
//
// This module is also where the API client gets its wiring, so the client can
// refresh and give up on a session without importing anything from the
// component tree.
// ============================================================================

import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { configureApiClient } from '../api/client';
import * as authApi from '../api/auth';
import { clearTokens, loadTokens, saveTokens } from './tokenStore';
import { disableBackgroundTrackingSilently } from '../location/backgroundTracking';
import { unregisterForPushNotifications } from '../notifications/pushRegistration';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [status, setStatus] = useState('restoring');
  const [user, setUser] = useState(null);

  // Tokens live in a ref, not in state. The API client reads them from
  // callbacks that may run mid-request, and a ref is always the current value —
  // a state variable captured in a closure can be one render stale, which here
  // would mean sending a token that was just rotated away.
  const tokens = useRef({ accessToken: null, refreshToken: null });

  // Registered before the first request goes out, so a refresh triggered during
  // the restore below already has somewhere to put the new tokens.
  useEffect(() => {
    configureApiClient({
      getTokens: () => tokens.current,

      onTokensRenewed: async (renewed) => {
        tokens.current = renewed;
        await saveTokens(renewed);
      },

      onSessionEnded: async () => {
        tokens.current = { accessToken: null, refreshToken: null };
        await clearTokens();
        // A dead session must not keep a background-location foreground
        // service running — see backgroundTracking.js.
        await disableBackgroundTrackingSilently().catch(() => {});
        setUser(null);
        setStatus('signedOut');
      },
    });
  }, []);

  // Runs once on launch: this is what keeps someone logged in across restarts.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const stored = await loadTokens();

      if (!stored.accessToken || !stored.refreshToken) {
        if (!cancelled) setStatus('signedOut');
        return;
      }

      tokens.current = stored;

      try {
        // Confirms the session is still good rather than trusting the stored
        // token. If the access token expired while the app was closed — which
        // it will have, after 15 minutes — the client refreshes and retries
        // without this code knowing it happened.
        const result = await authApi.me();
        if (cancelled) return;

        setUser(result.user);
        setStatus('signedIn');
      } catch {
        // Revoked, expired, or the account was deactivated. onSessionEnded has
        // already cleared everything for the refresh path; doing it here as
        // well covers the cases that never got that far.
        if (cancelled) return;

        await clearTokens();
        tokens.current = { accessToken: null, refreshToken: null };
        setUser(null);
        setStatus('signedOut');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo(
    () => ({
      status,
      user,
      isSignedIn: status === 'signedIn',

      /**
       * Completes a sign-in from the response of /auth/login or /auth/register.
       * This is the function the login screen calls once the server has
       * accepted the credentials — it is the whole handover between Teammate
       * C's screen and the rest of the app.
       *
       * @param {object} response  the body returned by login or register
       */
      async signIn(response) {
        const pair = {
          accessToken: response.accessToken,
          refreshToken: response.refreshToken,
        };

        tokens.current = pair;
        await saveTokens(pair);

        setUser(response.user);
        setStatus('signedIn');
      },

      /**
       * Ends the session on this device. Other devices keep working, which is
       * why the refresh token is revoked one at a time rather than all at once.
       */
      async signOut() {
        const { refreshToken } = tokens.current;

        // Local state is cleared whatever the server says. A failed logout call
        // must not strand someone in an account they asked to leave; the token
        // expires on its own within 30 days, and the access token within 15
        // minutes.
        try {
          if (refreshToken) await authApi.logout(refreshToken);
        } catch {
          // Offline, or the token was already revoked. Neither changes what
          // happens next.
        }

        // Deactivate this device's push token before clearing the session.
        // Must happen while tokens.current still holds a valid access token
        // so the authenticated DELETE call can attach a Bearer header.
        // Fire-and-forget: a failed deactivation must never block logout.
        await unregisterForPushNotifications();

        // Same reasoning as onSessionEnded above: no session, no business
        // running a location-tracking foreground service.
        await disableBackgroundTrackingSilently().catch(() => {});

        tokens.current = { accessToken: null, refreshToken: null };
        await clearTokens();
        setUser(null);
        setStatus('signedOut');
      },
    }),
    [status, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Reads the auth state. Throws if used outside the provider, which is a wiring bug. */
export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used inside an <AuthProvider>.');
  }

  return context;
}
