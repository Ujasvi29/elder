// ============================================================================
// B5.4 Test Suite: Safety, Geofences, Alerts & Notification Feeds Verification
//
// Tests:
// 1.  Dry-run safety (zero database mutations across all 21 tables)
// 2.  Execution of B5.4 seedSafetyAndAlerts in managed transaction
// 2b. Counter-accuracy: created/updated counters match actual DB row deltas
// 3.  Geofences verification (2 demo zones, coordinates, radius, type, active)
// 4.  Locations verification (12 sequential GPS points for Ramesh, breach trajectory)
// 5.  Alerts verification (3 demo alerts: SOS active, fall ack'd, geofence resolved)
// 6.  Notification feed verification (8 demo items across inboxes, event_types, read flags)
// 7.  Event ID linkage verification (alert, booking, task deterministic UUIDs)
// 8.  Foreign key integrity across all 4 entities
// 9.  Pre-existing data preservation (85 locations, 44 alerts, 2 feed rows intact)
// 10. Idempotency test (second run produces zero new rows, identical counts)
// 11. Zero-leakage check (17 other database tables untouched)
// 12. Application API integration (geofences, family alerts, history, admin alerts, notifications)
// ============================================================================

import { pool, query, closePool } from '../shared/db/pool.js';
import { signAccessToken } from '../shared/auth/tokens.js';
import {
  seedCoreIdentities,
  seedCareOperations,
  seedSafetyAndAlerts,
  withTransaction,
  generateDeterministicUuid,
  DEMO_GEOFENCES,
  getDemoLocationRoute,
  getDemoAlerts,
  getDemoNotificationFeed,
} from './seed-demo-data.js';

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
  return { status: res.status, json, text };
}

async function run() {
  console.log('═════════════════════════════════════════════════════════════════');
  console.log('  B5.4 Test Suite: Safety, Geofences, Alerts & Feeds');
  console.log('═════════════════════════════════════════════════════════════════\n');

  // Freeze anchor date for reproducible test runs
  const anchorDate = new Date();

  // Pre-calculate deterministic IDs for B5.4 entities
  const b54DemoIds = {
    geofences: DEMO_GEOFENCES.map((g) => generateDeterministicUuid('geofences', g.key)),
    locations: getDemoLocationRoute(anchorDate).map((l) => generateDeterministicUuid('locations', l.key)),
    alerts: getDemoAlerts(anchorDate).map((a) => generateDeterministicUuid('alerts', a.key)),
    notification_feed: getDemoNotificationFeed(anchorDate).map((n) => generateDeterministicUuid('notification_feed', n.key)),
  };

  // -------------------------------------------------------------------------
  // Establish safe fresh state for B5.4 entities only
  // -------------------------------------------------------------------------
  console.log('Establishing safe fresh state for B5.4 entities...');
  await query('DELETE FROM notification_feed WHERE id = ANY($1::uuid[])', [b54DemoIds.notification_feed]);
  await query('DELETE FROM alerts WHERE id = ANY($1::uuid[])', [b54DemoIds.alerts]);
  await query('DELETE FROM locations WHERE id = ANY($1::uuid[])', [b54DemoIds.locations]);
  await query('DELETE FROM geofences WHERE id = ANY($1::uuid[])', [b54DemoIds.geofences]);

  const preCounts = {};
  for (const t of ['geofences', 'locations', 'alerts', 'notification_feed']) {
    const res = await query(`SELECT COUNT(*) AS c FROM ${t}`);
    preCounts[t] = parseInt(res.rows[0].c, 10);
  }
  console.log(`  Pre-counts: geofences=${preCounts.geofences}, locations=${preCounts.locations}, alerts=${preCounts.alerts}, notification_feed=${preCounts.notification_feed}`);

  // Record clean baseline counts for all 21 tables
  const ALL_TABLES = [
    'users', 'caregivers', 'family_links', 'emergency_contacts',
    'care_plans', 'caregiver_bookings', 'schedules', 'attendance',
    'tasks', 'activity_reports', 'reviews', 'geofences',
    'locations', 'alerts', 'notification_feed', 'device_tokens',
    'disaster_alerts', 'ambulance_bookings', 'notifications',
    'push_receipt_tickets', 'refresh_tokens',
  ];

  const baselines = {};
  for (const t of ALL_TABLES) {
    const res = await query(`SELECT COUNT(*) AS c FROM ${t}`);
    baselines[t] = parseInt(res.rows[0].c, 10);
  }

  // -------------------------------------------------------------------------
  // 1. Dry-Run Safety Verification
  // -------------------------------------------------------------------------
  console.log('\n1. Verifying dry-run safety...');
  const { execSync } = await import('node:child_process');
  const dryRunOutput = execSync(
    'node --env-file=.env backend/scripts/seed-demo-data.js DemoPassword123! --dry-run',
    { cwd: process.cwd(), encoding: 'utf-8' }
  );

  assert(dryRunOutput.includes('DRY RUN ACTIVE'), 'Dry-run announced in output');
  assert(dryRunOutput.includes('Planned B5.4 mutations:'), 'Dry-run lists B5.4 mutations');
  assert(dryRunOutput.includes('geofences:         2 safe zones to upsert'), 'Dry-run lists 2 geofences');
  assert(dryRunOutput.includes('locations:         12 GPS readings to upsert'), 'Dry-run lists 12 locations');
  assert(dryRunOutput.includes('alerts:            3 alerts to upsert'), 'Dry-run lists 3 alerts');
  assert(dryRunOutput.includes('notification_feed: 8 feed items to upsert'), 'Dry-run lists 8 notification items');

  // Verify zero mutations across all 21 tables
  for (const t of ALL_TABLES) {
    const res = await query(`SELECT COUNT(*) AS c FROM ${t}`);
    const current = parseInt(res.rows[0].c, 10);
    assert(current === baselines[t], `Dry-run made zero changes to ${t} (${current} === ${baselines[t]})`);
  }

  // -------------------------------------------------------------------------
  // 2. Seeding B5.4 in Managed Transaction & Counter Accuracy
  // -------------------------------------------------------------------------
  console.log('\n2. Executing seedSafetyAndAlerts in managed transaction...');
  const client = await pool.connect();
  let results;
  try {
    results = await withTransaction(client, async (tx) => {
      return await seedSafetyAndAlerts(tx, { anchorDate });
    });
  } finally {
    client.release();
  }

  const postCounts = {};
  for (const t of ['geofences', 'locations', 'alerts', 'notification_feed']) {
    const res = await query(`SELECT COUNT(*) AS c FROM ${t}`);
    postCounts[t] = parseInt(res.rows[0].c, 10);
  }
  console.log(`  Post-counts: geofences=${postCounts.geofences}, locations=${postCounts.locations}, alerts=${postCounts.alerts}, notification_feed=${postCounts.notification_feed}`);

  // 2b. Counter Accuracy Assertions
  console.log('\n2b. Verifying counter accuracy via xmax...');
  assert(
    postCounts.geofences - preCounts.geofences === results.geofences.created,
    `Geofences DB delta matches reported created (${postCounts.geofences - preCounts.geofences} === ${results.geofences.created})`
  );
  assert(results.geofences.created === 2, '2 geofences created on fresh state');
  assert(results.geofences.updated === 0, '0 geofences updated on fresh state');
  assert(results.geofences.total === 2, '2 total geofences');

  assert(
    postCounts.locations - preCounts.locations === results.locations.created,
    `Locations DB delta matches reported created (${postCounts.locations - preCounts.locations} === ${results.locations.created})`
  );
  assert(results.locations.created === 12, '12 locations created on fresh state');
  assert(results.locations.updated === 0, '0 locations updated on fresh state');
  assert(results.locations.total === 12, '12 total locations');

  assert(
    postCounts.alerts - preCounts.alerts === results.alerts.created,
    `Alerts DB delta matches reported created (${postCounts.alerts - preCounts.alerts} === ${results.alerts.created})`
  );
  assert(results.alerts.created === 3, '3 alerts created on fresh state');
  assert(results.alerts.updated === 0, '0 alerts updated on fresh state');
  assert(results.alerts.total === 3, '3 total alerts');

  assert(
    postCounts.notification_feed - preCounts.notification_feed === results.notificationFeed.created,
    `Notification feed DB delta matches reported created (${postCounts.notification_feed - preCounts.notification_feed} === ${results.notificationFeed.created})`
  );
  assert(results.notificationFeed.created === 8, '8 feed items created on fresh state');
  assert(results.notificationFeed.updated === 0, '0 feed items updated on fresh state');
  assert(results.notificationFeed.total === 8, '8 total feed items');

  // -------------------------------------------------------------------------
  // 3. Geofences Verification
  // -------------------------------------------------------------------------
  console.log('\n3. Verifying geofences...');
  const { rows: geoRows } = await query(
    'SELECT * FROM geofences WHERE id = ANY($1::uuid[]) ORDER BY name',
    [b54DemoIds.geofences]
  );
  assert(geoRows.length === 2, 'Found 2 demo geofences in DB');
  const indiranagar = geoRows.find((g) => g.name.includes('Indiranagar'));
  const malleshwaram = geoRows.find((g) => g.name.includes('Malleshwaram'));

  assert(indiranagar && Number(indiranagar.radius_meters) === 400, 'Indiranagar geofence radius is 400m');
  assert(malleshwaram && Number(malleshwaram.radius_meters) === 500, 'Malleshwaram geofence radius is 500m');
  assert(malleshwaram.alert_on_exit === true && malleshwaram.alert_on_enter === false, 'Malleshwaram alerts on exit only');
  assert(malleshwaram.is_active === true, 'Malleshwaram geofence is active');
  assert(malleshwaram.fence_type === 'safe_zone', 'Fence type is safe_zone');

  // -------------------------------------------------------------------------
  // 4. Locations Verification
  // -------------------------------------------------------------------------
  console.log('\n4. Verifying locations...');
  const { rows: locRows } = await query(
    'SELECT * FROM locations WHERE id = ANY($1::uuid[]) ORDER BY recorded_at ASC',
    [b54DemoIds.locations]
  );
  assert(locRows.length === 12, 'Found 12 demo location readings in DB');
  assert(locRows[0].is_moving === false, 'First location reading is stationary');
  assert(locRows[1].is_moving === true, 'Second location reading is moving');
  assert(locRows[5].speed_mps !== null, 'Breach waypoint has recorded speed');
  assert(locRows[11].is_moving === false, 'Final return waypoint is stationary');

  // Verify timestamps are sequential
  for (let i = 1; i < locRows.length; i++) {
    const prev = new Date(locRows[i - 1].recorded_at).getTime();
    const curr = new Date(locRows[i].recorded_at).getTime();
    assert(curr > prev, `Location ${i} recorded_at is strictly after location ${i - 1}`);
  }

  // -------------------------------------------------------------------------
  // 5. Alerts Verification
  // -------------------------------------------------------------------------
  console.log('\n5. Verifying alerts...');
  const { rows: alertRows } = await query(
    'SELECT * FROM alerts WHERE id = ANY($1::uuid[]) ORDER BY triggered_at ASC',
    [b54DemoIds.alerts]
  );
  assert(alertRows.length === 3, 'Found 3 demo alerts in DB');

  const sosAlert = alertRows.find((a) => a.alert_type === 'sos');
  const fallAlert = alertRows.find((a) => a.alert_type === 'fall');
  const geoAlert = alertRows.find((a) => a.alert_type === 'geofence_breach');

  assert(sosAlert && sosAlert.status === 'active' && sosAlert.severity === 'critical', 'SOS alert is active & critical');
  assert(sosAlert.acknowledged_at === null && sosAlert.resolved_at === null, 'SOS alert is unacknowledged');

  assert(fallAlert && fallAlert.status === 'active' && fallAlert.severity === 'high', 'Fall alert is active & high severity');
  assert(fallAlert.acknowledged_at !== null && fallAlert.acknowledged_by !== null, 'Fall alert is acknowledged');

  assert(geoAlert && geoAlert.status === 'resolved' && geoAlert.severity === 'medium', 'Geofence breach alert is resolved');
  assert(geoAlert.geofence_id !== null, 'Geofence alert references geofence_id');
  assert(geoAlert.location_id !== null, 'Geofence alert references location_id');
  assert(geoAlert.resolved_at !== null && geoAlert.resolved_by !== null, 'Geofence alert has resolution details');

  // -------------------------------------------------------------------------
  // 6. Notification Feed Verification
  // -------------------------------------------------------------------------
  console.log('\n6. Verifying notification feed...');
  const { rows: nfRows } = await query(
    'SELECT * FROM notification_feed WHERE id = ANY($1::uuid[]) ORDER BY created_at ASC',
    [b54DemoIds.notification_feed]
  );
  assert(nfRows.length === 8, 'Found 8 demo notification feed rows in DB');

  const unreadCount = nfRows.filter((n) => !n.is_read).length;
  const readCount = nfRows.filter((n) => n.is_read).length;
  assert(unreadCount === 3, 'Found exactly 3 unread notification items (SOS Vikram, SOS Priya, Task Rajesh)');
  assert(readCount === 5, 'Found exactly 5 read notification items');

  // -------------------------------------------------------------------------
  // 7. Event ID Linkage Verification
  // -------------------------------------------------------------------------
  console.log('\n7. Verifying notification_feed.event_id linkages...');
  const vikramSosFeed = nfRows.find((n) => n.title.includes('SOS Alert — Ramesh Patel'));
  assert(vikramSosFeed && vikramSosFeed.event_id === sosAlert.id, 'SOS notification references SOS alert ID');

  const maryBookingFeed = nfRows.find((n) => n.title.includes('New Booking Confirmed'));
  const expectedBookingId = generateDeterministicUuid('caregiver_bookings', 'booking_ramesh_mary');
  assert(maryBookingFeed && maryBookingFeed.event_id === expectedBookingId, 'Booking notification references deterministic booking ID');

  const rajeshTaskFeed = nfRows.find((n) => n.title.includes('New Task Assigned'));
  const expectedTaskId = generateDeterministicUuid('tasks', 'task_saraswathi_hydration');
  assert(rajeshTaskFeed && rajeshTaskFeed.event_id === expectedTaskId, 'Task notification references deterministic task ID');

  // -------------------------------------------------------------------------
  // 8. Foreign Key Integrity Check
  // -------------------------------------------------------------------------
  console.log('\n8. Verifying foreign key integrity...');
  const { rows: orphanGeofences } = await query(`
    SELECT g.id FROM geofences g LEFT JOIN users u ON g.user_id = u.id WHERE u.id IS NULL
  `);
  assert(orphanGeofences.length === 0, 'Zero orphan geofences (all user_id resolve)');

  const { rows: orphanLocations } = await query(`
    SELECT l.id FROM locations l LEFT JOIN users u ON l.user_id = u.id WHERE u.id IS NULL
  `);
  assert(orphanLocations.length === 0, 'Zero orphan locations (all user_id resolve)');

  const { rows: orphanAlerts } = await query(`
    SELECT a.id FROM alerts a LEFT JOIN users u ON a.user_id = u.id WHERE u.id IS NULL
  `);
  assert(orphanAlerts.length === 0, 'Zero orphan alerts (all user_id resolve)');

  const { rows: orphanNf } = await query(`
    SELECT nf.id FROM notification_feed nf LEFT JOIN users u ON nf.recipient_user_id = u.id WHERE u.id IS NULL
  `);
  assert(orphanNf.length === 0, 'Zero orphan notification_feed items (all recipient_user_id resolve)');

  // -------------------------------------------------------------------------
  // 9. Pre-Existing Data Preservation
  // -------------------------------------------------------------------------
  console.log('\n9. Verifying preservation of pre-existing data...');
  const { rows: preExistingLocs } = await query(`
    SELECT count(*) AS c FROM locations WHERE recorded_at <= '2026-09-03T23:59:59Z'
  `);
  assert(parseInt(preExistingLocs[0].c, 10) === 85, 'All 85 pre-existing locations preserved');

  const { rows: preExistingAlerts } = await query(`
    SELECT count(*) AS c FROM alerts WHERE id NOT IN ($1, $2, $3)`,
    [sosAlert.id, fallAlert.id, geoAlert.id]
  );
  assert(parseInt(preExistingAlerts[0].c, 10) === 44, 'All 44 pre-existing alerts preserved');

  const { rows: preExistingNf } = await query(`
    SELECT count(*) AS c FROM notification_feed WHERE NOT (id = ANY($1::uuid[]))`,
    [b54DemoIds.notification_feed]
  );
  assert(parseInt(preExistingNf[0].c, 10) === 2, 'All 2 pre-existing notification feed items preserved');

  // -------------------------------------------------------------------------
  // 10. Idempotency Verification
  // -------------------------------------------------------------------------
  console.log('\n10. Verifying idempotency (second run produces zero new rows)...');
  const client2 = await pool.connect();
  let results2;
  try {
    results2 = await withTransaction(client2, async (tx) => {
      return await seedSafetyAndAlerts(tx, { anchorDate });
    });
  } finally {
    client2.release();
  }

  assert(results2.geofences.created === 0, 'Second run: 0 geofences created');
  assert(results2.geofences.updated === 2, 'Second run: 2 geofences updated');
  assert(results2.locations.created === 0, 'Second run: 0 locations created');
  assert(results2.locations.updated === 12, 'Second run: 12 locations updated');
  assert(results2.alerts.created === 0, 'Second run: 0 alerts created');
  assert(results2.alerts.updated === 3, 'Second run: 3 alerts updated');
  assert(results2.notificationFeed.created === 0, 'Second run: 0 notification feed items created');
  assert(results2.notificationFeed.updated === 8, 'Second run: 8 notification feed items updated');

  for (const t of ['geofences', 'locations', 'alerts', 'notification_feed']) {
    const res = await query(`SELECT COUNT(*) AS c FROM ${t}`);
    const finalCount = parseInt(res.rows[0].c, 10);
    assert(finalCount === postCounts[t], `${t} count unchanged after second run (${finalCount} === ${postCounts[t]})`);
  }

  // -------------------------------------------------------------------------
  // 11. Zero Leakage into Other Tables
  // -------------------------------------------------------------------------
  console.log('\n11. Verifying zero leakage into untouched tables...');
  const UNTOUCHED_TABLES = ALL_TABLES.filter(
    (t) => !['geofences', 'locations', 'alerts', 'notification_feed'].includes(t)
  );
  for (const t of UNTOUCHED_TABLES) {
    const res = await query(`SELECT COUNT(*) AS c FROM ${t}`);
    const current = parseInt(res.rows[0].c, 10);
    assert(current === baselines[t], `Untouched table ${t} count preserved (${current} === ${baselines[t]})`);
  }

  // -------------------------------------------------------------------------
  // 12. Application API Read Integration Verification
  // -------------------------------------------------------------------------
  console.log('\n12. Verifying application API endpoints...');
  const { rows: userRows } = await query('SELECT id, phone, role FROM users');
  const userMap = {};
  for (const u of userRows) userMap[u.phone] = u;

  const ramesh = userMap['+919000000001'];
  const vikram = userMap['+919000000002'];
  const priya = userMap['+919000000004'];

  const rameshToken = signAccessToken({ id: ramesh.id, phone: ramesh.phone, role: ramesh.role });
  const vikramToken = signAccessToken({ id: vikram.id, phone: vikram.phone, role: vikram.role });
  const priyaToken = signAccessToken({ id: priya.id, phone: priya.phone, role: priya.role });

  // 12a. GET /emergency/geofences (Ramesh)
  const geoApi = await api('/emergency/geofences', { token: rameshToken });
  assert(geoApi.status === 200, 'GET /emergency/geofences returns 200');
  assert(Array.isArray(geoApi.json?.geofences) && geoApi.json.geofences.length >= 1, 'Ramesh has at least 1 geofence via API');
  assert(geoApi.json.geofences.some((g) => g.name.includes('Malleshwaram')), 'API returns Malleshwaram safe zone');

  // 12b. GET /emergency/family/alerts (Vikram)
  const famAlertsApi = await api('/emergency/family/alerts', { token: vikramToken });
  assert(famAlertsApi.status === 200, 'GET /emergency/family/alerts returns 200');
  assert(Array.isArray(famAlertsApi.json?.alerts) && famAlertsApi.json.alerts.length >= 1, 'Vikram sees active family alerts');
  assert(famAlertsApi.json.alerts.some((a) => a.alertType === 'sos'), 'Family alerts list includes active SOS');

  // 12c. GET /emergency/family/alerts/history (Vikram)
  const famHistoryApi = await api('/emergency/family/alerts/history', { token: vikramToken });
  assert(famHistoryApi.status === 200, 'GET /emergency/family/alerts/history returns 200');
  assert(Array.isArray(famHistoryApi.json?.alerts), 'Family alert history returns alerts array');
  assert(famHistoryApi.json.alerts.some((a) => a.alertType === 'geofence_breach'), 'Alert history contains resolved geofence breach alert');

  // 12d. GET /emergency/admin/alerts (Priya)
  const adminAlertsApi = await api('/emergency/admin/alerts', { token: priyaToken });
  assert(adminAlertsApi.status === 200, 'GET /emergency/admin/alerts returns 200');
  assert(adminAlertsApi.json && Array.isArray(adminAlertsApi.json.alerts), 'Admin alert overview returns alerts array');
  assert(adminAlertsApi.json.total >= 47, `Admin alert overview shows total alerts (total: ${adminAlertsApi.json.total})`);

  // 12e. GET /notifications (Vikram)
  const nfApi = await api('/notifications', { token: vikramToken });
  assert(nfApi.status === 200, 'GET /notifications returns 200');
  assert(nfApi.json && Array.isArray(nfApi.json.notifications), 'Notifications returns array');
  assert(nfApi.json.notifications.some((n) => n.title.includes('SOS Alert')), 'Vikram has SOS notification');

  // 12f. GET /notifications/unread-count (Vikram)
  const unreadApi = await api('/notifications/unread-count', { token: vikramToken });
  assert(unreadApi.status === 200, 'GET /notifications/unread-count returns 200');
  assert(typeof unreadApi.json.count === 'number', 'Unread count is a number');

  console.log(`\n═════════════════════════════════════════════════════════════════`);
  console.log(`  All B5.4 Tests Passed! (${totalPassed} passed, ${totalFailed} failed)`);
  console.log(`═════════════════════════════════════════════════════════════════`);
}

run()
  .then(() => closePool())
  .catch(async (err) => {
    console.error(`\nTest suite failed: ${err.message}`);
    await closePool();
    process.exit(1);
  });
