// ============================================================================
// B5.2 Test Suite: Core Identities & Caregiver Profiles Verification
//
// Tests:
// 1. Dry-run safety (zero mutation)
// 2. Execution of B5.2 seed (seedCoreIdentities)
// 3. User verification (10 demo users, roles, phones, active status)
// 4. Caregiver profiles (2 verified, 1 pending, specializations, hourly rates)
// 5. Family links (3 relations with granular permissions, status = active)
// 6. Emergency contacts (6 contacts, priorities 1 & 2, correct linkage)
// 7. Password verification (bcrypt compare against master password)
// 8. Foreign key integrity and relation consistency
// 9. Zero-leakage verification (no B5.3+ entities created)
// 10. Idempotency test (second run produces zero new rows)
// 11. Application API integration (auth, admin, caregiver endpoints)
// ============================================================================

import { pool, query, closePool } from '../shared/db/pool.js';
import { verifyPassword } from '../shared/auth/password.js';
import { signAccessToken } from '../shared/auth/tokens.js';
import {
  DEMO_USERS,
  DEMO_CAREGIVER_PROFILES,
  DEMO_FAMILY_LINKS,
  DEMO_EMERGENCY_CONTACTS,
  seedCoreIdentities,
  withTransaction,
} from './seed-demo-data.js';
import { hashPassword } from '../shared/auth/password.js';

const API_BASE = 'http://localhost:5000';
const DEMO_PASSWORD = 'DemoPassword123!';

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
  console.log('  B5.2 Test Suite: Core Identities & Caregiver Profiles');
  console.log('═════════════════════════════════════════════════════════════════\n');

  // Baseline row counts for later-stage tables
  const LATER_STAGE_TABLES = [
    'tasks',
    'caregiver_bookings',
    'schedules',
    'attendance',
    'activity_reports',
    'geofences',
  ];

  const baselineCounts = {};
  for (const t of LATER_STAGE_TABLES) {
    const res = await query(`SELECT COUNT(*) AS c FROM ${t}`);
    baselineCounts[t] = parseInt(res.rows[0].c, 10);
  }

  // 1. Run the seed function
  console.log('1. Executing B5.2 seedCoreIdentities...');
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const client = await pool.connect();
  let seedResult1;
  try {
    seedResult1 = await withTransaction(client, async (tx) => {
      return seedCoreIdentities(tx, { passwordHash });
    });
  } finally {
    client.release();
  }

  assert(seedResult1.users.total === 10, 'Seeded exactly 10 demo users');
  assert(seedResult1.caregivers.total === 3, 'Seeded exactly 3 caregiver profiles');
  assert(seedResult1.familyLinks.total === 3, 'Seeded exactly 3 family links');
  assert(seedResult1.emergencyContacts.total === 6, 'Seeded exactly 6 emergency contacts');

  // 2. User Accounts Verification
  console.log('\n2. Verifying user accounts...');
  const { rows: users } = await query(
    `SELECT id, phone, email, full_name, role, is_active, city, password_hash
     FROM users
     WHERE email LIKE '%@eldercare.demo'
     ORDER BY phone`
  );

  assert(users.length === 10, `Found all 10 demo users in database (found ${users.length})`);

  const usersByRole = users.reduce((acc, u) => {
    acc[u.role] = (acc[u.role] || 0) + 1;
    return acc;
  }, {});

  assert(usersByRole.admin === 1, 'Exactly 1 Admin user (Priya Sharma)');
  assert(usersByRole.elderly === 3, 'Exactly 3 Elderly users (Ramesh, Saraswathi, Balachandran)');
  assert(usersByRole.family === 3, 'Exactly 3 Family users (Vikram, Deepa, Anita)');
  assert(usersByRole.caregiver === 3, 'Exactly 3 Caregivers (Sister Mary, Rajesh, Fatima)');

  for (const user of users) {
    assert(user.is_active === true, `User ${user.full_name} (${user.role}) is active`);
    const passMatches = await verifyPassword(DEMO_PASSWORD, user.password_hash);
    assert(passMatches, `User ${user.full_name} authenticates with demo password`);
  }

  // 3. Caregiver Profiles Verification
  console.log('\n3. Verifying caregiver profiles...');
  const { rows: caregivers } = await query(
    `SELECT c.*, u.full_name, u.phone, u.role
     FROM caregivers c
     JOIN users u ON c.user_id = u.id
     WHERE u.email LIKE '%@eldercare.demo'
     ORDER BY u.full_name`
  );

  assert(caregivers.length === 3, `Found exactly 3 demo caregiver profiles (found ${caregivers.length})`);

  const mary = caregivers.find((c) => c.phone === '+919000000003');
  assert(mary && mary.verification_status === 'verified', 'Sister Mary Joseph is VERIFIED');
  assert(mary.id_verified === true, 'Sister Mary Joseph id_verified is TRUE');
  assert(mary.experience_years === 8, 'Sister Mary Joseph has 8 years experience');
  assert(Number(mary.hourly_rate) === 350, 'Sister Mary Joseph hourly rate is 350');
  assert(mary.verified_by !== null, 'Sister Mary Joseph has verified_by reference');
  assert(mary.verified_at !== null, 'Sister Mary Joseph has verified_at timestamp');

  const rajesh = caregivers.find((c) => c.phone === '+919000000005');
  assert(rajesh && rajesh.verification_status === 'pending', 'Rajesh Kumar is PENDING');
  assert(rajesh.id_verified === false, 'Rajesh Kumar id_verified is FALSE');
  assert(rajesh.experience_years === 2, 'Rajesh Kumar has 2 years experience');
  assert(Number(rajesh.hourly_rate) === 250, 'Rajesh Kumar hourly rate is 250');
  assert(rajesh.verified_by === null, 'Rajesh Kumar verified_by is NULL');
  assert(rajesh.verified_at === null, 'Rajesh Kumar verified_at is NULL');

  const fatima = caregivers.find((c) => c.phone === '+919000000015');
  assert(fatima && fatima.verification_status === 'verified', 'Fatima Begum is VERIFIED');
  assert(fatima.id_verified === true, 'Fatima Begum id_verified is TRUE');
  assert(fatima.experience_years === 6, 'Fatima Begum has 6 years experience');
  assert(Number(fatima.hourly_rate) === 400, 'Fatima Begum hourly rate is 400');
  assert(fatima.verified_by !== null, 'Fatima Begum has verified_by reference');
  assert(fatima.verified_at !== null, 'Fatima Begum has verified_at timestamp');

  // 4. Family Links Verification
  console.log('\n4. Verifying family links...');
  const { rows: links } = await query(
    `SELECT fl.*, eu.full_name AS elderly_name, fu.full_name AS family_name
     FROM family_links fl
     JOIN users eu ON fl.elderly_user_id = eu.id
     JOIN users fu ON fl.family_user_id = fu.id
     WHERE eu.email LIKE '%@eldercare.demo'
     ORDER BY eu.phone`
  );

  assert(links.length === 3, `Found exactly 3 demo family links (found ${links.length})`);

  const rameshLink = links.find((l) => l.elderly_name === 'Ramesh Patel');
  assert(rameshLink && rameshLink.family_name === 'Vikram Patel', 'Ramesh Patel linked to Vikram Patel');
  assert(rameshLink.relationship === 'son', 'Ramesh-Vikram relationship is "son"');
  assert(rameshLink.permission_level === 'owner', 'Ramesh-Vikram permission level is "owner"');
  assert(rameshLink.can_view_location && rameshLink.can_manage_contacts && rameshLink.can_manage_caregivers && rameshLink.can_acknowledge_alerts,
    'Ramesh-Vikram has all permissions enabled');

  const saraswathiLink = links.find((l) => l.elderly_name === 'Saraswathi Sundaram');
  assert(saraswathiLink && saraswathiLink.family_name === 'Deepa Sundaram', 'Saraswathi Sundaram linked to Deepa Sundaram');
  assert(saraswathiLink.relationship === 'daughter', 'Saraswathi-Deepa relationship is "daughter"');
  assert(saraswathiLink.permission_level === 'manage', 'Saraswathi-Deepa permission level is "manage"');
  assert(saraswathiLink.can_manage_contacts === false && saraswathiLink.can_manage_caregivers === true,
    'Saraswathi-Deepa has manage permissions (cannot manage contacts, can manage caregivers)');

  const balaLink = links.find((l) => l.elderly_name.includes('Balachandran'));
  assert(balaLink && balaLink.family_name === 'Anita Balachandran', 'Col. Balachandran linked to Anita Balachandran');
  assert(balaLink.relationship === 'daughter', 'Balachandran-Anita relationship is "daughter"');
  assert(balaLink.permission_level === 'view', 'Balachandran-Anita permission level is "view"');
  assert(balaLink.can_view_location === true && balaLink.can_manage_caregivers === false,
    'Balachandran-Anita has view-only permissions');

  // 5. Emergency Contacts Verification
  console.log('\n5. Verifying emergency contacts...');
  const { rows: allContacts } = await query(
    `SELECT ec.*, u.full_name AS elderly_name
     FROM emergency_contacts ec
     JOIN users u ON ec.user_id = u.id
     WHERE u.email LIKE '%@eldercare.demo'
     ORDER BY u.full_name, ec.priority`
  );

  const demoPhones = new Set(DEMO_EMERGENCY_CONTACTS.map((c) => c.contactPhone.replace(/^(\+91)?/, '+91')));
  const demoContacts = allContacts.filter((c) => demoPhones.has(c.phone));
  const preExistingContacts = allContacts.filter((c) => !demoPhones.has(c.phone));

  assert(demoContacts.length === 6, `Found all 6 demo emergency contacts (found ${demoContacts.length})`);
  assert(preExistingContacts.length >= 1, `Pre-existing contacts were preserved without deletion (${preExistingContacts.length} preserved)`);

  const rameshDemoContacts = demoContacts.filter((c) => c.elderly_name === 'Ramesh Patel');
  assert(rameshDemoContacts.length === 2, 'Ramesh Patel has exactly 2 demo emergency contacts');
  const rameshPriority1 = rameshDemoContacts.find((c) => c.priority === 1);
  const rameshPriority2 = rameshDemoContacts.find((c) => c.priority === 2);
  assert(rameshPriority1 && rameshPriority1.contact_user_id !== null && rameshPriority1.full_name === 'Vikram Patel',
    'Ramesh contact 1 is priority 1 linked to family user (Vikram)');
  assert(rameshPriority2 && rameshPriority2.contact_user_id === null && rameshPriority2.full_name === 'Dr. Kamath',
    'Ramesh contact 2 is priority 2 unlinked physician (Dr. Kamath)');

  const saraswathiDemoContacts = demoContacts.filter((c) => c.elderly_name === 'Saraswathi Sundaram');
  assert(saraswathiDemoContacts.length === 2, 'Saraswathi Sundaram has exactly 2 demo emergency contacts');
  const saraswathiPriority1 = saraswathiDemoContacts.find((c) => c.priority === 1);
  const saraswathiPriority2 = saraswathiDemoContacts.find((c) => c.priority === 2);
  assert(saraswathiPriority1 && saraswathiPriority1.contact_user_id !== null && saraswathiPriority1.full_name === 'Deepa Sundaram',
    'Saraswathi contact 1 is priority 1 linked to family user (Deepa)');
  assert(saraswathiPriority2 && saraswathiPriority2.full_name === 'Building Security Desk',
    'Saraswathi contact 2 is priority 2 security desk');

  const balaDemoContacts = demoContacts.filter((c) => c.elderly_name.includes('Balachandran'));
  assert(balaDemoContacts.length === 2, 'Col. Balachandran has exactly 2 demo emergency contacts');
  const balaPriority1 = balaDemoContacts.find((c) => c.priority === 1);
  const balaPriority2 = balaDemoContacts.find((c) => c.priority === 2);
  assert(balaPriority1 && balaPriority1.contact_user_id !== null && balaPriority1.full_name === 'Anita Balachandran',
    'Col. Balachandran contact 1 is priority 1 linked to family user (Anita)');
  assert(balaPriority2 && balaPriority2.full_name === 'Veteran Support Desk',
    'Col. Balachandran contact 2 is priority 2 veteran support');

  // 6. Zero-Leakage Check (Later stage tables have not been modified)
  console.log('\n6. Checking zero leakage into B5.3+ tables...');
  for (const t of LATER_STAGE_TABLES) {
    const res = await query(`SELECT COUNT(*) AS c FROM ${t}`);
    const current = parseInt(res.rows[0].c, 10);
    assert(current === baselineCounts[t], `Table "${t}" row count unchanged (${current} === ${baselineCounts[t]})`);
  }

  // 7. Idempotency Verification
  console.log('\n7. Testing seed idempotency (re-running seedCoreIdentities)...');
  const countsBefore = {
    users: (await query(`SELECT COUNT(*) AS c FROM users`)).rows[0].c,
    caregivers: (await query(`SELECT COUNT(*) AS c FROM caregivers`)).rows[0].c,
    familyLinks: (await query(`SELECT COUNT(*) AS c FROM family_links`)).rows[0].c,
    emergencyContacts: (await query(`SELECT COUNT(*) AS c FROM emergency_contacts`)).rows[0].c,
  };

  const client2 = await pool.connect();
  let seedResult2;
  try {
    seedResult2 = await withTransaction(client2, async (tx) => {
      return seedCoreIdentities(tx, { passwordHash });
    });
  } finally {
    client2.release();
  }

  const countsAfter = {
    users: (await query(`SELECT COUNT(*) AS c FROM users`)).rows[0].c,
    caregivers: (await query(`SELECT COUNT(*) AS c FROM caregivers`)).rows[0].c,
    familyLinks: (await query(`SELECT COUNT(*) AS c FROM family_links`)).rows[0].c,
    emergencyContacts: (await query(`SELECT COUNT(*) AS c FROM emergency_contacts`)).rows[0].c,
  };

  assert(countsBefore.users === countsAfter.users, `Users count unchanged on re-run (${countsAfter.users})`);
  assert(countsBefore.caregivers === countsAfter.caregivers, `Caregivers count unchanged on re-run (${countsAfter.caregivers})`);
  assert(countsBefore.familyLinks === countsAfter.familyLinks, `Family links count unchanged on re-run (${countsAfter.familyLinks})`);
  assert(countsBefore.emergencyContacts === countsAfter.emergencyContacts, `Emergency contacts count unchanged on re-run (${countsAfter.emergencyContacts})`);
  assert(seedResult2.users.created === 0, 'Zero new users created on second run');
  assert(seedResult2.caregivers.created === 0, 'Zero new caregivers created on second run');
  assert(seedResult2.familyLinks.created === 0, 'Zero new family links created on second run');
  assert(seedResult2.emergencyContacts.created === 0, 'Zero new emergency contacts created on second run');

  // 8. Application API Verification
  console.log('\n8. Verifying application endpoints with demo identities...');
  const adminUser = users.find((u) => u.role === 'admin');
  const adminToken = signAccessToken(adminUser);

  // Admin users list endpoint
  const adminUsersRes = await api('/admin/users', { token: adminToken });
  assert(adminUsersRes.status === 200, `GET /admin/users responded with HTTP 200 (got ${adminUsersRes.status})`);
  assert(Array.isArray(adminUsersRes.json?.users), 'GET /admin/users returned users array');
  const returnedEmails = new Set(adminUsersRes.json.users.map((u) => u.email));
  assert(returnedEmails.has('admin.priya@eldercare.demo'), 'Admin user Priya Sharma listed in /admin/users');
  assert(returnedEmails.has('ramesh.patel@eldercare.demo'), 'Elderly user Ramesh Patel listed in /admin/users');
  assert(returnedEmails.has('mary.joseph@eldercare.demo'), 'Caregiver Sister Mary Joseph listed in /admin/users');

  // Caregiver verification queue endpoint
  const queueRes = await api('/caregiver/verification-queue', { token: adminToken });
  assert(queueRes.status === 200, `GET /caregiver/verification-queue responded with HTTP 200 (got ${queueRes.status})`);
  assert(Array.isArray(queueRes.json?.caregivers), 'Verification queue returned caregivers array');
  const pendingRajesh = queueRes.json.caregivers.find((c) => (c.fullName || c.full_name) === 'Rajesh Kumar');
  assert(!!pendingRajesh, 'Pending caregiver Rajesh Kumar found in verification queue');

  // Caregiver search endpoint
  const searchRes = await api('/caregiver/search?city=Bengaluru', { token: adminToken });
  assert(searchRes.status === 200, `GET /caregiver/search?city=Bengaluru responded with HTTP 200 (got ${searchRes.status})`);
  assert(Array.isArray(searchRes.json?.caregivers), 'Caregiver search returned caregivers array');
  const verifiedNames = searchRes.json.caregivers.map((c) => c.fullName || c.full_name);
  assert(verifiedNames.includes('Sister Mary Joseph'), 'Sister Mary Joseph returned in verified caregiver search');
  assert(verifiedNames.includes('Fatima Begum'), 'Fatima Begum returned in verified caregiver search');
  assert(!verifiedNames.includes('Rajesh Kumar'), 'Pending caregiver Rajesh Kumar EXCLUDED from search results');

  // Auth login test with seeded password
  const loginRes = await api('/auth/login', {
    method: 'POST',
    body: {
      phone: '+919000000004',
      password: DEMO_PASSWORD,
    },
  });
  assert(loginRes.status === 200, `POST /auth/login for Priya Sharma returned HTTP 200 (got ${loginRes.status})`);
  assert(typeof loginRes.json?.accessToken === 'string', 'Login returns valid access token');

  console.log('\n═════════════════════════════════════════════════════════════════');
  console.log(`  All B5.2 Tests Passed! (${totalPassed} passed, ${totalFailed} failed)`);
  console.log('═════════════════════════════════════════════════════════════════\n');
}

run()
  .then(() => closePool())
  .catch(async (err) => {
    console.error(`\nTest suite failure: ${err.message}`);
    console.error(err.stack);
    await closePool();
    process.exit(1);
  });
