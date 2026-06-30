// ─────────────────────────────────────────────────────────────────────────────
// Per-user, cloud-backed storage for agencyx.
//
// The app talks to a tiny `window.storage` interface ({ get(key), set(key,value) }).
// installUserStorage(uid) swaps that interface for a Firestore-backed one scoped to
// the signed-in user (document `users/{uid}`), so each account has isolated data that
// follows them across devices. Writes mirror to localStorage as an offline cache, and
// a live listener pushes changes made on other devices into the running app.
// ─────────────────────────────────────────────────────────────────────────────
import { doc, getDoc, onSnapshot, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "./firebase.js";

// Keys the app persists through window.storage. We migrate these from localStorage
// the first time a user signs in on a device that already has local data.
const MIGRATE_KEYS = ["fanlink-tracker-v4", "agencyx-theme"];

const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* quota / privacy mode */ } };

export async function installUserStorage(uid) {
  const ref = doc(db, "users", uid);

  // In-memory cache of key -> string value, hydrated from Firestore (falling back to
  // any local data) before the app reads anything.
  const cache = {};
  // Track what this tab last wrote per key so the live listener can ignore its own echoes.
  const lastWritten = {};
  // Debounce timers per key so rapid edits collapse into one Firestore write.
  const timers = {};

  // ── Hydrate ────────────────────────────────────────────────────────────────
  let remote = {};
  try {
    const snap = await getDoc(ref);
    remote = (snap.exists() && snap.data().data) || {};
  } catch { remote = {}; }

  let needsSeed = false;
  for (const key of MIGRATE_KEYS) {
    if (remote[key] != null) {
      cache[key] = remote[key];
      lsSet(key, remote[key]); // refresh local cache from cloud
    } else {
      const local = lsGet(key);
      if (local != null) { cache[key] = local; needsSeed = true; } // migrate local -> cloud
    }
  }

  // First sign-in with existing local data: push it up so nothing is lost.
  if (needsSeed) {
    const seed = {};
    for (const key of MIGRATE_KEYS) if (cache[key] != null) { seed[key] = cache[key]; lastWritten[key] = cache[key]; }
    try { await setDoc(ref, { data: seed, updatedAt: serverTimestamp() }, { merge: true }); } catch { /* offline; will retry on next write */ }
  }

  // ── Live cross-device sync ───────────────────────────────────────────────────
  const unsub = onSnapshot(ref, { includeMetadataChanges: false }, (snap) => {
    if (!snap.exists() || snap.metadata.hasPendingWrites) return; // skip our own optimistic writes
    const data = snap.data().data || {};
    for (const key of Object.keys(data)) {
      const incoming = data[key];
      if (incoming === lastWritten[key] || incoming === cache[key]) continue; // unchanged / our echo
      cache[key] = incoming;
      lsSet(key, incoming);
      // Let the app react to changes made on another device.
      try { window.dispatchEvent(new CustomEvent("agencyx:remote", { detail: { key, value: incoming } })); } catch { /* ignore */ }
    }
  });

  const writeKey = (key, value) => {
    lastWritten[key] = value;
    setDoc(ref, { data: { [key]: value }, updatedAt: serverTimestamp() }, { merge: true })
      .catch((e) => console.error("Cloud save failed", e));
  };

  // ── window.storage implementation ────────────────────────────────────────────
  window.storage = {
    async get(key) {
      const v = cache[key] != null ? cache[key] : lsGet(key);
      return { value: v };
    },
    async set(key, value) {
      cache[key] = value;
      lsSet(key, value);            // instant local cache
      clearTimeout(timers[key]);
      timers[key] = setTimeout(() => writeKey(key, value), 400); // debounced cloud write
    },
  };

  // Cleanup for sign-out / account switch: stop listening, flush pending writes,
  // and drop the cloud-backed interface so no data leaks into the next session.
  return function uninstall() {
    unsub();
    for (const key of Object.keys(timers)) {
      clearTimeout(timers[key]);
      if (cache[key] != null && cache[key] !== lastWritten[key]) writeKey(key, cache[key]);
    }
    window.storage = makeLocalStorage();
  };
}

// Fallback used before login and after logout: plain localStorage, same interface.
export function makeLocalStorage() {
  return {
    async get(key) { return { value: lsGet(key) }; },
    async set(key, value) { lsSet(key, value); },
  };
}
