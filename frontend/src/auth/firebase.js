import { initializeApp } from "firebase/app";
import { getAuth, setPersistence, browserLocalPersistence } from "firebase/auth";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from "firebase/firestore";

// Firebase web config. These values are NOT secret — Firebase web API keys are safe
// to ship in client code; access is controlled by Auth providers + Authorized domains
// and Security Rules, not by hiding the key. Values come from Vite env vars when set
// (e.g. on Vercel) and fall back to the agencyx-8c5b0 project config for local dev.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyAhxJyi0t7f_qM4MQ7EhKxoYDy-zSgg9uU",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "agencyx-8c5b0.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "agencyx-8c5b0",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "agencyx-8c5b0.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "267324385662",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:267324385662:web:9dcceea49f6f16ec29ab2f",
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || "G-9C3NS0BTGE",
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Keep users signed in across reloads/tabs (default, but set explicitly for clarity).
setPersistence(auth, browserLocalPersistence).catch(() => { /* non-fatal */ });

// Firestore with offline persistence so the app keeps working without a connection
// and reloads instantly from cache. Multi-tab manager keeps tabs in sync.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});
