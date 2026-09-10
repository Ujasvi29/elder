import { query, pool } from '../shared/db/pool.js';
import { signAccessToken } from '../shared/auth/tokens.js';
import { createFeedItem } from '../notifications/feedWriter.js';

async function test() {
  const user = { id: '43d2e8c5-82cd-4307-a673-3a84d411bd7e', role: 'family' };
  const jwt = signAccessToken(user);

  console.log('Sending real notification to Family user...');
  await createFeedItem({
    recipientUserIds: [user.id],
    eventType: 'booking_created',
    title: 'Real Device Feed Test',
    body: 'Testing feed display and mark-as-read',
    sendPush: true,
  });

  const res1 = await fetch('http://localhost:5000/notifications', {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  const json1 = await res1.json();
  const item = json1.notifications[0];
  console.log('Item retrieved from feed:', item.title, '| is_read:', item.is_read);

  const res2 = await fetch(`http://localhost:5000/notifications/${item.id}/read`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${jwt}` },
  });
  const json2 = await res2.json();
  console.log('After mark-as-read: is_read =', json2.is_read);

  // Clean up
  await query('DELETE FROM notification_feed WHERE id = $1', [item.id]);
  await pool.end();
}

test().catch(async (e) => {
  console.error(e);
  await pool.end();
});
