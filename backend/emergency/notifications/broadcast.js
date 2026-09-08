// ============================================================================
// Broadcast push tier — every actively-linked family member, once, at alert
// creation.
//
// Deliberately separate from fanout.js's advanceFanout, not a branch inside
// it. advanceFanout walks emergency_contacts one at a time in priority order,
// escalating every 5 minutes until someone acknowledges — that is an opt-in
// phone list (SMS/call/push), and only one contact is ever notified per call.
// family_links is a different opt-in: "this person can see the dashboard."
// Nobody agreed to be phoned just by being linked, but they should still find
// out the moment SOS fires — so this pushes to all of them, once, and stops.
// It is never re-run by the escalation scheduler.
//
// No dedup against the fanout tier. Someone who is both an emergency contact
// and a linked family member gets two pushes. Deliberate: a duplicate
// notification is an annoyance, a missed one is dangerous — see BUILD_LOG.md.
//
// SOS only for now — called from POST /emergency/alerts, not the fall-alert
// route. Widening this to other alert types is future work, not attempted
// here.
// ============================================================================

import { query } from '../../shared/db/pool.js';
import { listActiveDeviceTokensForUser, deactivateDeviceToken } from './contacts.js';
import { recordNotification } from './records.js';
import { buildAlertMessage } from './message.js';
import { getAlertWithOwnerName } from './fanout.js';
import * as pushProvider from './providers/push.js';
import { recordPushTicket } from '../../notifications/receiptReconciler.js';

async function listActiveFamilyMemberIds(elderlyUserId) {
  const { rows } = await query(
    `SELECT family_user_id FROM family_links WHERE elderly_user_id = $1 AND status = 'active'`,
    [elderlyUserId]
  );
  return rows.map((r) => r.family_user_id);
}

/**
 * Pushes to every device of every actively-linked family member, once. A
 * family member with no registered device (or none with push enabled) gets
 * nothing — there is no SMS/email fallback here, unlike the fanout tier:
 * dashboard users didn't opt into being phoned, only into being notified on
 * the app they already have installed.
 */
export async function broadcastToFamily(alertId) {
  const alert = await getAlertWithOwnerName(alertId);
  if (!alert) return;

  const familyUserIds = await listActiveFamilyMemberIds(alert.user_id);
  if (familyUserIds.length === 0) return;

  const message = buildAlertMessage(alert, alert.elderly_full_name).push;

  for (const familyUserId of familyUserIds) {
    const tokens = await listActiveDeviceTokensForUser(familyUserId);

    for (const token of tokens) {
      let result;
      try {
        result = await pushProvider.send({ destination: token.expo_push_token, ...message });
      } catch (err) {
        result = { success: false, errorMessage: err.message };
      }

      if (result.success && result.providerMessageId) {
        await recordPushTicket({
          ticketId: result.providerMessageId,
          expoPushToken: token.expo_push_token,
          userId: familyUserId,
        });
      }

      if (result.staleToken) {
        await deactivateDeviceToken(token.id);
      }

      await recordNotification({
        alertId,
        recipientUserId: familyUserId,
        emergencyContactId: null,
        deviceTokenId: token.id,
        channel: 'push',
        destination: token.expo_push_token,
        status: result.success ? 'sent' : 'failed',
        provider: pushProvider.name,
        providerMessageId: result.providerMessageId ?? null,
        errorMessage: result.errorMessage ?? null,
      });
    }
  }
}
