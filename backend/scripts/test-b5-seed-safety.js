// ============================================================================
// Test Suite: B5.1 Seed Infrastructure & Safety Mechanisms
// ============================================================================

import { execSync } from 'node:child_process';
import { pool, query, closePool } from '../shared/db/pool.js';
import {
  validateEnvironment,
  validateDatabaseHost,
  validatePassword,
  parseArgs,
  withTransaction,
  generateDeterministicUuid,
  CONFLICT_TARGETS,
} from './seed-demo-data.js';

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

async function run() {
  console.log('═════════════════════════════════════════════════════════════════');
  console.log('  B5.1 Seed Infrastructure & Safety Verification Suite');
  console.log('═════════════════════════════════════════════════════════════════\n');

  // 1. Environment Safeguards
  console.log('1. Production environment safety checks:');
  try {
    validateEnvironment({ NODE_ENV: 'production' });
    assert(false, 'Should throw on NODE_ENV=production');
  } catch (err) {
    assert(err.message.includes('REFUSED') && err.message.includes('NODE_ENV="production"'),
      'Refuses execution when NODE_ENV="production"');
  }

  try {
    validateEnvironment({ APP_ENV: 'production' });
    assert(false, 'Should throw on APP_ENV=production');
  } catch (err) {
    assert(err.message.includes('REFUSED') && err.message.includes('APP_ENV="production"'),
      'Refuses execution when APP_ENV="production"');
  }

  const safeEnv = validateEnvironment({ NODE_ENV: 'development', APP_ENV: 'local' });
  assert(safeEnv.nodeEnv === 'development', 'Allows execution in development');

  // 2. Remote Database Host Protection
  console.log('\n2. Remote database host checks:');
  const remoteUrl = 'postgres://postgres:secret@rds.us-east-1.amazonaws.com:5432/eldercare';

  try {
    validateDatabaseHost(remoteUrl, false);
    assert(false, 'Should throw on remote host without --allow-remote');
  } catch (err) {
    assert(err.message.includes('rds.us-east-1.amazonaws.com') && err.message.includes('--allow-remote'),
      'Refuses remote host without --allow-remote (names detected host)');
  }

  const remoteAllowed = validateDatabaseHost(remoteUrl, true);
  assert(remoteAllowed.allowRemote === true && remoteAllowed.hostname === 'rds.us-east-1.amazonaws.com',
    'Permits remote host when --allow-remote is explicitly provided');

  const localHost = validateDatabaseHost('postgres://postgres:secret@localhost:5432/eldercare', false);
  assert(localHost.isLocal === true, 'Accepts localhost without special flags');

  const ipHost = validateDatabaseHost('postgres://postgres:secret@127.0.0.1:5432/eldercare', false);
  assert(ipHost.isLocal === true, 'Accepts 127.0.0.1 without special flags');

  // 3. Password Validation
  console.log('\n3. Password length and presence checks:');
  try {
    validatePassword(null);
    assert(false, 'Should throw on missing password');
  } catch (err) {
    assert(err.message.includes('Master password required'), 'Refuses missing password');
  }

  try {
    validatePassword('short');
    assert(false, 'Should throw on password < 8 characters');
  } catch (err) {
    assert(err.message.includes('at least 8 characters'), 'Refuses password shorter than 8 characters');
  }

  const validPass = validatePassword('ValidPassword123!');
  assert(validPass === true, 'Accepts valid password meeting 8+ characters requirement');

  // 4. Argument Parsing
  console.log('\n4. CLI flag parsing:');
  const parsed = parseArgs(['MySecretPass123', '--dry-run', '--allow-remote']);
  assert(parsed.password === 'MySecretPass123', 'Parses positional password');
  assert(parsed.dryRun === true, 'Parses --dry-run flag');
  assert(parsed.allowRemote === true, 'Parses --allow-remote flag');

  // 5. Deterministic UUID Generation
  console.log('\n5. Deterministic identifier generation:');
  const uuid1 = generateDeterministicUuid('care_plans', 'plan_ramesh_stroke');
  const uuid2 = generateDeterministicUuid('care_plans', 'plan_ramesh_stroke');
  const uuid3 = generateDeterministicUuid('care_plans', 'plan_saraswathi_memory');

  assert(uuid1 === uuid2, 'Same entity key produces identical deterministic UUID');
  assert(uuid1 !== uuid3, 'Different entity keys produce unique UUIDs');
  assert(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid1),
    'Deterministic UUID conforms to standard UUID formatting');

  // 6. Transaction Rollback Behavior
  console.log('\n6. Transaction atomic rollback check:');
  const testPhone = '+919999999888';
  const client = await pool.connect();
  let rolledBack = false;

  try {
    await withTransaction(client, async (tx) => {
      await tx.query(
        `INSERT INTO users (phone, full_name, role, password_hash)
         VALUES ($1, 'Rollback Test User', 'elderly', '$2b$10$dummyhashfortesting000000000000000000000000000000000000')`,
        [testPhone]
      );
      // Simulate an error inside the transaction
      throw new Error('Simulated transactional failure');
    });
  } catch (err) {
    if (err.message === 'Simulated transactional failure') {
      rolledBack = true;
    }
  } finally {
    client.release();
  }

  assert(rolledBack, 'Transaction caught and threw the simulated error');
  const { rows: verifyRollback } = await query('SELECT * FROM users WHERE phone = $1', [testPhone]);
  assert(verifyRollback.length === 0, 'Rolled back row was NOT committed to the database');

  // 7. Dry-Run Zero Mutation Verification
  console.log('\n7. Dry-run zero mutation verification:');
  const getCounts = async () => {
    const res = await query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `);
    const counts = {};
    for (const r of res.rows) {
      const c = await query(`SELECT COUNT(*) as count FROM "${r.table_name}"`);
      counts[r.table_name] = parseInt(c.rows[0].count, 10);
    }
    return counts;
  };

  const countsBefore = await getCounts();

  // Run seed-demo-data.js with --dry-run
  const dryRunOutput = execSync(
    'node scripts/seed-demo-data.js TestMasterPass123! --dry-run',
    { cwd: process.cwd(), encoding: 'utf8' }
  );
  assert(dryRunOutput.includes('[B5] --dry-run specified: performing zero database mutations.'),
    'Dry-run flag recognized and logged by script');

  const countsAfter = await getCounts();

  let countsMatch = true;
  for (const [table, count] of Object.entries(countsBefore)) {
    if (countsAfter[table] !== count) {
      countsMatch = false;
      console.error(`Mismatch on table ${table}: before=${count}, after=${countsAfter[table]}`);
    }
  }
  assert(countsMatch, 'All 21 table row counts identical before and after --dry-run (0 mutations)');

  console.log('\n═════════════════════════════════════════════════════════════════');
  console.log(`  All B5.1 Safety Tests Passed! (${totalPassed} passed, ${totalFailed} failed)`);
  console.log('═════════════════════════════════════════════════════════════════\n');
}

run()
  .then(() => closePool())
  .catch(async (err) => {
    console.error('Safety test suite failed:', err);
    await closePool();
    process.exit(1);
  });
