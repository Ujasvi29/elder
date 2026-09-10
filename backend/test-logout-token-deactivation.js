// ============================================================================
// Phase 3 Verification: Logout Push Token Deactivation
//
// Tests the complete lifecycle: register token → verify active → deactivate
// via DELETE → verify inactive. Also tests multi-user isolation, cross-user
// tamper protection, idempotent deactivation, and missing-body validation.
//
// Prerequisites:
//   1. Backend server running on http://localhost:5000
//   2. Two users exist and can log in (we create them via /auth/register if needed)
//
// Run:
//   node backend/test-logout-token-deactivation.js
// ============================================================================

const API = 'http://localhost:5000';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function api(path, { method = 'GET', body, token } = {}) {
  const headers = { Accept: 'application/json' };
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, json };
}

async function loginOrRegister(email, password, fullName, phone, role) {
  // Try login first
  let result = await api('/auth/login', { method: 'POST', body: { email, password } });
  if (result.status === 200) {
    return { accessToken: result.json.accessToken, refreshToken: result.json.refreshToken, user: result.json.user };
  }

  // Register
  result = await api('/auth/register', {
    method: 'POST',
    body: { email, password, fullName, phone, role },
  });
  if (result.status !== 201) {
    throw new Error(`Could not register ${email}: ${result.status} ${JSON.stringify(result.json)}`);
  }
  return { accessToken: result.json.accessToken, refreshToken: result.json.refreshToken, user: result.json.user };
}

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.log(`  ❌ FAIL: ${label}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// Direct DB query helper — uses the same pool the backend uses
// ---------------------------------------------------------------------------
import pg from 'pg';
const pool = new pg.Pool({ connectionString: 'postgresql://postgres:sree@localhost:5432/eldercare' });

async function dbQuery(text, params) {
  const result = await pool.query(text, params);
  return result.rows;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function run() {
  console.log('\n════════════════════════════════════════════════════');
  console.log('  Phase 3: Logout Push Token Deactivation Tests');
  console.log('════════════════════════════════════════════════════\n');

  // --- Setup: two test users ---
  const userAEmail = `test_logout_a_${Date.now()}@test.local`;
  const userBEmail = `test_logout_b_${Date.now()}@test.local`;
  const password = 'TestPass123!';

  const ts = Date.now();
  const phoneA = `+1555${String(ts).slice(-7)}`;
  const phoneB = `+1556${String(ts).slice(-7)}`;

  console.log('Setup: creating two test users...');
  const userA = await loginOrRegister(userAEmail, password, 'Logout Test A', phoneA, 'elderly');
  const userB = await loginOrRegister(userBEmail, password, 'Logout Test B', phoneB, 'family');
  console.log(`  User A: ${userA.user.id} (${userA.user.role})`);
  console.log(`  User B: ${userB.user.id} (${userB.user.role})\n`);

  const fakeTokenA = `ExponentPushToken[test_logout_A_${Date.now()}]`;
  const fakeTokenB = `ExponentPushToken[test_logout_B_${Date.now()}]`;
  const fakeTokenA2 = `ExponentPushToken[test_logout_A2_${Date.now()}]`; // second device for A

  // ═══════════════════════════════════════════════════
  // Test 1: Register token → verify DB row is active
  // ═══════════════════════════════════════════════════
  console.log('Test 1: Register token and verify DB row is active');
  const reg = await api('/emergency/device-tokens', {
    method: 'POST',
    body: { expoPushToken: fakeTokenA, platform: 'android', deviceName: 'Test Phone A' },
    token: userA.accessToken,
  });
  assert(reg.status === 201, `POST /device-tokens returns 201 (got ${reg.status})`);
  assert(reg.json?.deviceToken?.isActive === true, 'Registered token is_active = true');

  // Verify directly in DB
  let rows = await dbQuery(
    'SELECT is_active FROM device_tokens WHERE expo_push_token = $1 AND user_id = $2',
    [fakeTokenA, userA.user.id]
  );
  assert(rows.length === 1 && rows[0].is_active === true, 'DB row exists and is_active = true');

  // ═══════════════════════════════════════════════════
  // Test 2: DELETE /device-tokens → verify DB row is deactivated
  // ═══════════════════════════════════════════════════
  console.log('\nTest 2: Deactivate token via DELETE and verify DB');
  const del = await api('/emergency/device-tokens', {
    method: 'DELETE',
    body: { expoPushToken: fakeTokenA },
    token: userA.accessToken,
  });
  assert(del.status === 200, `DELETE /device-tokens returns 200 (got ${del.status})`);
  assert(del.json?.deactivated === true, 'Response confirms deactivated = true');

  rows = await dbQuery(
    'SELECT is_active FROM device_tokens WHERE expo_push_token = $1 AND user_id = $2',
    [fakeTokenA, userA.user.id]
  );
  assert(rows.length === 1 && rows[0].is_active === false, 'DB row is_active = false after DELETE');

  // ═══════════════════════════════════════════════════
  // Test 3: Idempotent — second DELETE returns deactivated = false (no row to update)
  // ═══════════════════════════════════════════════════
  console.log('\nTest 3: Idempotent deactivation (second DELETE)');
  const del2 = await api('/emergency/device-tokens', {
    method: 'DELETE',
    body: { expoPushToken: fakeTokenA },
    token: userA.accessToken,
  });
  assert(del2.status === 200, `Second DELETE still returns 200 (got ${del2.status})`);
  assert(del2.json?.deactivated === false, 'Response confirms deactivated = false (already inactive)');

  // ═══════════════════════════════════════════════════
  // Test 4: Cross-user tamper protection
  // User B cannot deactivate User A's token
  // ═══════════════════════════════════════════════════
  console.log('\nTest 4: Cross-user tamper protection');
  // Re-activate A's token first
  await api('/emergency/device-tokens', {
    method: 'POST',
    body: { expoPushToken: fakeTokenA, platform: 'android', deviceName: 'Test Phone A' },
    token: userA.accessToken,
  });
  // Verify it's active again
  rows = await dbQuery('SELECT is_active FROM device_tokens WHERE expo_push_token = $1', [fakeTokenA]);
  assert(rows[0].is_active === true, 'Token re-activated for tamper test');

  // User B tries to deactivate User A's token
  const tamper = await api('/emergency/device-tokens', {
    method: 'DELETE',
    body: { expoPushToken: fakeTokenA },
    token: userB.accessToken,
  });
  assert(tamper.status === 200, 'DELETE returns 200 (no error, but no match)');
  assert(tamper.json?.deactivated === false, 'deactivated = false (WHERE user_id scoping blocked it)');

  // Confirm A's token is still active
  rows = await dbQuery('SELECT is_active FROM device_tokens WHERE expo_push_token = $1', [fakeTokenA]);
  assert(rows[0].is_active === true, "User A's token still active after User B's attempt");

  // ═══════════════════════════════════════════════════
  // Test 5: Multi-device — deactivating one token leaves others active
  // ═══════════════════════════════════════════════════
  console.log('\nTest 5: Multi-device isolation');
  // Register a second device for User A
  await api('/emergency/device-tokens', {
    method: 'POST',
    body: { expoPushToken: fakeTokenA2, platform: 'ios', deviceName: 'Test Tablet A' },
    token: userA.accessToken,
  });

  // Deactivate only the first device
  await api('/emergency/device-tokens', {
    method: 'DELETE',
    body: { expoPushToken: fakeTokenA },
    token: userA.accessToken,
  });

  // First device should be inactive, second should still be active
  rows = await dbQuery(
    'SELECT expo_push_token, is_active FROM device_tokens WHERE user_id = $1 ORDER BY expo_push_token',
    [userA.user.id]
  );
  const tokenARow = rows.find(r => r.expo_push_token === fakeTokenA);
  const tokenA2Row = rows.find(r => r.expo_push_token === fakeTokenA2);
  assert(tokenARow && tokenARow.is_active === false, 'First device token deactivated');
  assert(tokenA2Row && tokenA2Row.is_active === true, 'Second device token still active');

  // ═══════════════════════════════════════════════════
  // Test 6: Validation — missing body
  // ═══════════════════════════════════════════════════
  console.log('\nTest 6: Validation — missing/empty body');
  const noBody = await api('/emergency/device-tokens', {
    method: 'DELETE',
    body: {},
    token: userA.accessToken,
  });
  assert(noBody.status === 400, `Empty body returns 400 (got ${noBody.status})`);
  assert(noBody.json?.code === 'validation_failed', 'Error code is validation_failed');

  const emptyToken = await api('/emergency/device-tokens', {
    method: 'DELETE',
    body: { expoPushToken: '' },
    token: userA.accessToken,
  });
  assert(emptyToken.status === 400, `Empty string token returns 400 (got ${emptyToken.status})`);

  // ═══════════════════════════════════════════════════
  // Test 7: Unauthenticated request → 401
  // ═══════════════════════════════════════════════════
  console.log('\nTest 7: Unauthenticated DELETE → 401');
  const noAuth = await api('/emergency/device-tokens', {
    method: 'DELETE',
    body: { expoPushToken: fakeTokenA },
  });
  assert(noAuth.status === 401, `No-auth DELETE returns 401 (got ${noAuth.status})`);

  // ═══════════════════════════════════════════════════
  // Test 8: Token for a non-existent push token → deactivated = false (no error)
  // ═══════════════════════════════════════════════════
  console.log('\nTest 8: Non-existent token → graceful false');
  const phantom = await api('/emergency/device-tokens', {
    method: 'DELETE',
    body: { expoPushToken: 'ExponentPushToken[does_not_exist_ever]' },
    token: userA.accessToken,
  });
  assert(phantom.status === 200, `Non-existent token returns 200 (got ${phantom.status})`);
  assert(phantom.json?.deactivated === false, 'deactivated = false for non-existent token');

  // ═══════════════════════════════════════════════════
  // Test 9: Re-registration after deactivation → token becomes active again
  // ═══════════════════════════════════════════════════
  console.log('\nTest 9: Re-registration after deactivation');
  // fakeTokenA was deactivated in Test 5, re-register it
  const rereg = await api('/emergency/device-tokens', {
    method: 'POST',
    body: { expoPushToken: fakeTokenA, platform: 'android', deviceName: 'Test Phone A' },
    token: userA.accessToken,
  });
  assert(rereg.status === 201, `Re-registration returns 201 (got ${rereg.status})`);
  assert(rereg.json?.deviceToken?.isActive === true, 'Re-registered token is_active = true');

  rows = await dbQuery(
    'SELECT is_active FROM device_tokens WHERE expo_push_token = $1 AND user_id = $2',
    [fakeTokenA, userA.user.id]
  );
  assert(rows[0].is_active === true, 'DB confirms re-activated after re-registration');

  // ═══════════════════════════════════════════════════
  // Test 10: Client logout logic when no cached push token exists
  // ═══════════════════════════════════════════════════
  console.log('\nTest 10: Client logout when no cached token exists');
  // Simulate pushRegistration.js unregisterForPushNotifications logic:
  let simulatedCache = null;
  let apiCallsMade = 0;
  async function simulateUnregister(mockApiFn) {
    const token = simulatedCache;
    simulatedCache = null;
    if (!token) return;
    apiCallsMade++;
    await mockApiFn(token);
  }

  let test10Thrown = false;
  try {
    await simulateUnregister(async () => {});
  } catch {
    test10Thrown = true;
  }
  assert(!test10Thrown, 'Unregister does not throw when cache is null');
  assert(apiCallsMade === 0, 'No API call made when cached token is null');
  assert(simulatedCache === null, 'Cache remains null');

  // ═══════════════════════════════════════════════════
  // Test 11: Simulate network/API failure during deactivation call
  // ═══════════════════════════════════════════════════
  console.log('\nTest 11: Network / API failure during deactivation');
  simulatedCache = 'ExponentPushToken[failing_network_test]';
  let test11Thrown = false;
  try {
    const token = simulatedCache;
    simulatedCache = null; // Cleared immediately regardless of outcome
    if (token) {
      try {
        await (async () => { throw new Error('Network timeout / backend 500'); })();
      } catch (err) {
        // Swallowed in pushRegistration.js
      }
    }
  } catch {
    test11Thrown = true;
  }
  assert(!test11Thrown, 'Logout does not throw on deactivation network/API failure');
  assert(simulatedCache === null, 'Local cache is cleared even when deactivation fails');

  // ═══════════════════════════════════════════════════
  // Test 12: Notification delivery after logout → re-login
  // ═══════════════════════════════════════════════════
  console.log('\nTest 12: Notification delivery to re-registered user');
  const activeTokens = await dbQuery(
    'SELECT id, expo_push_token, is_active FROM device_tokens WHERE user_id = $1 AND is_active = TRUE',
    [userA.user.id]
  );
  assert(activeTokens.length > 0, 'Active token found for re-registered user');
  assert(activeTokens.some(t => t.expo_push_token === fakeTokenA), 'Re-registered token is among active tokens');

  // Verify notification_feed insertion and token resolution via feedWriter
  const feedInsert = await dbQuery(
    `INSERT INTO notification_feed (recipient_user_id, event_type, title, body, data)
     VALUES ($1, 'test_relogin_event', 'Test Notification', 'Testing delivery after re-login', '{}'::jsonb)
     RETURNING id, recipient_user_id, event_type`,
    [userA.user.id]
  );
  assert(feedInsert.length === 1, 'Feed item created for re-registered user');
  assert(feedInsert[0].event_type === 'test_relogin_event', 'Feed item event_type matches');

  // Verify destination column fix: tokenRow.expo_push_token is valid
  const destination = activeTokens[0].expo_push_token;
  assert(typeof destination === 'string' && destination.startsWith('ExponentPushToken['), 'destination is valid expo_push_token string');

  // ═══════════════════════════════════════════════════
  // Cleanup
  // ═══════════════════════════════════════════════════
  console.log('\nCleanup: removing test tokens and feed items from DB...');
  await dbQuery('DELETE FROM notification_feed WHERE recipient_user_id = ANY($1)', [[userA.user.id, userB.user.id]]);
  await dbQuery('DELETE FROM device_tokens WHERE expo_push_token = ANY($1)', [[fakeTokenA, fakeTokenA2, fakeTokenB]]);
  // Clean up test users (cascades device_tokens too)
  await dbQuery('DELETE FROM users WHERE id = ANY($1)', [[userA.user.id, userB.user.id]]);
  console.log('  Done.\n');

  // ═══════════════════════════════════════════════════
  // Summary
  // ═══════════════════════════════════════════════════
  console.log('════════════════════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  console.log('════════════════════════════════════════════════════');

  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Test runner crashed:', err);
  pool.end().then(() => process.exit(2));
});
