// ============================================================================
// On-device offline queue for background location readings — Phase 3 step 2.
//
// Backed by a JSON file (expo-file-system's legacy, promise-based API — the
// well-worn one, not the new sync/JSI File API this same package also ships;
// a headless background context is exactly the wrong place to be the first
// code in the project to find a rough edge in a newer API). Not SecureStore:
// its encrypted-storage backing on Android has a practical per-value size
// limit that a growing array of readings would eventually hit, and nothing
// queued here is a credential — it's the same coordinates already sent in
// plaintext to the backend once delivered, so encryption buys nothing here
// that would justify that limit.
//
// Capped at MAX_QUEUE_SIZE so an extended offline stretch (phone in a drawer
// for days) can't grow this file without bound. Oldest entries are dropped
// first when the cap is hit — a month-old queued reading has essentially no
// safety value by the time it would ever be sent — but the drop itself is
// recorded, not silent: a silent drop would leave an unexplained gap in the
// location trail later with nothing pointing at why.
// ============================================================================

// The '/legacy' entry point is load-bearing, not leftover: on SDK 54 the
// bare 'expo-file-system' entry exports getInfoAsync/readAsStringAsync/
// writeAsStringAsync as stubs that throw on call, and does not export
// documentDirectory at all. Dropping the suffix (as commit 0e381b8 did)
// silently turned QUEUE_FILE into the string "undefined..." and made every
// write throw — two days of background readings never left the device.
import * as FileSystem from 'expo-file-system/legacy';

const QUEUE_FILE = `${FileSystem.documentDirectory}eldercare-location-queue.json`;
const MAX_QUEUE_SIZE = 2000;
const MAX_DROP_LOG = 50; // a log of drops, not a growing archive — bounded too

async function readState() {
  try {
    const info = await FileSystem.getInfoAsync(QUEUE_FILE);
    if (!info.exists) return { items: [], drops: [] };
    const parsed = JSON.parse(await FileSystem.readAsStringAsync(QUEUE_FILE));
    return { items: parsed.items ?? [], drops: parsed.drops ?? [] };
  } catch {
    // A corrupt or unreadable queue file must not wedge the task forever —
    // start clean rather than retrying a file that can't be parsed.
    return { items: [], drops: [] };
  }
}

// Logged, never rethrown. A throw here propagates out of enqueueLocation and
// rejects the whole TaskManager delivery — which is precisely how the
// 0e381b8 import regression stayed invisible: the task ran, died on the
// first write, and reported nothing anywhere. A failed write costs one
// reading (or, from removeOldest, re-sends readings the backend's duplicate
// guard already rejects); a failed delivery costs everything behind it.
async function writeState(state) {
  try {
    await FileSystem.writeAsStringAsync(QUEUE_FILE, JSON.stringify(state));
    return true;
  } catch (err) {
    console.warn(`Location queue write failed — this reading is lost: ${err?.message ?? err}`);
    return false;
  }
}

/**
 * Adds one reading to the end of the queue. If that pushes the queue past
 * MAX_QUEUE_SIZE, the oldest entries are dropped and the drop is logged with
 * a count and a timestamp.
 */
export async function enqueueLocation(reading) {
  const state = await readState();
  state.items.push({ ...reading, queuedAt: new Date().toISOString() });

  if (state.items.length > MAX_QUEUE_SIZE) {
    const overflow = state.items.length - MAX_QUEUE_SIZE;
    state.items.splice(0, overflow);
    state.drops.push({ count: overflow, at: new Date().toISOString() });
    if (state.drops.length > MAX_DROP_LOG) state.drops.splice(0, state.drops.length - MAX_DROP_LOG);
    console.warn(`Location queue exceeded ${MAX_QUEUE_SIZE} — dropped ${overflow} oldest reading(s).`);
  }

  await writeState(state);
}

/** All currently queued readings, oldest first. Read-only — does not remove anything. */
export async function peekQueue() {
  return (await readState()).items;
}

/** Removes exactly the oldest `count` readings — called after they're confirmed sent. */
export async function removeOldest(count) {
  if (count <= 0) return;
  const state = await readState();
  state.items.splice(0, count);
  await writeState(state);
}

/** The history of capacity-triggered drops — for surfacing "some readings were lost" later. */
export async function getDropHistory() {
  return (await readState()).drops;
}
