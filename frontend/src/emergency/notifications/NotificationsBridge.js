// ============================================================================
// Wires push registration and the SOS acknowledge listener to auth state.
//
// Rendered once from App.js. Lives under emergency/ rather than shared/: its
// job is composing a generic device capability (shared/notifications/) with
// emergency-specific behaviour (this module's own alertNotifications.js) —
// that composition is emergency-module glue, not something every module
// needs. Renders nothing.
// ============================================================================

import { useEffect } from 'react';

import { useAuth } from '../../shared/auth/AuthContext';
import { registerForPushNotifications, setupPushTokenRotationListener } from '../../shared/notifications/pushRegistration';
import { registerSosNotificationCategory, registerSosAcknowledgeListener } from './alertNotifications';

export function NotificationsBridge() {
  const { isSignedIn } = useAuth();

  useEffect(() => {
    if (!isSignedIn) return;

    registerSosNotificationCategory();
    registerForPushNotifications();
    const sosSubscription = registerSosAcknowledgeListener();
    const rotationSubscription = setupPushTokenRotationListener();

    return () => {
      sosSubscription?.remove();
      rotationSubscription?.remove();
    };
  }, [isSignedIn]);

  return null;
}
