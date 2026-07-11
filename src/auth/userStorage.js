// ─────────────────────────────────────────────────────────────────────────────
// Per-user, cloud-backed storage for agencyx.
//
// The app talks to a tiny `window.storage` interface ({ get(key), set(key,value) }).
// installUserStorage(uid) swaps that interface for a Firestore-backed one scoped to
// the signed-in user (document `users/{uid}`), so each account has isolated data that
// follows them across devices.
//
// IMPORTANT: localStorage is shared by every account on a browser, so the offline
// cache is namespaced per-uid (`agencyx:{uid}:{key}`). One account can never read
// another's cached data, even after signing out on the same device.
// ─────────────────────────────────────────────────────────────────────────────
import { doc, getDoc, onSnapshot, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "./firebase.js";

const STORAGE_KEY = "fanlink-tracker-v4"; // workspace data blob
const THEME_KEY = "agencyx-theme";        // light/dark preference
const KEYS = [STORAGE_KEY, THEME_KEY];
const LEGACY_CLAIMED = "agencyx:legacy-claimed"; // one-time guard for pre-Firebase data

const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* quota / privacy mode */ } };
const lsDel = (k) => { try { localStorage.removeItem(k); } catch { /* ignore */ } };

export async function installUserStorage(uid) {
  const ref = doc(db, "users", uid);

  // Per-user cache key. Theme stays on the shared key (benign — it only lets the
  // login screen show the last-used theme); workspace data is namespaced per uid so
  // a different account on the same device never sees stale data.
  const localKey = (key) => (key === THEME_KEY ? key : `agencyx:${uid}:${key}`);

  const cache = {};         // key -> string value, hydrated before the app reads
  const lastWritten = {};   // dedupe the live listener against this tab's own writes
  const timers = {};        // per-key debounce timers

  // ── Hydrate: cloud is the source of truth, else this user's own local cache ──
  let remote = {};
  try {
    const snap = await getDoc(ref);
    remote = (snap.exists() && snap.data().data) || {};
  } catch { remote = {}; }

  for (const key of KEYS) {
    if (remote[key] != null) { cache[key] = remote[key]; lsSet(localKey(key), remote[key]); }
    else { const local = lsGet(localKey(key)); if (local != null) cache[key] = local; }
  }

  // ── One-time legacy claim ────────────────────────────────────────────────────
  // Data created before per-user storage lived under the bare key. The FIRST account
  // to sign in after the upgrade adopts it (only if it has no data of its own); the
  // bare key is then removed so it can never leak into another account.
  if (!lsGet(LEGACY_CLAIMED)) {
    const legacy = lsGet(STORAGE_KEY); // bare, pre-namespace key
    if (legacy != null && cache[STORAGE_KEY] == null) {
      cache[STORAGE_KEY] = legacy;
      lsSet(localKey(STORAGE_KEY), legacy);
      lastWritten[STORAGE_KEY] = legacy;
      try { await setDoc(ref, { data: { [STORAGE_KEY]: legacy }, updatedAt: serverTimestamp() }, { merge: true }); } catch { /* offline; retries on next write */ }
    }
    lsSet(LEGACY_CLAIMED, "1");
    lsDel(STORAGE_KEY); // retire the shared bare key regardless
  }

  // ── Live cross-device sync ───────────────────────────────────────────────────
  const unsub = onSnapshot(ref, { includeMetadataChanges: false }, (snap) => {
    if (!snap.exists() || snap.metadata.hasPendingWrites) return; // skip our own optimistic writes
    const data = snap.data().data || {};
    for (const key of Object.keys(data)) {
      const incoming = data[key];
      if (incoming === lastWritten[key] || incoming === cache[key]) continue; // unchanged / our echo
      cache[key] = incoming;
      lsSet(localKey(key), incoming);
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
      const v = cache[key] != null ? cache[key] : lsGet(localKey(key));
      return { value: v };
    },
    async set(key, value) {
      cache[key] = value;
      lsSet(localKey(key), value);   // instant per-user local cache
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
    window.storage = makeGuestStorage();
  };
}

// Used before login and after logout, while the app shell renders behind the
// login overlay: the workspace reads as pristine and nothing persists, so no
// account's data can ever show or leak on a shared browser. Only the theme
// preference (benign, shared by design) touches localStorage.
export function makeGuestStorage() {
  return {
    async get(key) { return { value: key === THEME_KEY ? lsGet(key) : null }; },
    async set(key, value) { if (key === THEME_KEY) lsSet(key, value); },
  };
}
