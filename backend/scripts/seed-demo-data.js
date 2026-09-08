// ============================================================================
// B5 Demo Seed Infrastructure & Core Identities
//
// Usage:
//   node scripts/seed-demo-data.js <password> [--dry-run] [--allow-remote]
//
// Phase B5.1: Infrastructure & Safety Mechanisms.
// Phase B5.2: Core Identities, Caregiver Profiles, Family Links & Emergency Contacts.
// Phase B5.3: Care Plans, Tasks & Booking/Visit Operations.
// Phase B5.4: Safety, Geofences, Alerts & Notification Feeds.
// ============================================================================

import { URL } from 'node:url';
import crypto from 'node:crypto';
import { config } from '../shared/config/env.js';
import { pool, query, closePool } from '../shared/db/pool.js';
import { PASSWORD_MIN_LENGTH } from '../shared/auth/validate.js';
import { hashPassword } from '../shared/auth/password.js';
import { normalizePhone } from '../shared/phone.js';

// ---------------------------------------------------------------------------
// 1. Production Safety & Environment Validation
// ---------------------------------------------------------------------------

export function validateEnvironment(env = process.env, cfg = config) {
  const nodeEnv = env.NODE_ENV || cfg.nodeEnv || 'development';
  const appEnv = env.APP_ENV || '';

  if (nodeEnv.toLowerCase() === 'production' || appEnv.toLowerCase() === 'production') {
    throw new Error(
      `[B5] REFUSED: Cannot run in production environment (NODE_ENV="${nodeEnv}", APP_ENV="${appEnv}"). ` +
      `This script is strictly for development and demo environments.`
    );
  }

  return { nodeEnv, appEnv };
}

// ---------------------------------------------------------------------------
// 2. Remote Database Protection
// ---------------------------------------------------------------------------

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1']);

export function validateDatabaseHost(databaseUrl = config.databaseUrl, allowRemote = false) {
  if (!databaseUrl) {
    throw new Error('[B5] REFUSED: DATABASE_URL is not configured.');
  }

  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch (err) {
    throw new Error(`[B5] REFUSED: Malformed DATABASE_URL: ${err.message}`);
  }

  const hostname = parsed.hostname;
  const isLocal = LOCAL_HOSTNAMES.has(hostname);

  if (!isLocal && !allowRemote) {
    throw new Error(
      `[B5] REFUSED: Detected remote database host "${hostname}". ` +
      `Refusing to run against non-localhost database without explicit --allow-remote flag.`
    );
  }

  return { hostname, isLocal, allowRemote };
}

// ---------------------------------------------------------------------------
// 3. CLI Argument & Password Validation
// ---------------------------------------------------------------------------

export function parseArgs(args = process.argv.slice(2)) {
  const flags = {
    dryRun: false,
    allowRemote: false,
    password: null,
  };

  const positional = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dry-run') {
      flags.dryRun = true;
    } else if (arg === '--allow-remote') {
      flags.allowRemote = true;
    } else if (arg === '--password' && i + 1 < args.length) {
      flags.password = args[++i];
    } else if (!arg.startsWith('--')) {
      positional.push(arg);
    }
  }

  if (!flags.password && positional.length > 0) {
    flags.password = positional[0];
  }

  return flags;
}

export function validatePassword(password) {
  if (!password) {
    throw new Error(
      `[B5] REFUSED: Master password required.\n` +
      `Usage: node scripts/seed-demo-data.js <password> [--dry-run] [--allow-remote]\n` +
      `The password must be at least ${PASSWORD_MIN_LENGTH} characters.`
    );
  }

  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new Error(
      `[B5] REFUSED: Password must be at least ${PASSWORD_MIN_LENGTH} characters (received ${password.length}).`
    );
  }

  return true;
}

// ---------------------------------------------------------------------------
// 4. Transaction Helper
// ---------------------------------------------------------------------------

export async function withTransaction(client, callback) {
  await client.query('BEGIN');
  try {
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

// ---------------------------------------------------------------------------
// 5. Deterministic Identifier Generator
// ---------------------------------------------------------------------------

const DEMO_NAMESPACE = 'b5-eldercare-seed-v1';

export function generateDeterministicUuid(entityType, key) {
  const hash = crypto
    .createHash('sha256')
    .update(`${DEMO_NAMESPACE}:${entityType}:${key}`)
    .digest('hex');

  const p1 = hash.substring(0, 8);
  const p2 = hash.substring(8, 12);
  const p3 = '4' + hash.substring(13, 16);
  const p4 = 'a' + hash.substring(17, 20);
  const p5 = hash.substring(20, 32);

  return `${p1}-${p2}-${p3}-${p4}-${p5}`;
}

// ---------------------------------------------------------------------------
// 6. Conflict Targets Reference (Audited from Live Schema)
// ---------------------------------------------------------------------------

export const CONFLICT_TARGETS = Object.freeze({
  users: 'phone',
  caregivers: 'user_id',
  family_links: 'elderly_user_id, family_user_id',
  emergency_contacts: 'user_id, phone',
  schedules: 'caregiver_id, visit_date, start_time',
  attendance: 'schedule_id',
  activity_reports: 'caregiver_id, elderly_user_id, report_date',
  reviews: 'booking_id, reviewer_user_id',
  locations: 'user_id, recorded_at',
  device_tokens: 'expo_push_token',
  disaster_alerts: 'external_id',
  care_plans: 'id',
  tasks: 'id',
  caregiver_bookings: 'id',
  geofences: 'id',
  alerts: 'id',
  notification_feed: 'id',
  ambulance_bookings: 'id',
});

// ---------------------------------------------------------------------------
// 7. B5.2 Demo Data Specification (Core Identities & Caregiver Profiles)
// ---------------------------------------------------------------------------

export const DEMO_USERS = [
  // Admin (1)
  {
    phone: '9000000004',
    fullName: 'Priya Sharma',
    email: 'admin.priya@eldercare.demo',
    role: 'admin',
    city: 'Bengaluru',
    state: 'Karnataka',
  },
  // Elderly (3)
  {
    phone: '9000000001',
    fullName: 'Ramesh Patel',
    email: 'ramesh.patel@eldercare.demo',
    role: 'elderly',
    dateOfBirth: '1952-04-12',
    gender: 'male',
    addressLine: '42, 5th Cross, Malleshwaram',
    city: 'Bengaluru',
    state: 'Karnataka',
    postalCode: '560003',
  },
  {
    phone: '9000000011',
    fullName: 'Saraswathi Sundaram',
    email: 'saraswathi.s@eldercare.demo',
    role: 'elderly',
    dateOfBirth: '1945-08-25',
    gender: 'female',
    addressLine: '108, 12th Main, Indiranagar',
    city: 'Bengaluru',
    state: 'Karnataka',
    postalCode: '560038',
  },
  {
    phone: '9000000021',
    fullName: 'Col. Balachandran (Retd.)',
    email: 'bala.retd@eldercare.demo',
    role: 'elderly',
    dateOfBirth: '1948-11-03',
    gender: 'male',
    addressLine: '17, 1st Block, Koramangala',
    city: 'Bengaluru',
    state: 'Karnataka',
    postalCode: '560034',
  },
  // Family Members (3)
  {
    phone: '9000000002',
    fullName: 'Vikram Patel',
    email: 'vikram.patel@eldercare.demo',
    role: 'family',
    gender: 'male',
    city: 'Bengaluru',
    state: 'Karnataka',
  },
  {
    phone: '9000000012',
    fullName: 'Deepa Sundaram',
    email: 'deepa.s@eldercare.demo',
    role: 'family',
    gender: 'female',
    city: 'Bengaluru',
    state: 'Karnataka',
  },
  {
    phone: '9000000022',
    fullName: 'Anita Balachandran',
    email: 'anita.b@eldercare.demo',
    role: 'family',
    gender: 'female',
    city: 'Bengaluru',
    state: 'Karnataka',
  },
  // Caregivers (3)
  {
    phone: '9000000003',
    fullName: 'Sister Mary Joseph',
    email: 'mary.joseph@eldercare.demo',
    role: 'caregiver',
    gender: 'female',
    city: 'Bengaluru',
    state: 'Karnataka',
  },
  {
    phone: '9000000005',
    fullName: 'Rajesh Kumar',
    email: 'rajesh.kumar@eldercare.demo',
    role: 'caregiver',
    gender: 'male',
    city: 'Bengaluru',
    state: 'Karnataka',
  },
  {
    phone: '9000000015',
    fullName: 'Fatima Begum',
    email: 'fatima.begum@eldercare.demo',
    role: 'caregiver',
    gender: 'female',
    city: 'Bengaluru',
    state: 'Karnataka',
  },
];

export const DEMO_CAREGIVER_PROFILES = [
  {
    phone: '9000000003',
    serviceAreaCity: 'Bengaluru',
    hourlyRate: 350,
    experienceYears: 8,
    qualifications: 'Certified Nursing Assistant (CNA), Basic Life Support (BLS)',
    specializations: ['elderly_care', 'dementia_care', 'mobility_assistance'],
    languages: ['English', 'Hindi', 'Kannada', 'Malayalam'],
    verificationStatus: 'verified',
    idVerified: true,
    bio: 'Compassionate licensed caregiver with 8 years experience in geriatric nursing, post-operative support, and memory care.',
  },
  {
    phone: '9000000005',
    serviceAreaCity: 'Bengaluru',
    hourlyRate: 250,
    experienceYears: 2,
    qualifications: 'Home Health Aide (HHA) Certification',
    specializations: ['post_surgery_care', 'physiotherapy_assist'],
    languages: ['English', 'Hindi', 'Tamil'],
    verificationStatus: 'pending',
    idVerified: false,
    bio: 'Certified home health aide focused on rehabilitation support, physical mobility exercises, and vital monitoring.',
  },
  {
    phone: '9000000015',
    serviceAreaCity: 'Bengaluru',
    hourlyRate: 400,
    experienceYears: 6,
    qualifications: 'Registered Nurse (RN), GNM General Nursing',
    specializations: ['post_operative_care', 'elderly_care', 'medication_management'],
    languages: ['English', 'Hindi', 'Urdu', 'Kannada'],
    verificationStatus: 'verified',
    idVerified: true,
    bio: 'Dedicated registered nurse with extensive hospital and home health experience in medication administration and chronic care.',
  },
];

export const DEMO_FAMILY_LINKS = [
  {
    elderlyPhone: '9000000001', // Ramesh Patel
    familyPhone: '9000000002',  // Vikram Patel
    relationship: 'son',
    permissionLevel: 'owner',
    canViewLocation: true,
    canManageContacts: true,
    canManageCaregivers: true,
    canAcknowledgeAlerts: true,
    status: 'active',
  },
  {
    elderlyPhone: '9000000011', // Saraswathi Sundaram
    familyPhone: '9000000012',  // Deepa Sundaram
    relationship: 'daughter',
    permissionLevel: 'manage',
    canViewLocation: true,
    canManageContacts: false,
    canManageCaregivers: true,
    canAcknowledgeAlerts: true,
    status: 'active',
  },
  {
    elderlyPhone: '9000000021', // Col. Balachandran
    familyPhone: '9000000022',  // Anita Balachandran
    relationship: 'daughter',
    permissionLevel: 'view',
    canViewLocation: true,
    canManageContacts: false,
    canManageCaregivers: false,
    canAcknowledgeAlerts: false,
    status: 'active',
  },
];

export const DEMO_EMERGENCY_CONTACTS = [
  // Ramesh Patel contacts
  {
    elderlyPhone: '9000000001',
    contactPhone: '9000000002',
    contactUserPhone: '9000000002',
    fullName: 'Vikram Patel',
    email: 'vikram.patel@eldercare.demo',
    relationship: 'Son',
    priority: 1,
    notifyBySms: true,
    notifyByCall: true,
    notifyByPush: true,
  },
  {
    elderlyPhone: '9000000001',
    contactPhone: '9888888801',
    contactUserPhone: null,
    fullName: 'Dr. Kamath',
    email: 'dr.kamath@clinic.demo',
    relationship: 'Physician',
    priority: 2,
    notifyBySms: true,
    notifyByCall: true,
    notifyByPush: false,
  },
  // Saraswathi Sundaram contacts
  {
    elderlyPhone: '9000000011',
    contactPhone: '9000000012',
    contactUserPhone: '9000000012',
    fullName: 'Deepa Sundaram',
    email: 'deepa.s@eldercare.demo',
    relationship: 'Daughter',
    priority: 1,
    notifyBySms: true,
    notifyByCall: true,
    notifyByPush: true,
  },
  {
    elderlyPhone: '9000000011',
    contactPhone: '9888888802',
    contactUserPhone: null,
    fullName: 'Building Security Desk',
    email: null,
    relationship: 'Security',
    priority: 2,
    notifyBySms: true,
    notifyByCall: true,
    notifyByPush: false,
  },
  // Col. Balachandran contacts
  {
    elderlyPhone: '9000000021',
    contactPhone: '9000000022',
    contactUserPhone: '9000000022',
    fullName: 'Anita Balachandran',
    email: 'anita.b@eldercare.demo',
    relationship: 'Daughter',
    priority: 1,
    notifyBySms: true,
    notifyByCall: true,
    notifyByPush: true,
  },
  {
    elderlyPhone: '9000000021',
    contactPhone: '9888888803',
    contactUserPhone: null,
    fullName: 'Veteran Support Desk',
    email: 'welfare@vets.demo',
    relationship: 'Support Officer',
    priority: 2,
    notifyBySms: true,
    notifyByCall: true,
    notifyByPush: false,
  },
];

// ---------------------------------------------------------------------------
// 8. B5.2 Seed Execution: Core Identities & Caregiver Profiles
// ---------------------------------------------------------------------------

export async function seedCoreIdentities(client, { passwordHash }) {
  const results = {
    users: { created: 0, updated: 0, total: 0 },
    caregivers: { created: 0, updated: 0, total: 0 },
    familyLinks: { created: 0, updated: 0, total: 0 },
    emergencyContacts: { created: 0, updated: 0, total: 0 },
    idByPhone: {},
    caregiverIdByPhone: {},
  };

  // 1. Seed Users (ON CONFLICT (phone) DO UPDATE)
  console.log('[B5] Seeding core users...');
  for (const user of DEMO_USERS) {
    const normalized = normalizePhone(user.phone);
    if (!normalized.ok) {
      throw new Error(`[B5] Invalid phone for ${user.fullName}: ${normalized.reason}`);
    }

    const { rows } = await client.query(
      `INSERT INTO users (
          phone, email, password_hash, full_name, role,
          date_of_birth, gender, address_line, city, state, postal_code, is_active
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, TRUE)
       ON CONFLICT (phone) DO UPDATE
          SET password_hash = EXCLUDED.password_hash,
              full_name     = EXCLUDED.full_name,
              email         = EXCLUDED.email,
              role          = EXCLUDED.role,
              date_of_birth = COALESCE(EXCLUDED.date_of_birth, users.date_of_birth),
              gender        = COALESCE(EXCLUDED.gender, users.gender),
              address_line  = COALESCE(EXCLUDED.address_line, users.address_line),
              city          = COALESCE(EXCLUDED.city, users.city),
              state         = COALESCE(EXCLUDED.state, users.state),
              postal_code   = COALESCE(EXCLUDED.postal_code, users.postal_code),
              is_active     = TRUE
       RETURNING id, phone, role, (xmax = 0) AS inserted`,
      [
        normalized.value,
        user.email || null,
        passwordHash,
        user.fullName,
        user.role,
        user.dateOfBirth || null,
        user.gender || null,
        user.addressLine || null,
        user.city || null,
        user.state || null,
        user.postalCode || null,
      ]
    );

    const row = rows[0];
    results.idByPhone[user.phone] = row.id;
    results.idByPhone[normalized.value] = row.id;
    if (row.inserted) results.users.created++;
    else results.users.updated++;
    results.users.total++;
  }
  console.log(`[B5] PASS: Users seeded (${results.users.created} created, ${results.users.updated} updated).`);

  const adminId = results.idByPhone[DEMO_USERS.find((u) => u.role === 'admin').phone];

  // 2. Seed Caregiver Profiles (ON CONFLICT (user_id) DO UPDATE)
  console.log('[B5] Seeding caregiver profiles...');
  for (const profile of DEMO_CAREGIVER_PROFILES) {
    const userId = results.idByPhone[profile.phone];
    if (!userId) {
      throw new Error(`[B5] Caregiver user not found for phone: ${profile.phone}`);
    }

    const { rows } = await client.query(
      `INSERT INTO caregivers (
          user_id, bio, experience_years, qualifications, specializations,
          languages, hourly_rate, service_area_city, verification_status,
          id_verified, verified_at, verified_by
       ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9::verification_status,
          $10,
          CASE WHEN $10 = TRUE THEN now() ELSE NULL END,
          CASE WHEN $10 = TRUE THEN $11::uuid ELSE NULL END
       )
       ON CONFLICT (user_id) DO UPDATE
          SET bio                 = EXCLUDED.bio,
              experience_years    = EXCLUDED.experience_years,
              qualifications      = EXCLUDED.qualifications,
              specializations     = EXCLUDED.specializations,
              languages           = EXCLUDED.languages,
              hourly_rate         = EXCLUDED.hourly_rate,
              service_area_city   = EXCLUDED.service_area_city,
              verification_status = EXCLUDED.verification_status,
              id_verified         = EXCLUDED.id_verified,
              verified_at         = EXCLUDED.verified_at,
              verified_by         = EXCLUDED.verified_by
       RETURNING id, (xmax = 0) AS inserted`,
      [
        userId,
        profile.bio,
        profile.experienceYears,
        profile.qualifications,
        profile.specializations,
        profile.languages,
        profile.hourlyRate,
        profile.serviceAreaCity,
        profile.verificationStatus,
        profile.idVerified,
        adminId,
      ]
    );

    const row = rows[0];
    results.caregiverIdByPhone[profile.phone] = row.id;
    if (row.inserted) results.caregivers.created++;
    else results.caregivers.updated++;
    results.caregivers.total++;
  }
  console.log(`[B5] PASS: Caregiver profiles seeded (${results.caregivers.created} created, ${results.caregivers.updated} updated).`);

  // 3. Seed Family Links (ON CONFLICT (elderly_user_id, family_user_id) DO UPDATE)
  console.log('[B5] Seeding family links...');
  for (const link of DEMO_FAMILY_LINKS) {
    const elderlyId = results.idByPhone[link.elderlyPhone];
    const familyId = results.idByPhone[link.familyPhone];

    if (!elderlyId || !familyId) {
      throw new Error(`[B5] Missing elderly/family user for link (${link.elderlyPhone} -> ${link.familyPhone})`);
    }

    const { rows } = await client.query(
      `INSERT INTO family_links (
          elderly_user_id, family_user_id, relationship, permission_level,
          can_view_location, can_manage_contacts, can_manage_caregivers, can_acknowledge_alerts,
          status, approved_at
       ) VALUES ($1, $2, $3, $4::family_permission, $5, $6, $7, $8, $9::link_status, now())
       ON CONFLICT (elderly_user_id, family_user_id) DO UPDATE
          SET relationship           = EXCLUDED.relationship,
              permission_level       = EXCLUDED.permission_level,
              can_view_location      = EXCLUDED.can_view_location,
              can_manage_contacts    = EXCLUDED.can_manage_contacts,
              can_manage_caregivers  = EXCLUDED.can_manage_caregivers,
              can_acknowledge_alerts = EXCLUDED.can_acknowledge_alerts,
              status                 = EXCLUDED.status,
              approved_at            = EXCLUDED.approved_at
       RETURNING id, (xmax = 0) AS inserted`,
      [
        elderlyId,
        familyId,
        link.relationship,
        link.permissionLevel,
        link.canViewLocation,
        link.canManageContacts,
        link.canManageCaregivers,
        link.canAcknowledgeAlerts,
        link.status,
      ]
    );

    const row = rows[0];
    if (row.inserted) results.familyLinks.created++;
    else results.familyLinks.updated++;
    results.familyLinks.total++;
  }
  console.log(`[B5] PASS: Family links seeded (${results.familyLinks.created} created, ${results.familyLinks.updated} updated).`);

  // 4. Seed Emergency Contacts (ON CONFLICT (user_id, phone) DO UPDATE)
  console.log('[B5] Seeding emergency contacts...');
  for (const contact of DEMO_EMERGENCY_CONTACTS) {
    const elderlyId = results.idByPhone[contact.elderlyPhone];
    const contactPhoneNorm = normalizePhone(contact.contactPhone);
    const contactUserId = contact.contactUserPhone ? results.idByPhone[contact.contactUserPhone] : null;

    if (!elderlyId || !contactPhoneNorm.ok) {
      throw new Error(`[B5] Invalid emergency contact for ${contact.fullName}`);
    }

    const { rows } = await client.query(
      `INSERT INTO emergency_contacts (
          user_id, contact_user_id, full_name, phone, email, relationship,
          priority, notify_by_sms, notify_by_call, notify_by_push, is_active
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, TRUE)
       ON CONFLICT (user_id, phone) DO UPDATE
          SET contact_user_id = EXCLUDED.contact_user_id,
              full_name       = EXCLUDED.full_name,
              email           = EXCLUDED.email,
              relationship    = EXCLUDED.relationship,
              priority        = EXCLUDED.priority,
              notify_by_sms   = EXCLUDED.notify_by_sms,
              notify_by_call  = EXCLUDED.notify_by_call,
              notify_by_push  = EXCLUDED.notify_by_push,
              is_active       = TRUE
       RETURNING id, (xmax = 0) AS inserted`,
      [
        elderlyId,
        contactUserId,
        contact.fullName,
        contactPhoneNorm.value,
        contact.email || null,
        contact.relationship,
        contact.priority,
        contact.notifyBySms,
        contact.notifyByCall,
        contact.notifyByPush,
      ]
    );

    const row = rows[0];
    if (row.inserted) results.emergencyContacts.created++;
    else results.emergencyContacts.updated++;
    results.emergencyContacts.total++;
  }
  console.log(`[B5] PASS: Emergency contacts seeded (${results.emergencyContacts.created} created, ${results.emergencyContacts.updated} updated).`);

  return results;
}

// ---------------------------------------------------------------------------
// 9. B5.3 Demo Data Specification (Care Plans, Bookings, Schedules & Visits)
// ---------------------------------------------------------------------------

export const DEMO_CARE_PLANS = [
  {
    key: 'plan_ramesh_stroke',
    elderlyPhone: '9000000001', // Ramesh Patel
    creatorPhone: '9000000002', // Vikram Patel
    title: 'Post-Stroke Recovery & Daily Vitals',
    description: 'Comprehensive post-stroke recovery regimen focusing on blood pressure management, mobility rehabilitation, and medication compliance.',
    medicalConditions: 'Ischemic stroke recovery (mild right-side hemiparesis), Hypertension',
    allergies: 'Penicillin, Sulfa drugs',
    medications: 'Amlodipine 5mg morning, Aspirin 75mg daily, Atorvastatin 20mg night',
    dietaryNotes: 'Low-sodium (<2g/day), diabetic-friendly meals, adequate hydration',
    mobilityNotes: 'Walks with walking stick; needs assistance during transfer from chair or bed',
    emergencyInstructions: 'Immediate SOS if systolic BP > 160 or signs of facial drooping/speech difficulty. Contact Vikram Patel or Dr. Kamath.',
    startDate: '2026-08-15',
    endDate: '2027-08-15',
    status: 'active',
  },
  {
    key: 'plan_saraswathi_memory',
    elderlyPhone: '9000000011', // Saraswathi Sundaram
    creatorPhone: '9000000012', // Deepa Sundaram
    title: 'Cognitive Engagement & Hydration',
    description: 'Gentle daily routines designed for early-stage memory support, daily hydration goals, and calm evening routines.',
    medicalConditions: 'Mild cognitive impairment, Osteoporosis',
    allergies: 'No known drug allergies; lactose intolerant',
    medications: 'Donepezil 5mg night, Calcium + Vitamin D3 with lunch',
    dietaryNotes: 'Warm vegetarian meals, herbal tea, minimum 2 liters fluid daily',
    mobilityNotes: 'Independent indoors; needs companion outdoors for safety',
    emergencyInstructions: 'If confused or wandering beyond safe zone, contact Deepa Sundaram or building security immediately.',
    startDate: '2026-08-01',
    endDate: '2027-08-01',
    status: 'active',
  },
];

export const DEMO_BOOKINGS = [
  {
    key: 'booking_ramesh_mary',
    elderlyPhone: '9000000001',   // Ramesh Patel
    caregiverPhone: '9000000003', // Sister Mary Joseph
    bookedByPhone: '9000000002',  // Vikram Patel
    status: 'confirmed',
    startDate: '2026-09-01',
    endDate: '2026-09-30',
    recurrence: 'daily',
    hoursPerVisit: 3.0,
    agreedRate: 350.00,
    currency: 'INR',
    specialInstructions: 'Daily morning shift: check vitals, assist with mobility exercises, ensure breakfast and morning medication.',
  },
  {
    key: 'booking_saraswathi_rajesh',
    elderlyPhone: '9000000011',   // Saraswathi Sundaram
    caregiverPhone: '9000000005', // Rajesh Kumar
    bookedByPhone: '9000000012',  // Deepa Sundaram
    status: 'requested',
    startDate: '2026-09-10',
    endDate: '2026-09-24',
    recurrence: 'daily',
    hoursPerVisit: 2.0,
    agreedRate: 250.00,
    currency: 'INR',
    specialInstructions: 'Assistance with evening walk and cognitive memory exercises.',
  },
  {
    key: 'booking_balachandran_fatima',
    elderlyPhone: '9000000021',   // Col. Balachandran
    caregiverPhone: '9000000015', // Fatima Begum
    bookedByPhone: '9000000022',  // Anita Balachandran
    status: 'completed',
    startDate: '2026-08-01',
    endDate: '2026-08-15',
    recurrence: 'daily',
    hoursPerVisit: 4.0,
    agreedRate: 400.00,
    currency: 'INR',
    specialInstructions: 'Post-operative knee rehabilitation monitoring and dressing change.',
  },
];

export function getDemoScheduleSlots(anchorDate = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  const today = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), anchorDate.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const tomorrow = new Date(today.getTime() + 86400000);

  return [
    {
      key: 'sched_ramesh_mary_yesterday',
      bookingKey: 'booking_ramesh_mary',
      caregiverPhone: '9000000003',
      elderlyPhone: '9000000001',
      visitDate: fmt(yesterday),
      startTime: '09:00:00',
      endTime: '12:00:00',
      status: 'completed',
      notes: 'Morning vitals and gait rehabilitation routine.',
      attendance: {
        checkInAt: `${fmt(yesterday)}T08:58:00+05:30`,
        checkInLat: 12.97160,
        checkInLon: 77.59460,
        checkOutAt: `${fmt(yesterday)}T12:05:00+05:30`,
        checkOutLat: 12.97180,
        checkOutLon: 77.59480,
        durationMinutes: 187,
        status: 'checked_out',
        verifiedByFamily: true,
        notes: 'On-time arrival; completed all planned routines.',
      },
    },
    {
      key: 'sched_ramesh_mary_today',
      bookingKey: 'booking_ramesh_mary',
      caregiverPhone: '9000000003',
      elderlyPhone: '9000000001',
      visitDate: fmt(today),
      startTime: '09:00:00',
      endTime: '12:00:00',
      status: 'scheduled',
      notes: 'Daily scheduled morning visit.',
      attendance: {
        checkInAt: `${fmt(today)}T09:02:00+05:30`,
        checkInLat: 12.97160,
        checkInLon: 77.59460,
        checkOutAt: null,
        checkOutLat: null,
        checkOutLon: null,
        durationMinutes: null,
        status: 'checked_in',
        verifiedByFamily: false,
        notes: 'Checked in for morning visit.',
      },
    },
    {
      key: 'sched_ramesh_mary_tomorrow',
      bookingKey: 'booking_ramesh_mary',
      caregiverPhone: '9000000003',
      elderlyPhone: '9000000001',
      visitDate: fmt(tomorrow),
      startTime: '09:00:00',
      endTime: '12:00:00',
      status: 'scheduled',
      notes: 'Upcoming morning shift.',
      attendance: null,
    },
  ];
}

export function getDemoTasks(anchorDate = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  const today = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), anchorDate.getDate());
  const yesterday = new Date(today.getTime() - 86400000);

  return [
    {
      key: 'task_ramesh_bp_morning',
      planKey: 'plan_ramesh_stroke',
      elderlyPhone: '9000000001',
      assignedCaregiverPhone: '9000000003',
      assignedByPhone: '9000000002',
      scheduleKey: 'sched_ramesh_mary_yesterday',
      title: 'Morning BP & Pulse Check',
      description: 'Measure resting blood pressure and heart rate using automated cuff. Log readings in report.',
      category: 'Vitals',
      priority: 'high',
      dueDate: fmt(yesterday),
      dueTime: '09:30:00',
      status: 'completed',
      completedByCaregiverPhone: '9000000003',
      completedAt: `${fmt(yesterday)}T09:35:00+05:30`,
      completionNotes: 'BP: 124/82 mmHg, Pulse: 74 bpm. Normal resting values.',
    },
    {
      key: 'task_ramesh_gait_training',
      planKey: 'plan_ramesh_stroke',
      elderlyPhone: '9000000001',
      assignedCaregiverPhone: '9000000003',
      assignedByPhone: '9000000002',
      scheduleKey: 'sched_ramesh_mary_today',
      title: 'Afternoon Gait Training & Walk',
      description: 'Assist with 20-minute indoor corridor walk with walking stick support. Rest as needed.',
      category: 'Mobility',
      priority: 'normal',
      dueDate: fmt(today),
      dueTime: '10:30:00',
      status: 'pending',
    },
    {
      key: 'task_ramesh_evening_meds',
      planKey: 'plan_ramesh_stroke',
      elderlyPhone: '9000000001',
      assignedCaregiverPhone: null,
      assignedByPhone: '9000000002',
      scheduleKey: null,
      title: 'Evening Medication — Amlodipine 5mg',
      description: 'Take 1 tablet of Amlodipine 5mg with a glass of water after dinner.',
      category: 'Medication',
      priority: 'high',
      dueDate: fmt(today),
      dueTime: '20:00:00',
      status: 'pending',
    },
    {
      key: 'task_saraswathi_hydration',
      planKey: 'plan_saraswathi_memory',
      elderlyPhone: '9000000011',
      assignedCaregiverPhone: null,
      assignedByPhone: '9000000012',
      scheduleKey: null,
      title: 'Hydration Check (500ml)',
      description: 'Ensure morning fluid intake of at least 500ml (warm water or barley water).',
      category: 'Nutrition',
      priority: 'normal',
      dueDate: fmt(today),
      dueTime: '11:00:00',
      status: 'in_progress',
    },
    {
      key: 'task_saraswathi_puzzle',
      planKey: 'plan_saraswathi_memory',
      elderlyPhone: '9000000011',
      assignedCaregiverPhone: null,
      assignedByPhone: '9000000012',
      scheduleKey: null,
      title: 'Memory Puzzle / Orientation',
      description: 'Complete 1 crossword or picture recall puzzle to stimulate active recall.',
      category: 'Cognitive',
      priority: 'low',
      dueDate: fmt(today),
      dueTime: '16:00:00',
      status: 'pending',
    },
  ];
}

export function getDemoActivityReport(anchorDate = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  const today = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), anchorDate.getDate());
  const yesterday = new Date(today.getTime() - 86400000);

  return {
    key: 'report_ramesh_mary_yesterday',
    scheduleKey: 'sched_ramesh_mary_yesterday',
    caregiverPhone: '9000000003',
    elderlyPhone: '9000000001',
    planKey: 'plan_ramesh_stroke',
    reportDate: fmt(yesterday),
    summary: 'Patient was alert and in good spirits. BP 124/82, pulse 74. Completed 20 min gait exercise without dizziness.',
    mealsTaken: 'Idli and sambar for breakfast (finished entire portion); warm water throughout shift.',
    medicationsGiven: 'Amlodipine 5mg given at 09:30 AM.',
    mood: 'cheerful',
    sleepHours: 7.5,
    vitals: { systolic_bp: 124, diastolic_bp: 82, pulse: 74, temperature: 98.4 },
    concerns: 'Slight stiffness in right knee during initial standing, resolved after gentle flexion exercises.',
  };
}

export const DEMO_REVIEW = {
  key: 'review_ramesh_mary_vikram',
  caregiverPhone: '9000000003',
  bookingKey: 'booking_ramesh_mary',
  reviewerPhone: '9000000002',
  elderlyPhone: '9000000001',
  rating: 5,
  punctualityRating: 5,
  careQualityRating: 5,
  communicationRating: 5,
  comment: 'Sister Mary is punctual, compassionate, and very thorough with vitals.',
  isVisible: true,
};

// ---------------------------------------------------------------------------
// 10. B5.3 Seed Execution: Care Plans, Bookings, Schedules & Visits
// ---------------------------------------------------------------------------

export async function seedCareOperations(client, { idByPhone = {}, caregiverIdByPhone = {}, anchorDate = new Date() } = {}) {
  const results = {
    carePlans: { created: 0, updated: 0, total: 0 },
    bookings: { created: 0, updated: 0, total: 0 },
    schedules: { created: 0, updated: 0, total: 0 },
    attendance: { created: 0, updated: 0, total: 0 },
    tasks: { created: 0, updated: 0, total: 0 },
    activityReports: { created: 0, updated: 0, total: 0 },
    reviews: { created: 0, updated: 0, total: 0 },
    planIdByKey: {},
    bookingIdByKey: {},
    scheduleIdByKey: {},
  };

  // Resolve user IDs if missing
  const userIdMap = { ...idByPhone };
  if (Object.keys(userIdMap).length === 0) {
    const { rows: uRows } = await client.query('SELECT id, phone FROM users');
    for (const r of uRows) userIdMap[r.phone] = r.id;
  }

  // Resolve caregiver IDs if missing
  const caregiverIdMap = { ...caregiverIdByPhone };
  if (Object.keys(caregiverIdMap).length === 0) {
    const { rows: cgRows } = await client.query(`
      SELECT c.id, u.phone
      FROM caregivers c
      JOIN users u ON c.user_id = u.id
    `);
    for (const r of cgRows) caregiverIdMap[r.phone] = r.id;
  }

  const resolveUserId = (phone) => {
    if (!phone) return null;
    return userIdMap[phone] || userIdMap[normalizePhone(phone).value] || null;
  };

  const resolveCaregiverId = (phone) => {
    if (!phone) return null;
    return caregiverIdMap[phone] || caregiverIdMap[normalizePhone(phone).value] || null;
  };

  // 1. Care Plans (ON CONFLICT (id) DO UPDATE)
  console.log('[B5] Seeding care plans...');
  for (const plan of DEMO_CARE_PLANS) {
    const planId = generateDeterministicUuid('care_plans', plan.key);
    results.planIdByKey[plan.key] = planId;
    const elderlyId = resolveUserId(plan.elderlyPhone);
    const creatorId = resolveUserId(plan.creatorPhone);

    const { rows } = await client.query(
      `INSERT INTO care_plans (
          id, elderly_user_id, created_by_user_id, title, description,
          medical_conditions, allergies, medications, dietary_notes,
          mobility_notes, emergency_instructions, start_date, end_date, status
       ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::care_plan_status
       )
       ON CONFLICT (id) DO UPDATE
          SET title                  = EXCLUDED.title,
              description            = EXCLUDED.description,
              medical_conditions     = EXCLUDED.medical_conditions,
              allergies              = EXCLUDED.allergies,
              medications            = EXCLUDED.medications,
              dietary_notes          = EXCLUDED.dietary_notes,
              mobility_notes         = EXCLUDED.mobility_notes,
              emergency_instructions = EXCLUDED.emergency_instructions,
              start_date             = EXCLUDED.start_date,
              end_date               = EXCLUDED.end_date,
              status                 = EXCLUDED.status
       RETURNING id, (xmax = 0) AS inserted`,
      [
        planId,
        elderlyId,
        creatorId,
        plan.title,
        plan.description,
        plan.medicalConditions,
        plan.allergies,
        plan.medications,
        plan.dietaryNotes,
        plan.mobilityNotes,
        plan.emergencyInstructions,
        plan.startDate,
        plan.endDate,
        plan.status,
      ]
    );
    const row = rows[0];
    if (row.inserted) results.carePlans.created++;
    else results.carePlans.updated++;
    results.carePlans.total++;
  }
  console.log(`[B5] PASS: Care plans seeded (${results.carePlans.created} created, ${results.carePlans.updated} updated).`);

  // 2. Caregiver Bookings (ON CONFLICT (id) DO UPDATE)
  console.log('[B5] Seeding caregiver bookings...');
  for (const booking of DEMO_BOOKINGS) {
    const bookingId = generateDeterministicUuid('caregiver_bookings', booking.key);
    results.bookingIdByKey[booking.key] = bookingId;
    const elderlyId = resolveUserId(booking.elderlyPhone);
    const caregiverId = resolveCaregiverId(booking.caregiverPhone);
    const bookedById = resolveUserId(booking.bookedByPhone);

    const { rows } = await client.query(
      `INSERT INTO caregiver_bookings (
          id, elderly_user_id, caregiver_id, booked_by_user_id, status,
          start_date, end_date, recurrence, hours_per_visit, agreed_rate,
          currency, special_instructions
       ) VALUES (
          $1, $2, $3, $4, $5::booking_status, $6, $7, $8, $9, $10, $11, $12
       )
       ON CONFLICT (id) DO UPDATE
          SET elderly_user_id      = EXCLUDED.elderly_user_id,
              caregiver_id         = EXCLUDED.caregiver_id,
              booked_by_user_id    = EXCLUDED.booked_by_user_id,
              status               = EXCLUDED.status,
              start_date           = EXCLUDED.start_date,
              end_date             = EXCLUDED.end_date,
              recurrence           = EXCLUDED.recurrence,
              hours_per_visit      = EXCLUDED.hours_per_visit,
              agreed_rate          = EXCLUDED.agreed_rate,
              currency             = EXCLUDED.currency,
              special_instructions = EXCLUDED.special_instructions
       RETURNING id, (xmax = 0) AS inserted`,
      [
        bookingId,
        elderlyId,
        caregiverId,
        bookedById,
        booking.status,
        booking.startDate,
        booking.endDate,
        booking.recurrence,
        booking.hoursPerVisit,
        booking.agreedRate,
        booking.currency,
        booking.specialInstructions,
      ]
    );
    const row = rows[0];
    if (row.inserted) results.bookings.created++;
    else results.bookings.updated++;
    results.bookings.total++;
  }
  console.log(`[B5] PASS: Bookings seeded (${results.bookings.created} created, ${results.bookings.updated} updated).`);

  // 3. Schedules & Attendance (ON CONFLICT (caregiver_id, visit_date, start_time) DO UPDATE)
  console.log('[B5] Seeding schedules & attendance...');
  const scheduleSlots = getDemoScheduleSlots(anchorDate);
  for (const slot of scheduleSlots) {
    const scheduleId = generateDeterministicUuid('schedules', slot.key);
    const bookingId = results.bookingIdByKey[slot.bookingKey];
    const caregiverId = resolveCaregiverId(slot.caregiverPhone);
    const elderlyId = resolveUserId(slot.elderlyPhone);

    const { rows: schedRows } = await client.query(
      `INSERT INTO schedules (
          id, booking_id, caregiver_id, elderly_user_id, visit_date,
          start_time, end_time, status, notes
       ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8::schedule_status, $9
       )
       ON CONFLICT (caregiver_id, visit_date, start_time) DO UPDATE
          SET booking_id      = EXCLUDED.booking_id,
              elderly_user_id = EXCLUDED.elderly_user_id,
              end_time        = EXCLUDED.end_time,
              status          = EXCLUDED.status,
              notes           = EXCLUDED.notes
       RETURNING id, (xmax = 0) AS inserted`,
      [
        scheduleId,
        bookingId,
        caregiverId,
        elderlyId,
        slot.visitDate,
        slot.startTime,
        slot.endTime,
        slot.status,
        slot.notes,
      ]
    );
    const schedRow = schedRows[0];
    results.scheduleIdByKey[slot.key] = schedRow.id;
    if (schedRow.inserted) results.schedules.created++;
    else results.schedules.updated++;
    results.schedules.total++;

    if (slot.attendance) {
      const attId = generateDeterministicUuid('attendance', `att_${slot.key}`);
      const att = slot.attendance;
      const { rows: attRows } = await client.query(
        `INSERT INTO attendance (
            id, schedule_id, caregiver_id, check_in_at, check_in_latitude, check_in_longitude,
            check_out_at, check_out_latitude, check_out_longitude, duration_minutes,
            status, verified_by_family, notes
         ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::attendance_status, $12, $13
         )
         ON CONFLICT (schedule_id) DO UPDATE
            SET check_in_at          = EXCLUDED.check_in_at,
                check_in_latitude    = EXCLUDED.check_in_latitude,
                check_in_longitude   = EXCLUDED.check_in_longitude,
                check_out_at         = EXCLUDED.check_out_at,
                check_out_latitude   = EXCLUDED.check_out_latitude,
                check_out_longitude  = EXCLUDED.check_out_longitude,
                duration_minutes     = EXCLUDED.duration_minutes,
                status               = EXCLUDED.status,
                verified_by_family   = EXCLUDED.verified_by_family,
                notes                = EXCLUDED.notes
         RETURNING id, (xmax = 0) AS inserted`,
        [
          attId,
          schedRow.id,
          caregiverId,
          att.checkInAt,
          att.checkInLat,
          att.checkInLon,
          att.checkOutAt,
          att.checkOutLat,
          att.checkOutLon,
          att.durationMinutes,
          att.status,
          att.verifiedByFamily,
          att.notes,
        ]
      );
      const attRow = attRows[0];
      if (attRow.inserted) results.attendance.created++;
      else results.attendance.updated++;
      results.attendance.total++;
    }
  }
  console.log(`[B5] PASS: Schedules & attendance seeded (${results.schedules.total} schedules, ${results.attendance.total} attendance).`);

  // 4. Tasks (ON CONFLICT (id) DO UPDATE)
  console.log('[B5] Seeding tasks...');
  const tasks = getDemoTasks(anchorDate);
  for (const t of tasks) {
    const taskId = generateDeterministicUuid('tasks', t.key);
    const planId = t.planKey ? results.planIdByKey[t.planKey] : null;
    const elderlyId = resolveUserId(t.elderlyPhone);
    const caregiverId = resolveCaregiverId(t.assignedCaregiverPhone);
    const assignedById = resolveUserId(t.assignedByPhone);
    const scheduleId = t.scheduleKey ? results.scheduleIdByKey[t.scheduleKey] : null;
    const completedById = resolveUserId(t.completedByCaregiverPhone);

    const { rows } = await client.query(
      `INSERT INTO tasks (
          id, care_plan_id, elderly_user_id, assigned_to_caregiver_id,
          assigned_by_user_id, schedule_id, title, description,
          category, priority, due_date, due_time, status,
          completed_at, completed_by, completion_notes
       ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::task_priority, $11, $12, $13::task_status,
          $14, $15, $16
       )
       ON CONFLICT (id) DO UPDATE
          SET care_plan_id             = EXCLUDED.care_plan_id,
              elderly_user_id          = EXCLUDED.elderly_user_id,
              assigned_to_caregiver_id = EXCLUDED.assigned_to_caregiver_id,
              assigned_by_user_id      = EXCLUDED.assigned_by_user_id,
              schedule_id              = EXCLUDED.schedule_id,
              title                    = EXCLUDED.title,
              description              = EXCLUDED.description,
              category                 = EXCLUDED.category,
              priority                 = EXCLUDED.priority,
              due_date                 = EXCLUDED.due_date,
              due_time                 = EXCLUDED.due_time,
              status                   = EXCLUDED.status,
              completed_at             = EXCLUDED.completed_at,
              completed_by             = EXCLUDED.completed_by,
              completion_notes         = EXCLUDED.completion_notes
       RETURNING id, (xmax = 0) AS inserted`,
      [
        taskId,
        planId,
        elderlyId,
        caregiverId,
        assignedById,
        scheduleId,
        t.title,
        t.description,
        t.category,
        t.priority,
        t.dueDate,
        t.dueTime,
        t.status,
        t.completedAt || null,
        completedById || null,
        t.completionNotes || null,
      ]
    );
    const row = rows[0];
    if (row.inserted) results.tasks.created++;
    else results.tasks.updated++;
    results.tasks.total++;
  }
  console.log(`[B5] PASS: Tasks seeded (${results.tasks.created} created, ${results.tasks.updated} updated).`);

  // 5. Activity Reports (ON CONFLICT (caregiver_id, elderly_user_id, report_date) DO UPDATE)
  console.log('[B5] Seeding activity reports...');
  const report = getDemoActivityReport(anchorDate);
  const reportId = generateDeterministicUuid('activity_reports', report.key);
  const repCaregiverId = resolveCaregiverId(report.caregiverPhone);
  const repElderlyId = resolveUserId(report.elderlyPhone);
  const repScheduleId = report.scheduleKey ? results.scheduleIdByKey[report.scheduleKey] : null;
  const repPlanId = report.planKey ? results.planIdByKey[report.planKey] : null;

  const { rows: repRows } = await client.query(
    `INSERT INTO activity_reports (
        id, schedule_id, caregiver_id, elderly_user_id, care_plan_id,
        report_date, summary, meals_taken, medications_given, mood,
        sleep_hours, vitals, concerns
     ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
     )
     ON CONFLICT (caregiver_id, elderly_user_id, report_date) DO UPDATE
        SET schedule_id       = EXCLUDED.schedule_id,
            care_plan_id      = EXCLUDED.care_plan_id,
            summary           = EXCLUDED.summary,
            meals_taken       = EXCLUDED.meals_taken,
            medications_given = EXCLUDED.medications_given,
            mood              = EXCLUDED.mood,
            sleep_hours       = EXCLUDED.sleep_hours,
            vitals            = EXCLUDED.vitals,
            concerns          = EXCLUDED.concerns
     RETURNING id, (xmax = 0) AS inserted`,
    [
      reportId,
      repScheduleId,
      repCaregiverId,
      repElderlyId,
      repPlanId,
      report.reportDate,
      report.summary,
      report.mealsTaken,
      report.medicationsGiven,
      report.mood,
      report.sleepHours,
      JSON.stringify(report.vitals),
      report.concerns,
    ]
  );
  const repRow = repRows[0];
  if (repRow.inserted) results.activityReports.created++;
  else results.activityReports.updated++;
  results.activityReports.total++;
  console.log(`[B5] PASS: Activity reports seeded (${results.activityReports.created} created, ${results.activityReports.updated} updated).`);

  // 6. Reviews (ON CONFLICT (booking_id, reviewer_user_id) DO UPDATE)
  console.log('[B5] Seeding reviews...');
  const review = DEMO_REVIEW;
  const revId = generateDeterministicUuid('reviews', review.key);
  const revCaregiverId = resolveCaregiverId(review.caregiverPhone);
  const revBookingId = results.bookingIdByKey[review.bookingKey];
  const revReviewerId = resolveUserId(review.reviewerPhone);
  const revElderlyId = resolveUserId(review.elderlyPhone);

  const { rows: revRows } = await client.query(
    `INSERT INTO reviews (
        id, caregiver_id, booking_id, reviewer_user_id, elderly_user_id,
        rating, punctuality_rating, care_quality_rating,
        communication_rating, comment, is_visible
     ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
     )
     ON CONFLICT (booking_id, reviewer_user_id) DO UPDATE
        SET caregiver_id         = EXCLUDED.caregiver_id,
            elderly_user_id      = EXCLUDED.elderly_user_id,
            rating               = EXCLUDED.rating,
            punctuality_rating   = EXCLUDED.punctuality_rating,
            care_quality_rating  = EXCLUDED.care_quality_rating,
            communication_rating = EXCLUDED.communication_rating,
            comment              = EXCLUDED.comment,
            is_visible           = EXCLUDED.is_visible
     RETURNING id, (xmax = 0) AS inserted`,
    [
      revId,
      revCaregiverId,
      revBookingId,
      revReviewerId,
      revElderlyId,
      review.rating,
      review.punctualityRating,
      review.careQualityRating,
      review.communicationRating,
      review.comment,
      review.isVisible,
    ]
  );
  const revRow = revRows[0];
  if (revRow.inserted) results.reviews.created++;
  else results.reviews.updated++;
  results.reviews.total++;

  // Recalculate caregiver rating and total reviews
  await client.query(
    `UPDATE caregivers
        SET average_rating = COALESCE((SELECT ROUND(AVG(rating), 2) FROM reviews WHERE caregiver_id = $1 AND is_visible = TRUE), 0),
            total_reviews  = (SELECT COUNT(*) FROM reviews WHERE caregiver_id = $1 AND is_visible = TRUE)
      WHERE id = $1`,
    [revCaregiverId]
  );
  console.log(`[B5] PASS: Reviews seeded (${results.reviews.created} created, ${results.reviews.updated} updated).`);

  return results;
}

// ---------------------------------------------------------------------------
// 11. B5.4 Demo Data Specification (Safety, Geofences, Alerts & Feeds)
// ---------------------------------------------------------------------------

export const DEMO_GEOFENCES = [
  {
    key: 'geofence_ramesh_home',
    elderlyPhone: '9000000001', // Ramesh Patel
    name: 'Malleshwaram Home Safe Zone',
    centerLatitude: 12.97160,
    centerLongitude: 77.59460,
    radiusMeters: 500,
    fenceType: 'safe_zone',
    alertOnExit: true,
    alertOnEnter: false,
    isActive: true,
  },
  {
    key: 'geofence_saraswathi_home',
    elderlyPhone: '9000000011', // Saraswathi Sundaram
    name: 'Indiranagar Home Safe Zone',
    centerLatitude: 12.97840,
    centerLongitude: 77.64080,
    radiusMeters: 400,
    fenceType: 'safe_zone',
    alertOnExit: true,
    alertOnEnter: false,
    isActive: true,
  },
];

export function getDemoLocationRoute(anchorDate = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  const today = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), anchorDate.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const yDate = fmt(yesterday);

  // 12 sequential readings along Ramesh's morning walk on yesterday (07:00 to 07:55 IST)
  // Distance from Malleshwaram Home (12.9716, 77.5946):
  // Points 1-5: Inside zone (< 500m)
  // Points 6-7: Outside zone (530m - 620m, breaching 500m geofence)
  // Points 8-11: Returning inside zone
  // Point 12: Back home (0m)
  return [
    { key: 'ramesh-loc-01', elderlyPhone: '9000000001', recordedAt: `${yDate}T07:00:00+05:30`, lat: 12.97160, lng: 77.59460, speed: 0.0, heading: 0,   batt: 85, moving: false },
    { key: 'ramesh-loc-02', elderlyPhone: '9000000001', recordedAt: `${yDate}T07:05:00+05:30`, lat: 12.97190, lng: 77.59510, speed: 1.1, heading: 45,  batt: 85, moving: true },
    { key: 'ramesh-loc-03', elderlyPhone: '9000000001', recordedAt: `${yDate}T07:10:00+05:30`, lat: 12.97230, lng: 77.59570, speed: 1.2, heading: 40,  batt: 84, moving: true },
    { key: 'ramesh-loc-04', elderlyPhone: '9000000001', recordedAt: `${yDate}T07:15:00+05:30`, lat: 12.97280, lng: 77.59640, speed: 1.2, heading: 42,  batt: 84, moving: true },
    { key: 'ramesh-loc-05', elderlyPhone: '9000000001', recordedAt: `${yDate}T07:20:00+05:30`, lat: 12.97340, lng: 77.59730, speed: 1.3, heading: 48,  batt: 83, moving: true },
    { key: 'ramesh-loc-06', elderlyPhone: '9000000001', recordedAt: `${yDate}T07:25:00+05:30`, lat: 12.97410, lng: 77.59830, speed: 1.3, heading: 45,  batt: 83, moving: true },
    { key: 'ramesh-loc-07', elderlyPhone: '9000000001', recordedAt: `${yDate}T07:30:00+05:30`, lat: 12.97450, lng: 77.59890, speed: 0.8, heading: 30,  batt: 82, moving: true },
    { key: 'ramesh-loc-08', elderlyPhone: '9000000001', recordedAt: `${yDate}T07:35:00+05:30`, lat: 12.97410, lng: 77.59830, speed: 1.1, heading: 225, batt: 82, moving: true },
    { key: 'ramesh-loc-09', elderlyPhone: '9000000001', recordedAt: `${yDate}T07:40:00+05:30`, lat: 12.97340, lng: 77.59730, speed: 1.2, heading: 228, batt: 81, moving: true },
    { key: 'ramesh-loc-10', elderlyPhone: '9000000001', recordedAt: `${yDate}T07:45:00+05:30`, lat: 12.97280, lng: 77.59640, speed: 1.1, heading: 222, batt: 81, moving: true },
    { key: 'ramesh-loc-11', elderlyPhone: '9000000001', recordedAt: `${yDate}T07:50:00+05:30`, lat: 12.97210, lng: 77.59530, speed: 1.0, heading: 225, batt: 80, moving: true },
    { key: 'ramesh-loc-12', elderlyPhone: '9000000001', recordedAt: `${yDate}T07:55:00+05:30`, lat: 12.97160, lng: 77.59460, speed: 0.0, heading: 0,   batt: 80, moving: false },
  ];
}

export function getDemoAlerts(anchorDate = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  const today = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), anchorDate.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const tDate = fmt(today);
  const yDate = fmt(yesterday);

  return [
    {
      key: 'alert_ramesh_sos',
      elderlyPhone: '9000000001', // Ramesh Patel
      alertType: 'sos',
      status: 'active',
      severity: 'critical',
      message: 'Emergency SOS triggered by Ramesh Patel',
      latitude: 12.97160,
      longitude: 77.59460,
      accuracyMeters: 15.0,
      isApproximate: false,
      triggeredAt: `${tDate}T10:15:00+05:30`,
      acknowledgedAt: null,
      acknowledgedByPhone: null,
      resolvedAt: null,
      resolvedByPhone: null,
      resolutionNotes: null,
      geofenceKey: null,
      locationKey: null,
    },
    {
      key: 'alert_saraswathi_fall',
      elderlyPhone: '9000000011', // Saraswathi Sundaram
      alertType: 'fall',
      status: 'active',
      severity: 'high',
      message: 'Fall detected in indoor corridor. Escalation stopped by family acknowledgment.',
      latitude: 12.97840,
      longitude: 77.64080,
      accuracyMeters: 20.0,
      isApproximate: false,
      triggeredAt: `${tDate}T08:30:00+05:30`,
      acknowledgedAt: `${tDate}T08:35:00+05:30`,
      acknowledgedByPhone: '9000000012', // Deepa Sundaram
      resolvedAt: null,
      resolvedByPhone: null,
      resolutionNotes: null,
      geofenceKey: null,
      locationKey: null,
    },
    {
      key: 'alert_ramesh_geofence',
      elderlyPhone: '9000000001', // Ramesh Patel
      alertType: 'geofence_breach',
      status: 'resolved',
      severity: 'medium',
      message: 'Left the safe zone "Malleshwaram Home Safe Zone".',
      latitude: 12.97410,
      longitude: 77.59830,
      accuracyMeters: 10.0,
      isApproximate: false,
      triggeredAt: `${yDate}T07:25:00+05:30`,
      acknowledgedAt: null,
      acknowledgedByPhone: null,
      resolvedAt: `${yDate}T07:55:00+05:30`,
      resolvedByPhone: '9000000002', // Vikram Patel
      resolutionNotes: 'Ramesh returned home safely after morning walk.',
      geofenceKey: 'geofence_ramesh_home',
      locationKey: 'ramesh-loc-12',
    },
  ];
}

export function getDemoNotificationFeed(anchorDate = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  const today = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), anchorDate.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const tDate = fmt(today);
  const yDate = fmt(yesterday);

  return [
    {
      key: 'nf_vikram_sos',
      recipientPhone: '9000000002', // Vikram Patel (family)
      eventType: 'alert_fired',
      alertKey: 'alert_ramesh_sos',
      bookingKey: null,
      taskKey: null,
      title: '🚨 SOS Alert — Ramesh Patel',
      body: 'Emergency SOS button pressed by Ramesh Patel at Malleshwaram.',
      data: { screen: 'FamilyLiveMap', params: { alertType: 'sos' } },
      isRead: false,
      createdAt: `${tDate}T10:15:00+05:30`,
    },
    {
      key: 'nf_priya_sos',
      recipientPhone: '9000000004', // Priya Sharma (admin)
      eventType: 'alert_fired',
      alertKey: 'alert_ramesh_sos',
      bookingKey: null,
      taskKey: null,
      title: '🚨 SOS Alert — Ramesh Patel',
      body: 'Critical SOS alert active for elderly user Ramesh Patel.',
      data: { screen: 'AdminAlertOverview', params: { alertId: null } },
      isRead: false,
      createdAt: `${tDate}T10:15:05+05:30`,
    },
    {
      key: 'nf_deepa_fall_fired',
      recipientPhone: '9000000012', // Deepa Sundaram (family)
      eventType: 'alert_fired',
      alertKey: 'alert_saraswathi_fall',
      bookingKey: null,
      taskKey: null,
      title: '⚠️ Fall Detected — Saraswathi Sundaram',
      body: 'Potential fall impact detected at Indiranagar residence.',
      data: { screen: 'FamilyHomeScreen', params: { alertType: 'fall' } },
      isRead: true,
      createdAt: `${tDate}T08:30:00+05:30`,
    },
    {
      key: 'nf_deepa_fall_ack',
      recipientPhone: '9000000012', // Deepa Sundaram (family)
      eventType: 'alert_acknowledged',
      alertKey: 'alert_saraswathi_fall',
      bookingKey: null,
      taskKey: null,
      title: '✅ Fall Alert Acknowledged',
      body: 'You acknowledged the fall alert for Saraswathi Sundaram. Escalation paused.',
      data: { screen: 'FamilyHomeScreen', params: { acknowledged: true } },
      isRead: true,
      createdAt: `${tDate}T08:35:00+05:30`,
    },
    {
      key: 'nf_vikram_geo_fired',
      recipientPhone: '9000000002', // Vikram Patel (family)
      eventType: 'alert_fired',
      alertKey: 'alert_ramesh_geofence',
      bookingKey: null,
      taskKey: null,
      title: '📍 Geofence Breach — Ramesh Patel',
      body: 'Ramesh Patel has moved outside Malleshwaram Home Safe Zone (>500m).',
      data: { screen: 'FamilyLiveMap', params: { fenceBreach: true } },
      isRead: true,
      createdAt: `${yDate}T07:25:00+05:30`,
    },
    {
      key: 'nf_vikram_geo_resolved',
      recipientPhone: '9000000002', // Vikram Patel (family)
      eventType: 'alert_resolved',
      alertKey: 'alert_ramesh_geofence',
      bookingKey: null,
      taskKey: null,
      title: '✅ Geofence Alert Resolved',
      body: 'Geofence breach resolved: Ramesh returned home safely.',
      data: { screen: 'FamilyHomeScreen', params: { resolved: true } },
      isRead: true,
      createdAt: `${yDate}T07:55:00+05:30`,
    },
    {
      key: 'nf_mary_booking',
      recipientPhone: '9000000003', // Sister Mary Joseph (caregiver)
      eventType: 'booking_created',
      alertKey: null,
      bookingKey: 'booking_ramesh_mary',
      taskKey: null,
      title: '📋 New Booking Confirmed — Ramesh Patel',
      body: 'Daily morning shift booking confirmed by Vikram Patel (3 hrs/visit, ₹350/hr).',
      data: { screen: 'Bookings', params: { bookingKey: 'booking_ramesh_mary' } },
      isRead: true,
      createdAt: '2026-09-01T10:00:00+05:30',
    },
    {
      key: 'nf_rajesh_task',
      recipientPhone: '9000000005', // Rajesh Kumar (caregiver)
      eventType: 'task_assigned',
      alertKey: null,
      bookingKey: null,
      taskKey: 'task_saraswathi_hydration',
      title: '📝 New Task Assigned — Hydration Check',
      body: 'Hydration Check (500ml) scheduled for Saraswathi Sundaram at 11:00 AM.',
      data: { screen: 'ScheduleTasks', params: { taskKey: 'task_saraswathi_hydration' } },
      isRead: false,
      createdAt: `${tDate}T08:00:00+05:30`,
    },
  ];
}

// ---------------------------------------------------------------------------
// 12. B5.4 Seed Execution: Safety, Geofences, Alerts & Notification Feeds
// ---------------------------------------------------------------------------

export async function seedSafetyAndAlerts(client, { idByPhone = {}, anchorDate = new Date() } = {}) {
  const results = {
    geofences: { created: 0, updated: 0, total: 0 },
    locations: { created: 0, updated: 0, total: 0 },
    alerts: { created: 0, updated: 0, total: 0 },
    notificationFeed: { created: 0, updated: 0, total: 0 },
    geofenceIdByKey: {},
    locationIdByKey: {},
    alertIdByKey: {},
  };

  // Resolve user IDs if missing
  const userIdMap = { ...idByPhone };
  if (Object.keys(userIdMap).length === 0) {
    const { rows: uRows } = await client.query('SELECT id, phone FROM users');
    for (const r of uRows) userIdMap[r.phone] = r.id;
  }

  const resolveUserId = (phone) => {
    if (!phone) return null;
    return userIdMap[phone] || userIdMap[normalizePhone(phone).value] || null;
  };

  // 1. Geofences (ON CONFLICT (id) DO UPDATE)
  console.log('[B5] Seeding geofences...');
  for (const fence of DEMO_GEOFENCES) {
    const fenceId = generateDeterministicUuid('geofences', fence.key);
    results.geofenceIdByKey[fence.key] = fenceId;
    const elderlyId = resolveUserId(fence.elderlyPhone);

    const { rows } = await client.query(
      `INSERT INTO geofences (
          id, user_id, name, center_latitude, center_longitude, radius_meters,
          fence_type, alert_on_exit, alert_on_enter, is_active, created_by
       ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
       )
       ON CONFLICT (id) DO UPDATE
          SET name             = EXCLUDED.name,
              center_latitude  = EXCLUDED.center_latitude,
              center_longitude = EXCLUDED.center_longitude,
              radius_meters    = EXCLUDED.radius_meters,
              fence_type       = EXCLUDED.fence_type,
              alert_on_exit    = EXCLUDED.alert_on_exit,
              alert_on_enter   = EXCLUDED.alert_on_enter,
              is_active        = EXCLUDED.is_active,
              created_by       = EXCLUDED.created_by,
              updated_at       = now()
       RETURNING id, (xmax = 0) AS inserted`,
      [
        fenceId,
        elderlyId,
        fence.name,
        fence.centerLatitude,
        fence.centerLongitude,
        fence.radiusMeters,
        fence.fenceType,
        fence.alertOnExit,
        fence.alertOnEnter,
        fence.isActive,
        elderlyId,
      ]
    );
    const row = rows[0];
    if (row.inserted) results.geofences.created++;
    else results.geofences.updated++;
    results.geofences.total++;
  }
  console.log(`[B5] PASS: Geofences seeded (${results.geofences.created} created, ${results.geofences.updated} updated).`);

  // 2. Locations (ON CONFLICT (user_id, recorded_at) DO UPDATE)
  console.log('[B5] Seeding location route...');
  const locationRoute = getDemoLocationRoute(anchorDate);
  for (const loc of locationRoute) {
    const locId = generateDeterministicUuid('locations', loc.key);
    results.locationIdByKey[loc.key] = locId;
    const elderlyId = resolveUserId(loc.elderlyPhone);

    const { rows } = await client.query(
      `INSERT INTO locations (
          id, user_id, latitude, longitude, accuracy_meters, battery_level,
          heading_degrees, speed_mps, is_moving, source, recorded_at
       ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
       )
       ON CONFLICT (user_id, recorded_at) DO UPDATE
          SET latitude        = EXCLUDED.latitude,
              longitude       = EXCLUDED.longitude,
              accuracy_meters = EXCLUDED.accuracy_meters,
              battery_level   = EXCLUDED.battery_level,
              heading_degrees = EXCLUDED.heading_degrees,
              speed_mps       = EXCLUDED.speed_mps,
              is_moving       = EXCLUDED.is_moving,
              source          = EXCLUDED.source
       RETURNING id, (xmax = 0) AS inserted`,
      [
        locId,
        elderlyId,
        loc.lat,
        loc.lng,
        15.0,
        loc.batt,
        loc.heading,
        loc.speed,
        loc.moving,
        'gps',
        loc.recordedAt,
      ]
    );
    const row = rows[0];
    if (row.inserted) results.locations.created++;
    else results.locations.updated++;
    results.locations.total++;
    results.locationIdByKey[loc.key] = row.id;
  }
  console.log(`[B5] PASS: Locations seeded (${results.locations.created} created, ${results.locations.updated} updated).`);

  // 3. Alerts (ON CONFLICT (id) DO UPDATE)
  console.log('[B5] Seeding alerts...');
  const alerts = getDemoAlerts(anchorDate);
  for (const alert of alerts) {
    const alertId = generateDeterministicUuid('alerts', alert.key);
    results.alertIdByKey[alert.key] = alertId;
    const elderlyId = resolveUserId(alert.elderlyPhone);
    const ackById = resolveUserId(alert.acknowledgedByPhone);
    const resById = resolveUserId(alert.resolvedByPhone);
    const geofenceId = alert.geofenceKey ? results.geofenceIdByKey[alert.geofenceKey] : null;
    const locationId = alert.locationKey ? results.locationIdByKey[alert.locationKey] : null;

    const { rows } = await client.query(
      `INSERT INTO alerts (
          id, user_id, alert_type, status, severity, message,
          latitude, longitude, location_accuracy_meters, location_is_approximate,
          geofence_id, location_id,
          triggered_at, acknowledged_at, acknowledged_by,
          resolved_at, resolved_by, resolution_notes
       ) VALUES (
          $1, $2, $3::alert_type, $4::alert_status, $5::alert_severity, $6,
          $7, $8, $9, $10,
          $11, $12,
          $13, $14, $15,
          $16, $17, $18
       )
       ON CONFLICT (id) DO UPDATE
          SET status                    = EXCLUDED.status,
              severity                  = EXCLUDED.severity,
              message                   = EXCLUDED.message,
              latitude                  = EXCLUDED.latitude,
              longitude                 = EXCLUDED.longitude,
              location_accuracy_meters  = EXCLUDED.location_accuracy_meters,
              location_is_approximate   = EXCLUDED.location_is_approximate,
              geofence_id               = EXCLUDED.geofence_id,
              location_id               = EXCLUDED.location_id,
              triggered_at              = EXCLUDED.triggered_at,
              acknowledged_at           = EXCLUDED.acknowledged_at,
              acknowledged_by           = EXCLUDED.acknowledged_by,
              resolved_at               = EXCLUDED.resolved_at,
              resolved_by               = EXCLUDED.resolved_by,
              resolution_notes          = EXCLUDED.resolution_notes,
              updated_at                = now()
       RETURNING id, (xmax = 0) AS inserted`,
      [
        alertId,
        elderlyId,
        alert.alertType,
        alert.status,
        alert.severity,
        alert.message,
        alert.latitude,
        alert.longitude,
        alert.accuracyMeters,
        alert.isApproximate,
        geofenceId,
        locationId,
        alert.triggeredAt,
        alert.acknowledgedAt,
        ackById,
        alert.resolvedAt,
        resById,
        alert.resolutionNotes,
      ]
    );
    const row = rows[0];
    if (row.inserted) results.alerts.created++;
    else results.alerts.updated++;
    results.alerts.total++;
  }
  console.log(`[B5] PASS: Alerts seeded (${results.alerts.created} created, ${results.alerts.updated} updated).`);

  // 4. Notification Feed (ON CONFLICT (id) DO UPDATE)
  console.log('[B5] Seeding notification feed...');
  const feedItems = getDemoNotificationFeed(anchorDate);
  for (const item of feedItems) {
    const feedId = generateDeterministicUuid('notification_feed', item.key);
    const recipientId = resolveUserId(item.recipientPhone);

    let eventId = null;
    if (item.alertKey) {
      eventId = results.alertIdByKey[item.alertKey] || generateDeterministicUuid('alerts', item.alertKey);
    } else if (item.bookingKey) {
      eventId = generateDeterministicUuid('caregiver_bookings', item.bookingKey);
    } else if (item.taskKey) {
      eventId = generateDeterministicUuid('tasks', item.taskKey);
    }

    const { rows } = await client.query(
      `INSERT INTO notification_feed (
          id, recipient_user_id, event_type, event_id, title, body, data, is_read, created_at
       ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9
       )
       ON CONFLICT (id) DO UPDATE
          SET event_type = EXCLUDED.event_type,
              event_id   = EXCLUDED.event_id,
              title      = EXCLUDED.title,
              body       = EXCLUDED.body,
              data       = EXCLUDED.data,
              is_read    = EXCLUDED.is_read
       RETURNING id, (xmax = 0) AS inserted`,
      [
        feedId,
        recipientId,
        item.eventType,
        eventId,
        item.title,
        item.body,
        JSON.stringify(item.data),
        item.isRead,
        item.createdAt,
      ]
    );
    const row = rows[0];
    if (row.inserted) results.notificationFeed.created++;
    else results.notificationFeed.updated++;
    results.notificationFeed.total++;
  }
  console.log(`[B5] PASS: Notification feed seeded (${results.notificationFeed.created} created, ${results.notificationFeed.updated} updated).`);

  return results;
}

// ---------------------------------------------------------------------------
// 13. Main Execution Pipeline
// ---------------------------------------------------------------------------

async function run() {
  console.log('═════════════════════════════════════════════════════════════════');
  console.log('  B5 Demo Seed: Core Identities, Care Ops & Safety (B5.2-B5.4)');
  console.log('═════════════════════════════════════════════════════════════════');

  const args = parseArgs();

  // 1. Safety & environment verification
  console.log('\n[B5] Step 1: Checking environment safeguards...');
  const { nodeEnv } = validateEnvironment();
  console.log(`[B5] PASS: Environment "${nodeEnv}" is safe for seeding.`);

  // 2. Database host verification
  console.log('\n[B5] Step 2: Checking database target host...');
  const { hostname, isLocal } = validateDatabaseHost(config.databaseUrl, args.allowRemote);
  if (isLocal) {
    console.log(`[B5] PASS: Target database host is local (${hostname}).`);
  } else {
    console.log(`[B5] WARNING: Target host is remote (${hostname}), permitted via --allow-remote.`);
  }

  // 3. Password gate verification
  console.log('\n[B5] Step 3: Checking master password...');
  validatePassword(args.password);
  console.log(`[B5] PASS: Master password meets requirement (>= ${PASSWORD_MIN_LENGTH} chars).`);

  // 4. Database connectivity verification
  console.log('\n[B5] Step 4: Testing database pool connection...');
  const ping = await query('SELECT current_database() AS db, version() AS ver');
  console.log(`[B5] PASS: Connected to "${ping.rows[0].db}" (${ping.rows[0].ver.split(' on ')[0]}).`);

  // 5. Dry-run assertion
  if (args.dryRun) {
    console.log('\n[B5] Step 5: DRY RUN ACTIVE');
    console.log('[B5] --dry-run specified: performing zero database mutations.');
    console.log(`[B5] Planned B5.2 mutations:`);
    console.log(`  - users:              ${DEMO_USERS.length} accounts to upsert`);
    console.log(`  - caregivers:         ${DEMO_CAREGIVER_PROFILES.length} profiles to upsert`);
    console.log(`  - family_links:       ${DEMO_FAMILY_LINKS.length} links to upsert`);
    console.log(`  - emergency_contacts: ${DEMO_EMERGENCY_CONTACTS.length} contacts to upsert`);
    console.log(`[B5] Planned B5.3 mutations:`);
    console.log(`  - care_plans:         ${DEMO_CARE_PLANS.length} plans to upsert`);
    console.log(`  - caregiver_bookings: ${DEMO_BOOKINGS.length} bookings to upsert`);
    console.log(`  - schedules:          3 slots to upsert`);
    console.log(`  - attendance:         2 records to upsert`);
    console.log(`  - tasks:              5 tasks to upsert`);
    console.log(`  - activity_reports:   1 report to upsert`);
    console.log(`  - reviews:            1 review to upsert`);
    console.log(`[B5] Planned B5.4 mutations:`);
    console.log(`  - geofences:         ${DEMO_GEOFENCES.length} safe zones to upsert`);
    console.log(`  - locations:         12 GPS readings to upsert`);
    console.log(`  - alerts:            3 alerts to upsert`);
    console.log(`  - notification_feed: 8 feed items to upsert`);
    console.log('[B5] Zero application data inserted/updated in dry run mode.');
    console.log('\n[B5] READY: Infrastructure and planned entities validated successfully.');
    return;
  }

  // 6. Live execution in managed transaction
  console.log('\n[B5] Step 5: Executing B5.2, B5.3 & B5.4 Seeds in managed transaction...');
  const passwordHash = await hashPassword(args.password);

  const client = await pool.connect();
  let b52Results;
  let b53Results;
  let b54Results;
  try {
    const combinedResults = await withTransaction(client, async (tx) => {
      const resB52 = await seedCoreIdentities(tx, { passwordHash });
      const resB53 = await seedCareOperations(tx, {
        idByPhone: resB52.idByPhone,
        caregiverIdByPhone: resB52.caregiverIdByPhone,
      });
      const resB54 = await seedSafetyAndAlerts(tx, {
        idByPhone: resB52.idByPhone,
      });
      return { resB52, resB53, resB54 };
    });
    b52Results = combinedResults.resB52;
    b53Results = combinedResults.resB53;
    b54Results = combinedResults.resB54;
  } finally {
    client.release();
  }

  console.log('\n═════════════════════════════════════════════════════════════════');
  console.log('  B5.2, B5.3 & B5.4 Seeds Completed Successfully');
  console.log('  --- B5.2 Identities ---');
  console.log(`  Users:              ${b52Results.users.total} (${b52Results.users.created} new, ${b52Results.users.updated} updated)`);
  console.log(`  Caregivers:         ${b52Results.caregivers.total} (${b52Results.caregivers.created} new, ${b52Results.caregivers.updated} updated)`);
  console.log(`  Family Links:       ${b52Results.familyLinks.total} (${b52Results.familyLinks.created} new, ${b52Results.familyLinks.updated} updated)`);
  console.log(`  Emergency Contacts: ${b52Results.emergencyContacts.total} (${b52Results.emergencyContacts.created} new, ${b52Results.emergencyContacts.updated} updated)`);
  console.log('  --- B5.3 Operations ---');
  console.log(`  Care Plans:         ${b53Results.carePlans.total} (${b53Results.carePlans.created} new, ${b53Results.carePlans.updated} updated)`);
  console.log(`  Bookings:           ${b53Results.bookings.total} (${b53Results.bookings.created} new, ${b53Results.bookings.updated} updated)`);
  console.log(`  Schedules:          ${b53Results.schedules.total} (${b53Results.schedules.created} new, ${b53Results.schedules.updated} updated)`);
  console.log(`  Attendance:         ${b53Results.attendance.total} (${b53Results.attendance.created} new, ${b53Results.attendance.updated} updated)`);
  console.log(`  Tasks:              ${b53Results.tasks.total} (${b53Results.tasks.created} new, ${b53Results.tasks.updated} updated)`);
  console.log(`  Activity Reports:   ${b53Results.activityReports.total} (${b53Results.activityReports.created} new, ${b53Results.activityReports.updated} updated)`);
  console.log(`  Reviews:            ${b53Results.reviews.total} (${b53Results.reviews.created} new, ${b53Results.reviews.updated} updated)`);
  console.log('  --- B5.4 Safety & Alerts ---');
  console.log(`  Geofences:          ${b54Results.geofences.total} (${b54Results.geofences.created} new, ${b54Results.geofences.updated} updated)`);
  console.log(`  Locations:          ${b54Results.locations.total} (${b54Results.locations.created} new, ${b54Results.locations.updated} updated)`);
  console.log(`  Alerts:             ${b54Results.alerts.total} (${b54Results.alerts.created} new, ${b54Results.alerts.updated} updated)`);
  console.log(`  Notification Feed:  ${b54Results.notificationFeed.total} (${b54Results.notificationFeed.created} new, ${b54Results.notificationFeed.updated} updated)`);
  console.log('═════════════════════════════════════════════════════════════════');
}

// Only execute when invoked directly from CLI
if (process.argv[1] && process.argv[1].endsWith('seed-demo-data.js')) {
  run()
    .then(async () => {
      await closePool();
    })
    .catch(async (err) => {
      console.error(`\n${err.message}`);
      await closePool();
      process.exit(1);
    });
}

