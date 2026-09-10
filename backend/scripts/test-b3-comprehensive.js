// ============================================================================
// B3 Notifications Comprehensive Automated Test Suite
//
// Tests:
//   Part 1: Token Rotation (new-token, old-token deactivation, multi-device)
//   Part 2: Stale / Reinstall Token Handling & Cross-User Isolation
//   Part 3: Expo Push Receipt Reconciliation (Success, DeviceNotRegistered, Mixed Batch)
//   Part 4: Feed API & Mark-as-Read (Scoping, Read State, Cursor Pagination)
// ============================================================================

import { query, pool } from '../shared/db/pool.js';
import { signAccessToken } from '../shared/auth/tokens.js';
import { recordPushTicket, reconcileReceipts } from '../notifications/receiptReconciler.js';
import { deactivateStaleToken, cleanStaleTokens } from '../emergency/deviceTokens.js';

const API_BASE = 'http://localhost:5000';

let totalPassed = 0;
let totalFailed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ ${message}`);
    totalPassed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    totalFailed++;
    throw new Error(message);
  }
}

async function api(path, { method = 'GET', body, token } = {}) {
  const headers = { Accept: 'application/json' };
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, json };
}

async function run() {
  console.log('═════════════════════════════════════════════════════════════════');
  console.log('  B3 Full Comprehensive Automated Test Suite');
  console.log('═════════════════════════════════════════════════════════════════\n');

  // Create isolated test users
  const ts = Date.now();
  const dummyHash = '$2b$10$abcdefghijklmnopqrstuvwxyz1234567890abcdefghijklmnopqr';
  const { rows: createdUsers } = await query(
    `INSERT INTO users (phone, full_name, role, password_hash)
     VALUES ($1, 'B3 Test User 1', 'family', $3), ($2, 'B3 Test User 2', 'elderly', $3)
     RETURNING *`,
    [`+1777${String(ts).slice(-7)}`, `+1778${String(ts).slice(-7)}`, dummyHash]
  );

  const user1 = createdUsers[0];
  const user2 = createdUsers[1];
  const token1 = signAccessToken(user1);
  const token2 = signAccessToken(user2);

  const tokenDevice1 = `ExponentPushToken[B3_test_dev1_${ts}]`;
  const tokenDevice1Rotated = `ExponentPushToken[B3_test_dev1_rot_${ts}]`;
  const tokenDevice2 = `ExponentPushToken[B3_test_dev2_${ts}]`; // second device for user 1
  const tokenUser2 = `ExponentPushToken[B3_test_user2_${ts}]`; // device for user 2

  try {
    // =========================================================================
    // PART 1: Token Rotation Tests
    // =========================================================================
    console.log('── PART 1: Token Rotation Tests ───────────────────────────────');

    // 1.1 Register initial device token
    const reg1 = await api('/emergency/device-tokens', {
      method: 'POST',
      body: { expoPushToken: tokenDevice1, platform: 'android', deviceName: 'Phone 1' },
      token: token1,
    });
    assert(reg1.status === 201, '1.1 Initial token registered (201)');

    // 1.2 Register second device for same user (multi-device)
    const reg2 = await api('/emergency/device-tokens', {
      method: 'POST',
      body: { expoPushToken: tokenDevice2, platform: 'android', deviceName: 'Tablet 1' },
      token: token1,
    });
    assert(reg2.status === 201, '1.2 Second device registered for same user (201)');

    let { rows: activeRows } = await query(
      `SELECT expo_push_token, is_active FROM device_tokens WHERE user_id = $1 AND is_active = TRUE`,
      [user1.id]
    );
    assert(activeRows.length === 2, '1.3 Both devices active concurrently under user 1');

    // 1.3 Rotate token on Phone 1: pass previousExpoPushToken
    const rotRes = await api('/emergency/device-tokens', {
      method: 'POST',
      body: {
        expoPushToken: tokenDevice1Rotated,
        previousExpoPushToken: tokenDevice1,
        platform: 'android',
        deviceName: 'Phone 1',
      },
      token: token1,
    });
    assert(rotRes.status === 201, '1.4 Rotated token registered (201)');

    // Verify old token is inactive, new token is active
    const { rows: dev1Old } = await query(`SELECT is_active FROM device_tokens WHERE expo_push_token = $1`, [tokenDevice1]);
    const { rows: dev1New } = await query(`SELECT is_active FROM device_tokens WHERE expo_push_token = $1`, [tokenDevice1Rotated]);
    const { rows: dev2 } = await query(`SELECT is_active FROM device_tokens WHERE expo_push_token = $1`, [tokenDevice2]);

    assert(dev1Old[0]?.is_active === false, '1.5 Old device token deactivated on rotation');
    assert(dev1New[0]?.is_active === true, '1.6 New rotated token is active');
    assert(dev2[0]?.is_active === true, '1.7 Multi-device independence: second device unaffected by rotation');

    // =========================================================================
    // PART 2: Stale / Reinstall & Cross-User Isolation Tests
    // =========================================================================
    console.log('\n── PART 2: Stale / Reinstall & Cross-User Isolation ──────────');

    // 2.1 Register token for User 2
    await api('/emergency/device-tokens', {
      method: 'POST',
      body: { expoPushToken: tokenUser2, platform: 'android', deviceName: 'User 2 Phone' },
      token: token2,
    });

    // 2.2 Cross-user isolation: User 1 attempts rotation pretending User 2's token was their previous token
    await api('/emergency/device-tokens', {
      method: 'POST',
      body: {
        expoPushToken: `ExponentPushToken[B3_tamper_${ts}]`,
        previousExpoPushToken: tokenUser2, // Tamper attempt!
        platform: 'android',
      },
      token: token1,
    });

    // Verify User 2's token was NOT deactivated
    const { rows: u2TokenCheck } = await query(`SELECT is_active FROM device_tokens WHERE expo_push_token = $1`, [tokenUser2]);
    assert(u2TokenCheck[0]?.is_active === true, '2.1 Cross-user isolation: User 2 token untouched by User 1 rotation attempt');

    // 2.3 Deactivate stale token directly (e.g. on permanent error)
    const deactStale = await deactivateStaleToken(tokenDevice1Rotated, { reason: 'DeviceNotRegistered' });
    assert(deactStale === true, '2.2 deactivateStaleToken returned true for active token');

    const { rows: staleRow } = await query(`SELECT is_active, failure_count FROM device_tokens WHERE expo_push_token = $1`, [tokenDevice1Rotated]);
    assert(staleRow[0]?.is_active === false, '2.3 Stale token marked is_active = FALSE');
    assert(staleRow[0]?.failure_count >= 1, '2.4 Stale token failure_count incremented');

    // 2.4 Idempotency: running deactivateStaleToken again on already-inactive token
    const deactStale2 = await deactivateStaleToken(tokenDevice1Rotated, { reason: 'DeviceNotRegistered' });
    assert(deactStale2 === false, '2.5 Idempotency: second call returns false, does not error');

    // 2.5 cleanStaleTokens periodic sweeper test
    await query(`UPDATE device_tokens SET failure_count = 10, is_active = TRUE WHERE expo_push_token = $1`, [tokenDevice2]);
    const cleaned = await cleanStaleTokens({ maxFailures: 5 });
    assert(cleaned.some((r) => r.expo_push_token === tokenDevice2), '2.6 cleanStaleTokens sweeps token with failure_count >= 5');

    // =========================================================================
    // PART 3: Expo Push Receipt Reconciliation Tests (Mocked Scenarios)
    // =========================================================================
    console.log('\n── PART 3: Expo Push Receipt Reconciliation Tests ─────────────');

    const ticketGood = `ticket_good_${ts}`;
    const ticketDead = `ticket_dead_${ts}`;
    const ticketErrorOther = `ticket_other_err_${ts}`;

    const tokenGood = `ExponentPushToken[rec_good_${ts}]`;
    const tokenDead = `ExponentPushToken[rec_dead_${ts}]`;
    const tokenOther = `ExponentPushToken[rec_other_${ts}]`;

    // Register 3 active tokens for reconciliation testing
    for (const [t, dev] of [[tokenGood, 'Good'], [tokenDead, 'Dead'], [tokenOther, 'Other']]) {
      await api('/emergency/device-tokens', {
        method: 'POST',
        body: { expoPushToken: t, platform: 'android', deviceName: dev },
        token: token1,
      });
    }

    // Record pending tickets
    await recordPushTicket({ ticketId: ticketGood, expoPushToken: tokenGood, userId: user1.id });
    await recordPushTicket({ ticketId: ticketDead, expoPushToken: tokenDead, userId: user1.id });
    await recordPushTicket({ ticketId: ticketErrorOther, expoPushToken: tokenOther, userId: user1.id });

    // Mock fetch for Expo receipt API
    const mockExpoFetch = async (url, options) => {
      const body = JSON.parse(options.body);
      const data = {};
      for (const id of body.ids) {
        if (id === ticketGood) {
          data[id] = { status: 'ok' };
        } else if (id === ticketDead) {
          data[id] = {
            status: 'error',
            message: 'The device cannot receive push notifications',
            details: { error: 'DeviceNotRegistered' },
          };
        } else if (id === ticketErrorOther) {
          data[id] = {
            status: 'error',
            message: 'Total payload size exceeded limit',
            details: { error: 'MessageTooBig' },
          };
        }
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ data }),
      };
    };

    // Reconcile with 0s min age using mock fetch
    const stats = await reconcileReceipts({
      minAgeSeconds: 0,
      customFetch: mockExpoFetch,
    });

    assert(stats.checked >= 3, `3.1 Reconciled batch checked: ${stats.checked}`);
    assert(stats.ok >= 1, `3.2 Successful receipt processed (count: ${stats.ok})`);
    assert(stats.deactivated >= 1, `3.3 DeviceNotRegistered receipt deactivated dead token (count: ${stats.deactivated})`);
    assert(stats.errors >= 2, `3.4 Error receipts captured (count: ${stats.errors})`);

    // Verify token states in DB
    const { rows: checkGood } = await query(`SELECT is_active FROM device_tokens WHERE expo_push_token = $1`, [tokenGood]);
    const { rows: checkDead } = await query(`SELECT is_active FROM device_tokens WHERE expo_push_token = $1`, [tokenDead]);
    const { rows: checkOther } = await query(`SELECT is_active FROM device_tokens WHERE expo_push_token = $1`, [tokenOther]);

    assert(checkGood[0]?.is_active === true, '3.5 Good token remains active');
    assert(checkDead[0]?.is_active === false, '3.6 Dead token deactivated by DeviceNotRegistered receipt');
    assert(checkOther[0]?.is_active === true, '3.7 Other error (MessageTooBig) does NOT deactivate valid token');

    // Confirm ticket rows were purged after processing
    const { rows: pendingRemaining } = await query(
      `SELECT * FROM push_receipt_tickets WHERE ticket_id = ANY($1)`,
      [[ticketGood, ticketDead, ticketErrorOther]]
    );
    assert(pendingRemaining.length === 0, '3.8 Processed tickets removed from push_receipt_tickets queue');

    // =========================================================================
    // PART 4: Notification Feed API & Mark-as-Read Tests
    // =========================================================================
    console.log('\n── PART 4: Notification Feed API & Mark-as-Read ──────────────');

    // 4.1 Insert 3 notifications for User 1, 1 notification for User 2
    const { rows: f1 } = await query(
      `INSERT INTO notification_feed (recipient_user_id, event_type, title, body, data)
       VALUES ($1, 'test_event_1', 'Notification 1', 'Body 1', '{"test":1}'::jsonb)
       RETURNING id`,
      [user1.id]
    );
    const { rows: f2 } = await query(
      `INSERT INTO notification_feed (recipient_user_id, event_type, title, body, data)
       VALUES ($1, 'test_event_2', 'Notification 2', 'Body 2', '{"test":2}'::jsonb)
       RETURNING id`,
      [user1.id]
    );
    const { rows: f3 } = await query(
      `INSERT INTO notification_feed (recipient_user_id, event_type, title, body, data)
       VALUES ($1, 'test_event_3', 'Notification 3', 'Body 3', '{"test":3}'::jsonb)
       RETURNING id`,
      [user1.id]
    );
    await query(
      `INSERT INTO notification_feed (recipient_user_id, event_type, title, body, data)
       VALUES ($1, 'test_event_user2', 'User 2 Note', 'Private note', '{"secret":true}'::jsonb)`,
      [user2.id]
    );

    // 4.2 GET /notifications for User 1
    const feedRes = await api('/notifications', { token: token1 });
    assert(feedRes.status === 200, '4.1 GET /notifications returns 200');
    assert(feedRes.json.notifications.length >= 3, '4.2 All user 1 notifications returned');
    assert(
      feedRes.json.notifications.every((n) => n.recipient_user_id === user1.id),
      '4.3 Strict user scoping: zero User 2 notifications leaked to User 1'
    );

    // 4.3 GET /notifications/unread-count
    const unreadRes = await api('/notifications/unread-count', { token: token1 });
    assert(unreadRes.status === 200, '4.4 GET /notifications/unread-count returns 200');
    assert(unreadRes.json.count >= 3, `4.5 Unread count matches expected (got ${unreadRes.json.count})`);

    // 4.4 PATCH /notifications/:id/read (mark single as read)
    const patchRes = await api(`/notifications/${f1[0].id}/read`, { method: 'PATCH', token: token1 });
    assert(patchRes.status === 200, '4.6 PATCH /notifications/:id/read returns 200');
    assert(patchRes.json.is_read === true, '4.7 Notification marked is_read = true');

    // 4.5 Cross-user tamper: User 1 tries to mark User 2's notification as read
    const { rows: u2FeedRow } = await query(
      `SELECT id FROM notification_feed WHERE recipient_user_id = $1 LIMIT 1`,
      [user2.id]
    );
    const tamperPatch = await api(`/notifications/${u2FeedRow[0].id}/read`, { method: 'PATCH', token: token1 });
    assert(tamperPatch.status === 404, '4.8 Cross-user mark-as-read rejected with 404 not found');

    // 4.6 POST /notifications/read-all
    const readAllRes = await api('/notifications/read-all', { method: 'POST', token: token1 });
    assert(readAllRes.status === 200, '4.9 POST /notifications/read-all returns 200');

    const unreadAfterAll = await api('/notifications/unread-count', { token: token1 });
    assert(unreadAfterAll.json.count === 0, '4.10 Unread count is 0 after mark-all-read');

    // 4.7 Pagination test using before cursor
    const page1 = await api('/notifications?limit=2', { token: token1 });
    assert(page1.json.notifications.length === 2, '4.11 Pagination limit=2 returns exactly 2 items');
    assert(page1.json.hasMore === true, '4.12 hasMore = true when additional items exist');

    const cursor = page1.json.notifications[1].id;
    const page2 = await api(`/notifications?limit=2&before=${cursor}`, { token: token1 });
    assert(page2.json.notifications.length >= 1, '4.13 Second page with before cursor returns next item');
    assert(
      !page2.json.notifications.some((n) => n.id === page1.json.notifications[0].id),
      '4.14 Pagination items are mutually exclusive (no duplicates across pages)'
    );

  } finally {
    // Teardown test records
    console.log('\nTeardown: cleaning test data...');
    await query(`DELETE FROM push_receipt_tickets WHERE user_id = ANY($1)`, [[user1.id, user2.id]]);
    await query(`DELETE FROM notification_feed WHERE recipient_user_id = ANY($1)`, [[user1.id, user2.id]]);
    await query(`DELETE FROM device_tokens WHERE user_id = ANY($1)`, [[user1.id, user2.id]]);
    await query(`DELETE FROM users WHERE id = ANY($1)`, [[user1.id, user2.id]]);
    console.log('Teardown complete.\n');
  }

  console.log('═════════════════════════════════════════════════════════════════');
  console.log(`  B3 Comprehensive Suite Results: ${totalPassed} passed, ${totalFailed} failed, ${totalPassed + totalFailed} total`);
  console.log('═════════════════════════════════════════════════════════════════\n');

  await pool.end();
  process.exit(totalFailed > 0 ? 1 : 0);
}

run().catch(async (err) => {
  console.error('Test suite crashed:', err);
  await pool.end();
  process.exit(2);
});
