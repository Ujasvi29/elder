// ============================================================================
// Notification Event Type Constants
//
// Centralized source of truth for all event_type strings used in
// notification_feed rows and deep-link payload data.
// ============================================================================

export const NOTIFICATION_EVENTS = {
  ALERT_FIRED: 'alert_fired',
  ALERT_ACKNOWLEDGED: 'alert_acknowledged',
  ALERT_RESOLVED: 'alert_resolved',
  ALERT_CANCELLED: 'alert_cancelled',
  INVITE_RECEIVED: 'invite_received',
  INVITE_ACCEPTED: 'invite_accepted',
  INVITE_DECLINED: 'invite_declined',
  LINK_REVOKED: 'link_revoked',
  PERMISSIONS_CHANGED: 'permissions_changed',
  PROMOTED_TO_CONTACT: 'promoted_to_contact',
  BOOKING_CREATED: 'booking_created',
  BOOKING_STATUS_CHANGED: 'booking_status_changed',
  TASK_ASSIGNED: 'task_assigned',
  TASK_STATUS_CHANGED: 'task_status_changed',
};
