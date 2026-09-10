// ============================================================================
// Push Receipt Reconciler
//
// Reconciles Expo push tickets against the Expo receipts endpoint:
//   POST https://exp.host/--/api/v2/push/getReceipts
//
// On 'DeviceNotRegistered', marks ONLY that specific token as inactive.
// Other devices for the same user or other users remain unaffected.
// Other receipt errors (e.g. MessageTooBig, RateExceeded) are logged without
// deactivating valid tokens.
// ============================================================================

import { query } from '../shared/db/pool.js';
import { deactivateStaleToken } from '../emergency/deviceTokens.js';

const EXPO_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';
const SWEEP_INTERVAL_MS = 60_000;

let intervalHandle = null;

function maskToken(token) {
  if (!token || typeof token !== 'string') return 'unknown';
  if (token.length <= 16) return token;
  return `${token.slice(0, 10)}...${token.slice(-6)}`;
}

/**
 * Saves a returned Expo push ticket ID for later asynchronous reconciliation.
 *
 * @param {Object} params
 * @param {string} params.ticketId
 * @param {string} params.expoPushToken
 * @param {string} [params.userId]
 */
export async function recordPushTicket({ ticketId, expoPushToken, userId = null }) {
  if (!ticketId || !expoPushToken) return;
  try {
    await query(
      `INSERT INTO push_receipt_tickets (ticket_id, expo_push_token, user_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (ticket_id) DO NOTHING`,
      [ticketId, expoPushToken, userId]
    );
  } catch (err) {
    console.error('[ReceiptReconciler] Failed to record push ticket:', err.message);
  }
}

/**
 * Reconciles pending push tickets against Expo's receipts API.
 *
 * @param {Object} [options]
 * @param {number} [options.minAgeSeconds=10] Minimum age before querying receipt
 * @param {number} [options.maxBatchSize=100] Maximum tickets per reconciliation batch
 * @param {Function} [options.customFetch=fetch] Overridable fetch implementation for testing
 * @returns {Promise<{ checked: number, ok: number, deactivated: number, errors: number }>}
 */
export async function reconcileReceipts({
  minAgeSeconds = 10,
  maxBatchSize = 100,
  customFetch = fetch,
} = {}) {
  const stats = { checked: 0, ok: 0, deactivated: 0, errors: 0 };

  const { rows: pendingTickets } = await query(
    `SELECT id, ticket_id, expo_push_token, user_id
       FROM push_receipt_tickets
      WHERE created_at <= now() - ($1 || ' seconds')::interval
      ORDER BY created_at ASC
      LIMIT $2`,
    [minAgeSeconds, maxBatchSize]
  );

  if (pendingTickets.length === 0) return stats;

  stats.checked = pendingTickets.length;
  const ticketIds = pendingTickets.map((t) => t.ticket_id);

  let response;
  try {
    response = await customFetch(EXPO_RECEIPTS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ ids: ticketIds }),
    });
  } catch (err) {
    console.error('[ReceiptReconciler] Network failure querying Expo receipts:', err.message);
    return stats;
  }

  if (!response.ok) {
    console.error(`[ReceiptReconciler] Expo receipt API returned HTTP ${response.status}`);
    return stats;
  }

  const payload = await response.json().catch(() => null);
  const receipts = payload?.data || {};

  const processedTicketDbIds = [];

  for (const ticket of pendingTickets) {
    const receipt = receipts[ticket.ticket_id];
    if (!receipt) {
      // Expo has not generated receipt yet or ticket is still in flight
      continue;
    }

    processedTicketDbIds.push(ticket.id);

    if (receipt.status === 'ok') {
      stats.ok++;
    } else if (receipt.status === 'error') {
      stats.errors++;
      const errorCode = receipt.details?.error;
      const errorMsg = receipt.message || 'Unknown receipt error';

      if (errorCode === 'DeviceNotRegistered') {
        // Safe single-token deactivation: leaves other devices for the user active
        await deactivateStaleToken(ticket.expo_push_token, { reason: 'DeviceNotRegistered' });
        stats.deactivated++;
        console.warn(`[ReceiptReconciler] Deactivated dead token: ${maskToken(ticket.expo_push_token)} (DeviceNotRegistered)`);
      } else {
        // Other permanent or transient error (e.g. MessageTooBig, MessageRateExceeded)
        // Log cleanly without exposing sensitive notification payload
        console.warn(`[ReceiptReconciler] Push delivery failure for token ${maskToken(ticket.expo_push_token)}: [${errorCode || 'Error'}] ${errorMsg}`);
      }
    }
  }

  // Delete all reconciled tickets
  if (processedTicketDbIds.length > 0) {
    await query(
      `DELETE FROM push_receipt_tickets WHERE id = ANY($1)`,
      [processedTicketDbIds]
    );
  }

  // Purge tickets older than 24 hours (Expo receipts expire after 24h)
  await query(
    `DELETE FROM push_receipt_tickets WHERE created_at < now() - INTERVAL '24 hours'`
  );

  return stats;
}

/**
 * Starts the periodic background receipt reconciliation scheduler.
 */
export function startReceiptReconciliationScheduler(sweepIntervalMs = SWEEP_INTERVAL_MS) {
  if (intervalHandle) return;
  intervalHandle = setInterval(() => {
    reconcileReceipts().catch((err) =>
      console.error('[ReceiptReconciler] Sweep error:', err.message)
    );
  }, sweepIntervalMs);
}

/**
 * Stops the periodic background receipt reconciliation scheduler.
 */
export function stopReceiptReconciliationScheduler() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
