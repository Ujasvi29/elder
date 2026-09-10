// ============================================================================
// B4.1 & B4.2 User Management Automated Verification
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
  console.log('  B4.1 & B4.2: User Management Backend Tests');
  console.log('═════════════════════════════════════════════════════════════════\n');

  // Find or create admin user and regular user for testing
  const { rows: adminRows } = await query(`SELECT * FROM users WHERE role = 'admin' LIMIT 1`);
  let adminUser = adminRows[0];
  if (!adminUser) {
    const { rows: createdAdmin } = await query(
      `INSERT INTO users (phone, full_name, email, role, password_hash)
       VALUES ('+919999999990', 'Test Admin', 'admin@example.com', 'admin', '$2b$10$dummyhashfortesting000000000000000000000000000000000000')
       RETURNING *`
    );
    adminUser = createdAdmin[0];
  }

  const { rows: regularRows } = await query(`SELECT * FROM users WHERE role != 'admin' LIMIT 1`);
  let regularUser = regularRows[0];
  if (!regularUser) {
    const { rows: createdRegular } = await query(
      `INSERT INTO users (phone, full_name, email, role, password_hash)
       VALUES ('+919999999991', 'Test Regular', 'user@example.com', 'family', '$2b$10$dummyhashfortesting000000000000000000000000000000000000')
       RETURNING *`
    );
    regularUser = createdRegular[0];
  }

  const adminToken = signAccessToken(adminUser);
  const userToken = signAccessToken(regularUser);

  // 1. Authorization checks
  console.log('1. Authorization checks:');
  const unauthRes = await api('/admin/users');
  assert(unauthRes.status === 401, 'Unauthenticated request receives 401');

  const nonAdminRes = await api('/admin/users', { token: userToken });
  assert(nonAdminRes.status === 403, 'Non-admin request receives 403');

  // 2. Listing and pagination
  console.log('\n2. User listing and pagination:');
  const listRes = await api('/admin/users?page=1&limit=5', { token: adminToken });
  assert(listRes.status === 200, 'Admin can list users (200)');
  assert(listRes.json.status === 'ok', 'Response status is ok');
  assert(Array.isArray(listRes.json.users), 'Users array returned');
  assert(listRes.json.page === 1, 'Page metadata correct');
  assert(listRes.json.limit === 5, 'Limit metadata correct');
  assert(listRes.json.users.length <= 5, 'Users count respects limit');
  assert(typeof listRes.json.total === 'number', 'Total count returned');

  // 3. Search and filtering
  console.log('\n3. Search and filtering:');
  const searchName = adminUser.full_name || adminUser.fullName || 'Admin';
  const searchRes = await api(`/admin/users?q=${encodeURIComponent(searchName)}`, { token: adminToken });
  assert(searchRes.status === 200, 'Search by name returns 200');
  assert(searchRes.json.users.some(u => u.id === adminUser.id), 'Admin user found in search results');

  const roleRes = await api('/admin/users?role=admin', { token: adminToken });
  assert(roleRes.status === 200, 'Filter by role returns 200');
  assert(roleRes.json.users.every(u => u.role === 'admin'), 'All results have role=admin');

  // 4. User detail
  console.log('\n4. User detail endpoint:');
  const detailRes = await api(`/admin/users/${regularUser.id}`, { token: adminToken });
  assert(detailRes.status === 200, 'Admin can fetch user detail');
  assert(detailRes.json.user.id === regularUser.id, 'User detail matches requested ID');
  assert(detailRes.json.user.fullName !== undefined, 'User detail includes fullName');

  const notFoundRes = await api('/admin/users/00000000-0000-0000-0000-000000000000', { token: adminToken });
  assert(notFoundRes.status === 404, 'Non-existent user returns 404');

  // 5. User activation / deactivation
  console.log('\n5. User activation / deactivation:');
  // Self-deactivation should fail
  const selfDeactRes = await api(`/admin/users/${adminUser.id}`, {
    method: 'PATCH',
    body: { isActive: false },
    token: adminToken,
  });
  assert(selfDeactRes.status === 403, 'Self-deactivation is forbidden (403)');
  assert(selfDeactRes.json.code === 'cannot_deactivate_self', 'Returns cannot_deactivate_self code');

  // Deactivate regular user
  const deactRes = await api(`/admin/users/${regularUser.id}`, {
    method: 'PATCH',
    body: { isActive: false },
    token: adminToken,
  });
  assert(deactRes.status === 200, 'Can deactivate another user (200)');
  assert(deactRes.json.user.isActive === false, 'User isActive is false');

  // Reactivate regular user
  const reactRes = await api(`/admin/users/${regularUser.id}`, {
    method: 'PATCH',
    body: { isActive: true },
    token: adminToken,
  });
  assert(reactRes.status === 200, 'Can reactivate user (200)');
  assert(reactRes.json.user.isActive === true, 'User isActive is true');

  console.log(`\n═════════════════════════════════════════════════════════════════`);
  console.log(`  All B4.1 & B4.2 tests passed! (${totalPassed} passed, ${totalFailed} failed)`);
  console.log(`═════════════════════════════════════════════════════════════════\n`);
}

run()
  .then(() => pool.end())
  .catch(err => {
    console.error('Test error:', err);
    pool.end();
    process.exit(1);
  });
