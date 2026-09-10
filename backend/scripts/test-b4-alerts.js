// ============================================================================
// B4.4 Platform-wide Alert Overview Automated Verification
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
  console.log('  B4.4: Platform-wide Alert Overview Backend Tests');
  console.log('═════════════════════════════════════════════════════════════════\n');

  // Find or create admin and regular user
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

  // Create an elderly user and a test alert if none exists
  const { rows: elderlyRows } = await query(`SELECT * FROM users WHERE role = 'elderly' LIMIT 1`);
  let elderlyUser = elderlyRows[0];
  if (!elderlyUser) {
    const { rows: createdElderly } = await query(
      `INSERT INTO users (phone, full_name, email, role, password_hash)
       VALUES ('+919999999992', 'Test Elderly', 'elderly@example.com', 'elderly', '$2b$10$dummyhashfortesting000000000000000000000000000000000000')
       RETURNING *`
    );
    elderlyUser = createdElderly[0];
  }

  const { rows: alertRows } = await query(`SELECT * FROM alerts LIMIT 1`);
  let testAlert = alertRows[0];
  if (!testAlert) {
    const { rows: createdAlert } = await query(
      `INSERT INTO alerts (user_id, alert_type, status, severity, message)
       VALUES ($1, 'sos', 'active', 'critical', 'Test SOS Alert for B4')
       RETURNING *`,
      [elderlyUser.id]
    );
    testAlert = createdAlert[0];
  }

  const adminToken = signAccessToken(adminUser);
  const userToken = signAccessToken(regularUser);

  // 1. Authorization checks
  console.log('1. Authorization checks:');
  const unauthRes = await api('/emergency/admin/alerts');
  assert(unauthRes.status === 401, 'Unauthenticated request receives 401');

  const nonAdminRes = await api('/emergency/admin/alerts', { token: userToken });
  assert(nonAdminRes.status === 403, 'Non-admin request receives 403');

  const nonAdminAdminPath = await api('/admin/alerts', { token: userToken });
  assert(nonAdminAdminPath.status === 403, 'Non-admin to /admin/alerts receives 403');

  // 2. Listing alerts
  console.log('\n2. Listing platform alerts:');
  const listRes = await api('/emergency/admin/alerts?page=1&limit=10', { token: adminToken });
  assert(listRes.status === 200, 'Admin can list platform alerts via /emergency/admin/alerts (200)');
  assert(listRes.json.status === 'ok', 'Status is ok');
  assert(Array.isArray(listRes.json.alerts), 'Alerts array returned');
  assert(typeof listRes.json.total === 'number', 'Total is number');
  assert(listRes.json.alerts.length > 0, 'At least one alert returned');

  const alertItem = listRes.json.alerts[0];
  assert(alertItem.id !== undefined, 'Alert has id');
  assert(alertItem.alertType !== undefined, 'Alert has alertType');
  assert(alertItem.status !== undefined, 'Alert has status');
  assert(alertItem.severity !== undefined, 'Alert has severity');
  assert(alertItem.user !== undefined && alertItem.user.fullName !== undefined, 'Alert includes user with fullName');

  // Also check /admin/alerts route
  const adminAlertsRes = await api('/admin/alerts?page=1&limit=10', { token: adminToken });
  assert(adminAlertsRes.status === 200, 'Admin can also list via /admin/alerts (200)');
  assert(adminAlertsRes.json.alerts.length === listRes.json.alerts.length, 'Both routes return matching alert count');

  // 3. Filtering by type, status, severity
  console.log('\n3. Filtering:');
  const filterTypeRes = await api(`/admin/alerts?type=${testAlert.alert_type}`, { token: adminToken });
  assert(filterTypeRes.status === 200, 'Filter by type returns 200');
  assert(filterTypeRes.json.alerts.every(a => a.alertType === testAlert.alert_type), 'Filtered by type accurately');

  const filterStatusRes = await api(`/admin/alerts?status=${testAlert.status}`, { token: adminToken });
  assert(filterStatusRes.status === 200, 'Filter by status returns 200');
  assert(filterStatusRes.json.alerts.every(a => a.status === testAlert.status), 'Filtered by status accurately');

  // 4. Alert detail
  console.log('\n4. Alert detail:');
  const detailRes = await api(`/emergency/admin/alerts/${testAlert.id}`, { token: adminToken });
  assert(detailRes.status === 200, 'Admin can fetch alert detail via /emergency/admin/alerts/:id');
  assert(detailRes.json.alert.id === testAlert.id, 'Alert ID matches');
  assert(detailRes.json.alert.user !== undefined, 'Alert detail includes user');

  const detailAdminRes = await api(`/admin/alerts/${testAlert.id}`, { token: adminToken });
  assert(detailAdminRes.status === 200, 'Admin can fetch alert detail via /admin/alerts/:id');

  const notFoundRes = await api('/admin/alerts/00000000-0000-0000-0000-000000000000', { token: adminToken });
  assert(notFoundRes.status === 404, 'Non-existent alert returns 404');

  console.log(`\n═════════════════════════════════════════════════════════════════`);
  console.log(`  All B4.4 tests passed! (${totalPassed} passed, ${totalFailed} failed)`);
  console.log(`═════════════════════════════════════════════════════════════════\n`);
}

run()
  .then(() => pool.end())
  .catch(err => {
    console.error('Test error:', err);
    pool.end();
    process.exit(1);
  });
