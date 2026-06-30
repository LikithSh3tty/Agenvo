// ─────────────────────────────────────────────────────────────────────────────
// Auth backend for agencyx — Firebase Auth.
//
// Components only ever talk to the exports below, so the rest of the app is
// decoupled from Firebase specifics:
//   onAuthChange(cb) · signUp(...) · signIn(...) · signInWithGoogle() ·
//   signOutUser() · sendReset(email)
// ─────────────────────────────────────────────────────────────────────────────
import {
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  updateProfile,
  signOut,
  sendPasswordResetEmail,
} from "firebase/auth";
import { auth } from "./firebase.js";

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

// Normalize a Firebase user into the shape the app expects.
const toUser = (u) => (u ? { uid: u.uid, email: u.email, displayName: u.displayName || "", photoURL: u.photoURL || "" } : null);

// Map Firebase error codes to friendly, human messages.
const MESSAGES = {
  "auth/invalid-email": "Enter a valid email address.",
  "auth/missing-email": "Enter your email address.",
  "auth/user-disabled": "This account has been disabled.",
  "auth/user-not-found": "No account found for this email.",
  "auth/wrong-password": "Incorrect email or password.",
  "auth/invalid-credential": "Incorrect email or password.",
  "auth/email-already-in-use": "An account with this email already exists.",
  "auth/weak-password": "Password must be at least 6 characters.",
  "auth/too-many-requests": "Too many attempts. Try again in a moment.",
  "auth/network-request-failed": "Network error. Check your connection and try again.",
  "auth/popup-closed-by-user": "Sign-in was cancelled.",
  "auth/popup-blocked": "Your browser blocked the sign-in popup. Allow popups and retry.",
  "auth/cancelled-popup-request": "Sign-in was cancelled.",
  "auth/operation-not-allowed": "This sign-in method isn't enabled for the project yet.",
  "auth/account-exists-with-different-credential": "This email is already linked to a different sign-in method.",
  "auth/unauthorized-domain": "This domain isn't authorized for sign-in. Add it in Firebase Auth settings.",
};

class AuthError extends Error {
  constructor(err) {
    const code = err?.code || "auth/unknown";
    super(MESSAGES[code] || err?.message || "Something went wrong. Try again.");
    this.code = code;
  }
}

export function getCurrentUser() {
  return toUser(auth.currentUser);
}

export function onAuthChange(cb) {
  return onAuthStateChanged(auth, (u) => cb(toUser(u)));
}

export async function signUp({ name, email, password }) {
  try {
    const cred = await createUserWithEmailAndPassword(auth, String(email).trim(), password);
    const display = String(name || "").trim();
    if (display) await updateProfile(cred.user, { displayName: display });
    return toUser(cred.user);
  } catch (e) {
    throw new AuthError(e);
  }
}

export async function signIn({ email, password }) {
  try {
    const cred = await signInWithEmailAndPassword(auth, String(email).trim(), password);
    return toUser(cred.user);
  } catch (e) {
    throw new AuthError(e);
  }
}

export async function signInWithGoogle() {
  try {
    const cred = await signInWithPopup(auth, googleProvider);
    return toUser(cred.user);
  } catch (e) {
    throw new AuthError(e);
  }
}

export async function sendReset(email) {
  try {
    await sendPasswordResetEmail(auth, String(email).trim());
  } catch (e) {
    throw new AuthError(e);
  }
}

export async function signOutUser() {
  try {
    await signOut(auth);
  } catch (e) {
    throw new AuthError(e);
  }
}

export { AuthError };
