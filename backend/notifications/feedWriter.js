// ============================================================================
// Notification Feed Writer Helper
//
// Creates in-app notification feed entries for one or more recipient users.
// Optionally triggers push notifications via Expo push provider.
// Fire-and-forget interface: errors are logged, never thrown to caller.
// ============================================================================

import { query } from '../shared/db/pool.js';
import { listActiveDeviceTokensForUser } from '../emergency/notifications/contacts.js';
import { deactivateStaleToken } from '../emergency/deviceTokens.js';
import * as pushProvider from '../emergency/notifications/providers/push.js';
import { recordPushTicket } from './receiptReconciler.js';

/**
 * Creates notification_feed rows for specified recipients.
 *
 * @param {Object} params
 * @param {string[]} params.recipientUserIds Array of target user UUIDs
 * @param {string} params.eventType Event category name (e.g. 'invite_received', 'booking_created')
 * @param {string|null} [params.eventId] Optional source row UUID (e.g. alert_id, booking_id)
 * @param {string} params.title Short notification title
 * @param {string|null} [params.body] Extended text content
 * @param {Object|null} [params.data] Deep-linking metadata (e.g. { screen: 'BookingDetails', params: { id: '...' } })
 * @param {boolean} [params.sendPush=false] Whether to also attempt push notification delivery
 */
export async function createFeedItem({
  recipientUserIds = [],
  eventType,
  eventId = null,
  title,
  body = null,
  data = null,
  sendPush = false,
}) {
  try {
    if (!Array.isArray(recipientUserIds) || recipientUserIds.length === 0) {
      return;
    }

    // Deduplicate recipient user IDs and filter out falsy values
    const uniqueRecipients = [...new Set(recipientUserIds.filter(Boolean))];
    if (uniqueRecipients.length === 0) return;

    // 1. Insert notification_feed row for each recipient
    for (const recipientId of uniqueRecipients) {
      await query(
        `INSERT INTO notification_feed (recipient_user_id, event_type, event_id, title, body, data)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [recipientId, eventType, eventId, title, body, data ? JSON.stringify(data) : null]
      );
    }

    // 2. Optional push notification delivery
    if (sendPush) {
      for (const recipientId of uniqueRecipients) {
        try {
          const tokens = await listActiveDeviceTokensForUser(recipientId);
          for (const tokenRow of tokens) {
            const pushResult = await pushProvider.send({
              destination: tokenRow.expo_push_token,
              title,
              body: body || title,
              data: data || {},
            });
            if (pushResult.success && pushResult.providerMessageId) {
              await recordPushTicket({
                ticketId: pushResult.providerMessageId,
                expoPushToken: tokenRow.expo_push_token,
                userId: recipientId,
              });
            } else if (!pushResult.success && pushResult.staleToken) {
              await deactivateStaleToken(tokenRow.expo_push_token, { reason: 'DeviceNotRegistered' }).catch(() => {});
            }
          }
        } catch (pushErr) {
          console.error(`[FeedWriter] Push failed for user ${recipientId}:`, pushErr.message);
        }
      }
    }
  } catch (err) {
    console.error('[FeedWriter] Error creating feed item:', err);
  }
}
