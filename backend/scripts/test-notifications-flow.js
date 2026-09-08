// ============================================================================
// End-to-end Integration Test for In-App Notification Feed (Phase 3b)
//
// Tests 9 event types across all categories, including multi-stakeholder fan-outs:
//   1. alert_fired             (SOS) — elderly self-confirm + family
//   2. invite_received         — invitee receives, actor excluded
//   3. alert_acknowledged      — elderly receives, actor excluded
//   4. alert_cancelled         — family receives, actor (elderly) excluded
//   5. booking_created         — caregiver receives, actor (elderly) excluded
//   6. task_assigned           — caregiver receives, actor (elderly) excluded
//   7. permissions_changed     — target family member receives, actor excluded
//   8. booking_status_changed  — MULTI-STAKEHOLDER fan-out: elderly + family booker receive, caregiver actor excluded
//   9. task_status_changed     — MULTI-STAKEHOLDER fan-out: elderly + family assigner receive, caregiver actor excluded
// ============================================================================

import { app } from '../app.js';
import { query, closePool } from '../shared/db/pool.js';
import { signAccessToken } from '../shared/auth/tokens.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`  ❌ FAIL: ${message}`);
    failed++;
    throw new Error(message);
  }
  passed++;
}

const wait = (ms = 400) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log('=== Notification Feed Extended Integration Tests ===\n');

  let server;
  const PORT = 4999;
  await new Promise((resolve) => {
    server = app.listen(PORT, resolve);
  });

  const baseUrl = `http://localhost:${PORT}`;

  let elderlyUser, familyUser, caregiverUser;

  try {
    // ------------------------------------------------------------------
    // 0. Fetch seed users and set up prerequisites
    // ------------------------------------------------------------------
    const { rows: users } = await query(`SELECT id, phone, role, full_name FROM users ORDER BY created_at ASC`);
    elderlyUser = users.find((u) => u.role === 'elderly');
    familyUser = users.find((u) => u.role === 'family');
    caregiverUser = users.find((u) => u.role === 'caregiver');

    if (!elderlyUser || !familyUser || !caregiverUser) {
      throw new Error('Seed users missing. Need elderly, family, and caregiver users in DB.');
    }

    console.log(`Elderly:   ${elderlyUser.full_name} (${elderlyUser.id})`);
    console.log(`Family:    ${familyUser.full_name} (${familyUser.id})`);
    console.log(`Caregiver: ${caregiverUser.full_name} (${caregiverUser.id})\n`);

    const elderlyToken = signAccessToken(elderlyUser);
    const familyToken = signAccessToken(familyUser);
    const caregiverToken = signAccessToken(caregiverUser);

    // ------------------------------------------------------------------
    // Pre-flight database cleanup (idempotent run guarantee)
    // ------------------------------------------------------------------
    await query(`DELETE FROM notification_feed WHERE recipient_user_id IN ($1, $2, $3)`, [
      elderlyUser.id,
      familyUser.id,
      caregiverUser.id,
    ]);

    await query(
      `UPDATE alerts SET status = 'resolved', resolved_by = $1, resolution_notes = 'Pre-test cleanup'
       WHERE user_id = $1 AND status = 'active'`,
      [elderlyUser.id]
    );

    await query(`DELETE FROM tasks WHERE elderly_user_id = $1`, [elderlyUser.id]);
    await query(`DELETE FROM caregiver_bookings WHERE elderly_user_id = $1`, [elderlyUser.id]);
    await query(`DELETE FROM family_links WHERE elderly_user_id = $1 AND family_user_id = $2`, [
      elderlyUser.id,
      caregiverUser.id,
    ]);

    // Ensure family link exists with all permissions enabled
    await query(
      `INSERT INTO family_links (
         elderly_user_id, family_user_id, relationship, permission_level, status,
         can_acknowledge_alerts, can_manage_caregivers, can_view_location, can_manage_contacts
       )
       VALUES ($1, $2, 'Child', 'owner', 'active', TRUE, TRUE, TRUE, TRUE)
       ON CONFLICT (elderly_user_id, family_user_id) DO UPDATE SET
         status = 'active',
         can_acknowledge_alerts = TRUE,
         can_manage_caregivers = TRUE,
         can_view_location = TRUE,
         can_manage_contacts = TRUE,
         permission_level = 'owner'`,
      [elderlyUser.id, familyUser.id]
    );

    // Find a caregiver profile ID for caregiver bookings/tasks
    const { rows: cgRows } = await query(`SELECT id FROM caregivers WHERE user_id = $1`, [caregiverUser.id]);
    let caregiverId;
    if (cgRows.length > 0) {
      caregiverId = cgRows[0].id;
    } else {
      const { rows: newCg } = await query(
        `INSERT INTO caregivers (user_id, verification_status) VALUES ($1, 'verified') RETURNING id`,
        [caregiverUser.id]
      );
      caregiverId = newCg[0].id;
    }

    // Helper: read feed for a given user
    async function getFeed(token) {
      const res = await fetch(`${baseUrl}/notifications`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json();
      return body.notifications;
    }

    // Helper: wait for async feed writes with polling
    async function waitForFeedItem(token, predicate, timeoutMs = 2500) {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const feed = await getFeed(token);
        if (feed.some(predicate)) return feed;
        await new Promise((r) => setTimeout(r, 100));
      }
      return await getFeed(token);
    }

    // =========================================================================
    // TEST 1: SOS Alert Fired (alert_fired) — elderly + family
    // =========================================================================
    console.log('[TEST 1] SOS Alert Fired');
    const sosRes = await fetch(`${baseUrl}/emergency/alerts`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${elderlyToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ latitude: 12.9716, longitude: 77.5946 }),
    });

    const sosBody = await sosRes.json();
    assert(sosRes.status === 201, `SOS creation failed: ${sosRes.status} — ${JSON.stringify(sosBody)}`);
    const alertId = sosBody.alert.id;
    console.log(`  Alert created: ${alertId}`);

    const elderlyFeed1 = await waitForFeedItem(elderlyToken, (n) => n.event_type === 'alert_fired' && n.title === 'SOS Alert Activated');
    const familyFeed1 = await waitForFeedItem(familyToken, (n) => n.event_type === 'alert_fired' && n.title === 'SOS Alert Triggered');

    assert(
      elderlyFeed1.some((n) => n.event_type === 'alert_fired' && n.title === 'SOS Alert Activated'),
      'Elderly should have SOS self-confirmation item'
    );
    assert(
      familyFeed1.some((n) => n.event_type === 'alert_fired' && n.title === 'SOS Alert Triggered'),
      'Family should have SOS notification item'
    );
    console.log('  ✅ PASSED: alert_fired → elderly + family receive\n');

    // =========================================================================
    // TEST 2: Family Invite Received (invite_received) + Actor Exclusion
    // =========================================================================
    console.log('[TEST 2] Invite Received + Actor Exclusion');

    await query(`DELETE FROM family_links WHERE elderly_user_id = $1 AND family_user_id = $2`, [
      elderlyUser.id,
      caregiverUser.id,
    ]);

    const inviteRes = await fetch(`${baseUrl}/family/invites`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${elderlyToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: caregiverUser.phone,
        relationship: 'Friend',
        permissionLevel: 'view',
      }),
    });

    const inviteBody = await inviteRes.json();
    assert(inviteRes.status === 201, `Invite failed: ${inviteRes.status} — ${JSON.stringify(inviteBody)}`);
    console.log(`  Invite created: ${inviteBody.link.id}`);

    const inviteeFeed = await waitForFeedItem(caregiverToken, (n) => n.event_type === 'invite_received');
    const inviterFeed = await getFeed(elderlyToken);

    assert(
      inviteeFeed.some((n) => n.event_type === 'invite_received'),
      'Invitee (caregiver) should have invite_received item'
    );
    assert(
      !inviterFeed.some((n) => n.event_type === 'invite_received'),
      'Inviter (elderly) should NOT have invite_received item — actor exclusion'
    );
    console.log('  ✅ PASSED: invite_received → invitee only, actor excluded\n');

    // Clean up the invite so it doesn't interfere
    await query(`DELETE FROM family_links WHERE elderly_user_id = $1 AND family_user_id = $2`, [
      elderlyUser.id,
      caregiverUser.id,
    ]);

    // =========================================================================
    // TEST 3: Alert Acknowledged (alert_acknowledged) + Actor Exclusion
    // =========================================================================
    console.log('[TEST 3] Alert Acknowledged + Actor Exclusion');
    const ackRes = await fetch(`${baseUrl}/emergency/alerts/${alertId}/acknowledge`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${familyToken}` },
    });
    const ackBody = await ackRes.json();
    assert(ackRes.status === 200, `Ack failed: ${ackRes.status} — ${JSON.stringify(ackBody)}`);

    const elderlyFeed3 = await waitForFeedItem(elderlyToken, (n) => n.event_type === 'alert_acknowledged');
    const familyFeed3 = await getFeed(familyToken);

    assert(
      elderlyFeed3.some((n) => n.event_type === 'alert_acknowledged'),
      'Elderly should have alert_acknowledged item'
    );
    assert(
      !familyFeed3.some((n) => n.event_type === 'alert_acknowledged'),
      'Family (actor who acknowledged) should NOT have alert_acknowledged — actor exclusion'
    );
    console.log('  ✅ PASSED: alert_acknowledged → elderly receives, actor excluded\n');

    // =========================================================================
    // TEST 4: Alert Cancelled (alert_cancelled) + Actor Exclusion
    // =========================================================================
    console.log('[TEST 4] Alert Cancelled + Actor Exclusion');
    const cancelRes = await fetch(`${baseUrl}/emergency/alerts/${alertId}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${elderlyToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: 'False alarm, testing' }),
    });
    const cancelBody = await cancelRes.json();
    assert(cancelRes.status === 200, `Cancel failed: ${cancelRes.status} — ${JSON.stringify(cancelBody)}`);

    const familyFeedAfterCancel = await waitForFeedItem(familyToken, (n) => n.event_type === 'alert_cancelled');
    const elderlyFeedAfterCancel = await getFeed(elderlyToken);

    assert(
      familyFeedAfterCancel.some((n) => n.event_type === 'alert_cancelled'),
      'Family should have alert_cancelled item'
    );
    assert(
      !elderlyFeedAfterCancel.some((n) => n.event_type === 'alert_cancelled'),
      'Elderly (actor who cancelled) should NOT have alert_cancelled — actor exclusion'
    );
    console.log('  ✅ PASSED: alert_cancelled → family receives, elderly actor excluded\n');

    // =========================================================================
    // TEST 5: Booking Created (booking_created) + Actor Exclusion
    // =========================================================================
    console.log('[TEST 5] Booking Created + Actor Exclusion');
    const bookingRes = await fetch(`${baseUrl}/caregiver/bookings`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${elderlyToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        elderlyUserId: elderlyUser.id,
        caregiverId: caregiverId,
        startDate: '2026-10-01',
        endDate: '2026-10-15',
        recurrence: 'daily',
        hoursPerVisit: 4,
        agreedRate: 500,
        currency: 'INR',
        specialInstructions: 'Test booking for notification',
      }),
    });

    const bookingBody = await bookingRes.json();
    assert(bookingRes.status === 201, `Booking failed: ${bookingRes.status} — ${JSON.stringify(bookingBody)}`);
    const bookingId = bookingBody.booking.id;
    console.log(`  Booking created: ${bookingId}`);

    const cgFeedAfterBooking = await waitForFeedItem(caregiverToken, (n) => n.event_type === 'booking_created');
    const elderlyFeedAfterBooking = await getFeed(elderlyToken);

    assert(
      cgFeedAfterBooking.some((n) => n.event_type === 'booking_created'),
      'Caregiver should have booking_created item'
    );
    assert(
      !elderlyFeedAfterBooking.some((n) => n.event_type === 'booking_created'),
      'Elderly (actor who booked) should NOT have booking_created — actor exclusion'
    );
    console.log('  ✅ PASSED: booking_created → caregiver receives, actor excluded\n');

    // =========================================================================
    // TEST 6: Task Assigned (task_assigned) + Actor Exclusion
    // =========================================================================
    console.log('[TEST 6] Task Assigned + Actor Exclusion');
    const taskRes = await fetch(`${baseUrl}/caregiver/tasks`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${elderlyToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        elderlyUserId: elderlyUser.id,
        assignedToCaregiverId: caregiverId,
        title: 'Take medication — test notification',
        description: 'Test task for notification feed',
        priority: 'high',
        dueDate: '2026-10-01',
      }),
    });

    const taskBody = await taskRes.json();
    assert(taskRes.status === 201, `Task failed: ${taskRes.status} — ${JSON.stringify(taskBody)}`);
    const taskId = taskBody.task.id;
    console.log(`  Task created: ${taskId}`);

    const cgFeedAfterTask = await waitForFeedItem(caregiverToken, (n) => n.event_type === 'task_assigned');
    const elderlyFeedAfterTask = await getFeed(elderlyToken);

    assert(
      cgFeedAfterTask.some((n) => n.event_type === 'task_assigned'),
      'Caregiver should have task_assigned item'
    );
    assert(
      !elderlyFeedAfterTask.some((n) => n.event_type === 'task_assigned'),
      'Elderly (actor who assigned) should NOT have task_assigned — actor exclusion'
    );
    console.log('  ✅ PASSED: task_assigned → caregiver receives, actor excluded\n');

    // =========================================================================
    // TEST 7: Permissions Changed (permissions_changed) + Actor Exclusion
    // =========================================================================
    console.log('[TEST 7] Permissions Changed + Actor Exclusion');
    const { rows: linkRows } = await query(
      `SELECT id FROM family_links WHERE elderly_user_id = $1 AND family_user_id = $2 AND status = 'active'`,
      [elderlyUser.id, familyUser.id]
    );
    assert(linkRows.length > 0, 'Active family link between elderly and family user must exist');
    const linkId = linkRows[0].id;

    // Clear feed to isolate this test
    await query(`DELETE FROM notification_feed WHERE recipient_user_id IN ($1, $2) AND event_type = 'permissions_changed'`, [
      elderlyUser.id,
      familyUser.id,
    ]);

    const permRes = await fetch(`${baseUrl}/family/links/${linkId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${elderlyToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        canViewLocation: true,
        canManageContacts: true,
      }),
    });

    const permBody = await permRes.json();
    assert(permRes.status === 200, `Permissions update failed: ${permRes.status} — ${JSON.stringify(permBody)}`);
    console.log('  Permissions updated for family link');

    const familyFeedAfterPerm = await waitForFeedItem(familyToken, (n) => n.event_type === 'permissions_changed');
    const elderlyFeedAfterPerm = await getFeed(elderlyToken);

    assert(
      familyFeedAfterPerm.some((n) => n.event_type === 'permissions_changed'),
      'Family member (target) should have permissions_changed item'
    );
    assert(
      !elderlyFeedAfterPerm.some((n) => n.event_type === 'permissions_changed'),
      'Elderly (actor who changed permissions) should NOT have permissions_changed — actor exclusion'
    );
    console.log('  ✅ PASSED: permissions_changed → target receives, actor excluded\n');

    // =========================================================================
    // TEST 8: Booking Status Changed (booking_status_changed) — Multi-stakeholder fanout
    // =========================================================================
    console.log('[TEST 8] Booking Status Changed — Multi-Stakeholder Fanout');
    // Step 8a: Family user books caregiver for elderly
    const multiBookingRes = await fetch(`${baseUrl}/caregiver/bookings`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${familyToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        elderlyUserId: elderlyUser.id,
        caregiverId: caregiverId,
        startDate: '2026-11-01',
        endDate: '2026-11-10',
        recurrence: 'daily',
        hoursPerVisit: 3,
        agreedRate: 600,
        currency: 'INR',
        specialInstructions: 'Multi-stakeholder fanout test booking',
      }),
    });
    const multiBookingBody = await multiBookingRes.json();
    assert(multiBookingRes.status === 201, `Multi-booking creation failed: ${multiBookingRes.status} — ${JSON.stringify(multiBookingBody)}`);
    const multiBookingId = multiBookingBody.booking.id;

    // Clear feed to isolate status change
    await query(`DELETE FROM notification_feed WHERE recipient_user_id IN ($1, $2, $3) AND event_type = 'booking_status_changed'`, [
      elderlyUser.id,
      familyUser.id,
      caregiverUser.id,
    ]);

    // Step 8b: Caregiver confirms booking (actor = caregiver)
    const confirmRes = await fetch(`${baseUrl}/caregiver/bookings/${multiBookingId}/status`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${caregiverToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'confirmed' }),
    });
    const confirmBody = await confirmRes.json();
    assert(confirmRes.status === 200, `Booking status update failed: ${confirmRes.status} — ${JSON.stringify(confirmBody)}`);

    const elderlyFeed8 = await waitForFeedItem(elderlyToken, (n) => n.event_type === 'booking_status_changed' && n.event_id === multiBookingId);
    const familyFeed8 = await waitForFeedItem(familyToken, (n) => n.event_type === 'booking_status_changed' && n.event_id === multiBookingId);
    const caregiverFeed8 = await getFeed(caregiverToken);

    // Multi-stakeholder assertions:
    assert(
      elderlyFeed8.some((n) => n.event_type === 'booking_status_changed' && n.event_id === multiBookingId),
      'Elderly should receive booking_status_changed notification'
    );
    assert(
      familyFeed8.some((n) => n.event_type === 'booking_status_changed' && n.event_id === multiBookingId),
      'Family (booker) should receive booking_status_changed notification'
    );
    assert(
      !caregiverFeed8.some((n) => n.event_type === 'booking_status_changed' && n.event_id === multiBookingId),
      'Caregiver (actor who confirmed) should NOT receive booking_status_changed — actor exclusion'
    );
    console.log('  ✅ PASSED: booking_status_changed → both elderly and family receive, caregiver actor excluded\n');

    // =========================================================================
    // TEST 9: Task Status Changed (task_status_changed) — Multi-stakeholder fanout
    // =========================================================================
    console.log('[TEST 9] Task Status Changed — Multi-Stakeholder Fanout');
    // Step 9a: Family user assigns a task for elderly to caregiver
    const multiTaskRes = await fetch(`${baseUrl}/caregiver/tasks`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${familyToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        elderlyUserId: elderlyUser.id,
        assignedToCaregiverId: caregiverId,
        title: 'Evening physiotherapy exercises',
        description: 'Assist with 15-min leg stretching routine',
        priority: 'normal',
        dueDate: '2026-11-02',
      }),
    });
    const multiTaskBody = await multiTaskRes.json();
    assert(multiTaskRes.status === 201, `Multi-task creation failed: ${multiTaskRes.status} — ${JSON.stringify(multiTaskBody)}`);
    const multiTaskId = multiTaskBody.task.id;

    // Clear feed to isolate status change
    await query(`DELETE FROM notification_feed WHERE recipient_user_id IN ($1, $2, $3) AND event_type = 'task_status_changed'`, [
      elderlyUser.id,
      familyUser.id,
      caregiverUser.id,
    ]);

    // Step 9b: Caregiver marks task in_progress (actor = caregiver)
    const taskStatusRes = await fetch(`${baseUrl}/caregiver/tasks/${multiTaskId}/status`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${caregiverToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'in_progress', completionNotes: 'Started exercise session' }),
    });
    const taskStatusBody = await taskStatusRes.json();
    assert(taskStatusRes.status === 200, `Task status update failed: ${taskStatusRes.status} — ${JSON.stringify(taskStatusBody)}`);

    const elderlyFeed9 = await waitForFeedItem(elderlyToken, (n) => n.event_type === 'task_status_changed' && n.event_id === multiTaskId);
    const familyFeed9 = await waitForFeedItem(familyToken, (n) => n.event_type === 'task_status_changed' && n.event_id === multiTaskId);
    const caregiverFeed9 = await getFeed(caregiverToken);

    // Multi-stakeholder assertions:
    assert(
      elderlyFeed9.some((n) => n.event_type === 'task_status_changed' && n.event_id === multiTaskId),
      'Elderly should receive task_status_changed notification'
    );
    assert(
      familyFeed9.some((n) => n.event_type === 'task_status_changed' && n.event_id === multiTaskId),
      'Family (assigner) should receive task_status_changed notification'
    );
    assert(
      !caregiverFeed9.some((n) => n.event_type === 'task_status_changed' && n.event_id === multiTaskId),
      'Caregiver (actor who updated status) should NOT receive task_status_changed — actor exclusion'
    );
    console.log('  ✅ PASSED: task_status_changed → both elderly and family receive, caregiver actor excluded\n');

    // =========================================================================
    // Summary
    // =========================================================================
    console.log('=================================================');
    console.log(`ALL ${passed} ASSERTIONS PASSED across 9 event types!`);
    console.log('=================================================');
    console.log('\nEvent types tested:');
    console.log('  1. alert_fired             ← elderly self-confirm + family');
    console.log('  2. invite_received         ← invitee only, actor excluded');
    console.log('  3. alert_acknowledged      ← elderly only, actor excluded');
    console.log('  4. alert_cancelled         ← family only, actor excluded');
    console.log('  5. booking_created         ← caregiver, actor excluded');
    console.log('  6. task_assigned           ← caregiver, actor excluded');
    console.log('  7. permissions_changed     ← target family member, actor excluded');
    console.log('  8. booking_status_changed  ← multi-fanout: elderly + family booker, caregiver excluded');
    console.log('  9. task_status_changed     ← multi-fanout: elderly + family assigner, caregiver excluded');
  } catch (err) {
    console.error(`\n❌ TEST SUITE FAILED: ${err.message}`);
    console.error(`   ${passed} passed, ${failed} failed`);
    process.exitCode = 1;
  } finally {
    console.log('\n[TEARDOWN] Cleaning up test-generated database state...');
    try {
      if (elderlyUser && familyUser && caregiverUser) {
        // Resolve any active alerts
        await query(
          `UPDATE alerts SET status = 'resolved', resolved_by = $1, resolution_notes = 'Post-test cleanup'
           WHERE user_id = $1 AND status = 'active'`,
          [elderlyUser.id]
        );
        // Clean up test tasks and bookings
        await query(`DELETE FROM tasks WHERE elderly_user_id = $1`, [elderlyUser.id]);
        await query(`DELETE FROM caregiver_bookings WHERE elderly_user_id = $1`, [elderlyUser.id]);
        // Remove temporary invite link if present
        await query(`DELETE FROM family_links WHERE elderly_user_id = $1 AND family_user_id = $2`, [
          elderlyUser.id,
          caregiverUser.id,
        ]);
        // Reset family link to default active state
        await query(
          `UPDATE family_links
           SET status = 'active', can_acknowledge_alerts = TRUE, can_manage_caregivers = TRUE,
               can_view_location = TRUE, can_manage_contacts = TRUE, permission_level = 'owner'
           WHERE elderly_user_id = $1 AND family_user_id = $2`,
          [elderlyUser.id, familyUser.id]
        );
        // Purge test notification feed items
        await query(`DELETE FROM notification_feed WHERE recipient_user_id IN ($1, $2, $3)`, [
          elderlyUser.id,
          familyUser.id,
          caregiverUser.id,
        ]);
        console.log('[TEARDOWN] All test state cleaned successfully.');
      }
    } catch (cleanErr) {
      console.error('[TEARDOWN] Error during cleanup:', cleanErr.message);
    }
    await wait(300);
    server.close();
    await closePool();
  }
}

main();
