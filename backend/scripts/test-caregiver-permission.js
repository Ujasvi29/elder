import http from 'http';
import { app } from '../app.js';
import { query, closePool } from '../shared/db/pool.js';
import { hashPassword } from '../shared/auth/password.js';
import { normalizePhone } from '../shared/phone.js';

const TEST_PASSWORD = 'TestPassword123!';

const USERS = {
  elderly: { phone: '9000000011', fullName: 'Perm Elderly User', role: 'elderly' },
  familyNoPerm: { phone: '9000000012', fullName: 'Family Without Perm', role: 'family' },
  caregiver: { phone: '9000000014', fullName: 'Perm Caregiver', role: 'caregiver' },
};

let server;
let baseUrl;

async function request(path, options = {}) {
  const url = `${baseUrl}${path}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  const response = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }

  return { status: response.status, data: json };
}

async function run() {
  console.log('--- 1. Setting up users and verified caregiver ---');
  const passwordHash = await hashPassword(TEST_PASSWORD);
  const seeded = {};
  for (const [key, user] of Object.entries(USERS)) {
    const norm = normalizePhone(user.phone).value;
    const { rows } = await query(
      `INSERT INTO users (phone, password_hash, full_name, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (phone) DO UPDATE
          SET password_hash = EXCLUDED.password_hash,
              full_name     = EXCLUDED.full_name,
              role          = EXCLUDED.role,
              is_active     = TRUE
       RETURNING id, phone, role`,
      [norm, passwordHash, user.fullName, user.role]
    );
    seeded[key] = rows[0];
  }

  // Ensure caregiver profile exists and is verified
  const { rows: cgRows } = await query(
    `INSERT INTO caregivers (
        user_id, service_area_city, hourly_rate, specializations, languages,
        experience_years, qualifications, verification_status, id_verified
     ) VALUES (
        $1, 'Bangalore', 350, ARRAY['General Care'], ARRAY['English'],
        5, 'CNA', 'verified', TRUE
     )
     ON CONFLICT (user_id) DO UPDATE SET verification_status = 'verified', id_verified = TRUE
     RETURNING id`,
    [seeded.caregiver.id]
  );
  const caregiverId = cgRows[0].id;

  // Clean up any existing bookings for this elderly user
  await query(`DELETE FROM caregiver_bookings WHERE elderly_user_id = $1`, [seeded.elderly.id]);

  // (a) creates a family link with can_manage_caregivers: false
  console.log('\n--- 2. Creating family link with can_manage_caregivers: false ---');
  await query(
    `INSERT INTO family_links (
       elderly_user_id, family_user_id, relationship, status, can_manage_caregivers
     )
     VALUES ($1, $2, 'daughter', 'active', FALSE)
     ON CONFLICT (elderly_user_id, family_user_id) DO UPDATE
        SET status = 'active', can_manage_caregivers = FALSE`,
    [seeded.elderly.id, seeded.familyNoPerm.id]
  );

  // Start test server on random port
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://localhost:${port}`;
      console.log(`Test server running at ${baseUrl}`);
      resolve();
    });
  });

  // Login as family user
  const loginRes = await request('/auth/login', {
    method: 'POST',
    body: { phone: USERS.familyNoPerm.phone, password: TEST_PASSWORD },
  });
  if (loginRes.status !== 200 || !loginRes.data.accessToken) {
    throw new Error(`Login failed: ${JSON.stringify(loginRes.data)}`);
  }
  const token = loginRes.data.accessToken;

  // (b) attempts POST /caregiver/bookings as that family user
  console.log('\n--- 3. Attempting POST /caregiver/bookings as that family user ---');
  const bookingRes = await request('/caregiver/bookings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: {
      elderlyUserId: seeded.elderly.id,
      caregiverId,
      startDate: '2026-10-01',
      endDate: '2026-10-15',
      recurrence: 'daily',
      hoursPerVisit: 4,
      agreedRate: 350,
      specialInstructions: 'Morning assistance',
    },
  });

  console.log(`HTTP Status: ${bookingRes.status}`);
  console.log(`Response Body: ${JSON.stringify(bookingRes.data)}`);

  // (c) asserts the response is 403
  console.log('\n--- 4. Asserting response status is 403 Forbidden ---');
  if (bookingRes.status !== 403) {
    throw new Error(`Assertion failed: expected HTTP 403, got ${bookingRes.status}`);
  }
  if (bookingRes.data.code !== 'not_permitted') {
    throw new Error(`Assertion failed: expected code 'not_permitted', got '${bookingRes.data.code}'`);
  }

  console.log('\n✓ Assertion passed: Received 403 Forbidden with error "not_permitted"');
}

run()
  .then(async () => {
    console.log('\n========================================');
    console.log('TEST PASSED: Permission check verified!');
    console.log('========================================');
    await closePool();
    server.close();
  })
  .catch(async (err) => {
    console.error('\nTEST FAILED:', err);
    await closePool();
    if (server) server.close();
    process.exit(1);
  });
