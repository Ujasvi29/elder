// ============================================================================
// B4.6 Security Hardening & Authorization Test Suite
//
// Verifies:
//   1. Every admin route returns 401 for unauthenticated calls
//   2. Every admin route returns 403 for each non-admin role:
//      - elderly
//      - family
//      - caregiver
//   3. Admin role cannot be self-assigned at registration
//   4. Admin self-deactivation is strictly rejected
//   5. Immediate revocation: deactivated accounts fail authentication immediately
//   6. IDOR / parameter validation: invalid UUIDs return 400 bad request
// ============================================================================

import { query, pool } from '../shared/db/pool.js';
import { signAccessToken } from '../shared/auth/tokens.js';

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
  console.log('  B4.6: Admin Security Hardening & Multi-Role Authorization Tests');
  console.log('═════════════════════════════════════════════════════════════════\n');

  // Fetch or create users for each role
  const roles = ['admin', 'elderly', 'family', 'caregiver'];
  const testUsers = {};

  for (const role of roles) {
    const { rows } = await query(`SELECT * FROM users WHERE role = $1 AND is_active = true LIMIT 1`, [role]);
    if (rows[0]) {
      testUsers[role] = rows[0];
    } else {
      const phone = `+91999999000${roles.indexOf(role)}`;
      const { rows: created } = await query(
        `INSERT INTO users (phone, full_name, email, role, is_active, password_hash)
         VALUES ($1, $2, $3, $4, true, '$2b$10$dummyhashfortesting000000000000000000000000000000000000')
         RETURNING *`,
        [phone, `Test ${role}`, `${role}@test.com`, role]
      );
      testUsers[role] = created[0];
    }
  }

  const tokens = {
    admin: signAccessToken(testUsers.admin),
    elderly: signAccessToken(testUsers.elderly),
    family: signAccessToken(testUsers.family),
    caregiver: signAccessToken(testUsers.caregiver),
  };

  const adminEndpoints = [
    { method: 'GET', path: '/admin/users' },
    { method: 'GET', path: `/admin/users/${testUsers.elderly.id}` },
    { method: 'PATCH', path: `/admin/users/${testUsers.elderly.id}`, body: { isActive: true } },
    { method: 'GET', path: '/admin/alerts' },
    { method: 'GET', path: '/emergency/admin/alerts' },
    { method: 'GET', path: '/caregiver/verification-queue' },
  ];

  // 1. Unauthenticated checks (401)
  console.log('1. Unauthenticated requests:');
  for (const ep of adminEndpoints) {
    const res = await api(ep.path, { method: ep.method, body: ep.body });
    assert(res.status === 401, `Unauthenticated ${ep.method} ${ep.path} -> 401`);
  }

  // 2. Non-admin roles rejection (403)
  console.log('\n2. Non-admin role authorization enforcement:');
  const nonAdminRoles = ['elderly', 'family', 'caregiver'];

  for (const role of nonAdminRoles) {
    const token = tokens[role];
    console.log(`  Checking role: ${role}`);
    for (const ep of adminEndpoints) {
      const res = await api(ep.path, { method: ep.method, body: ep.body, token });
      assert(res.status === 403, `Role '${role}' on ${ep.method} ${ep.path} -> 403 Forbidden`);
    }
  }

  // 3. Admin registration self-assignment prevention
  console.log('\n3. Registration role privilege escalation guard:');
  const regRes = await api('/auth/register', {
    method: 'POST',
    body: {
      phone: '+919999990099',
      fullName: 'Hacker Admin',
      password: 'StrongPassword123!',
      role: 'admin',
    },
  });
  assert(regRes.status === 403, 'Attempt to register with role=admin returns 403 Forbidden');
  assert(regRes.json.code === 'role_not_self_assignable', 'Rejection code is role_not_self_assignable');

  // 4. Admin self-deactivation prevention
  console.log('\n4. Admin self-deactivation protection:');
  const selfDeact = await api(`/admin/users/${testUsers.admin.id}`, {
    method: 'PATCH',
    body: { isActive: false },
    token: tokens.admin,
  });
  assert(selfDeact.status === 403, 'Admin deactivating own account returns 403');
  assert(selfDeact.json.code === 'cannot_deactivate_self', 'Returns cannot_deactivate_self code');

  // 5. Parameter validation & IDOR guards
  console.log('\n5. Input validation & UUID injection prevention:');
  const badUuid = await api('/admin/users/not-a-uuid', { token: tokens.admin });
  assert(badUuid.status === 400, 'Invalid UUID on /admin/users/:id returns 400');
  assert(badUuid.json.code === 'invalid_id', 'Error code is invalid_id');

  const badAlertUuid = await api('/admin/alerts/12345-not-valid', { token: tokens.admin });
  assert(badAlertUuid.status === 400, 'Invalid UUID on /admin/alerts/:id returns 400');

  const badRoleQuery = await api('/admin/users?role=super_admin_invalid', { token: tokens.admin });
  assert(badRoleQuery.status === 400, 'Invalid role query filter returns 400');

  const badAlertStatus = await api('/admin/alerts?status=invalid_status_enum', { token: tokens.admin });
  assert(badAlertStatus.status === 400, 'Invalid alert status query filter returns 400');

  // 6. Immediate revocation of deactivated accounts
  console.log('\n6. Immediate revocation on account deactivation:');
  // Create a temporary user, deactivate them, and verify their token is immediately rejected
  const { rows: tempUserRows } = await query(
    `INSERT INTO users (phone, full_name, email, role, is_active, password_hash)
     VALUES ('+919999990088', 'Temp Revoke User', 'temp@test.com', 'family', true, '$2b$10$dummyhashfortesting000000000000000000000000000000000000')
     RETURNING *`
  );
  const tempUser = tempUserRows[0];
  const tempToken = signAccessToken(tempUser);

  // Deactivate the user via admin endpoint
  const deactRes = await api(`/admin/users/${tempUser.id}`, {
    method: 'PATCH',
    body: { isActive: false },
    token: tokens.admin,
  });
  assert(deactRes.status === 200, 'Admin deactivated temp user');

  // Now attempt authenticated request with tempUser's validly-signed JWT
  const accessWithRevoked = await api('/emergency/alerts', { token: tempToken });
  assert(accessWithRevoked.status === 403, 'Deactivated user token immediately receives 403');
  assert(accessWithRevoked.json.code === 'account_disabled', 'Returns account_disabled code');

  // Clean up temp user
  await query(`DELETE FROM users WHERE id = $1`, [tempUser.id]);

  console.log(`\n═════════════════════════════════════════════════════════════════`);
  console.log(`  All B4.6 Security Hardening tests passed! (${totalPassed} passed, ${totalFailed} failed)`);
  console.log(`═════════════════════════════════════════════════════════════════\n`);
}

run()
  .then(() => pool.end())
  .catch(err => {
    console.error('Test error:', err);
    pool.end();
    process.exit(1);
  });
