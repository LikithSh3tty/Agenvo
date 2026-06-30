import React, { useEffect, useState } from "react";
import { useAuth } from "./AuthContext.jsx";
import AuthScreen from "./AuthScreen.jsx";
import { installUserStorage } from "./userStorage.js";

// Gate the app behind authentication AND behind the user's cloud data being ready.
// While the initial auth state resolves, or while a signed-in user's Firestore data
// hydrates, we render a neutral background (the app's own loader takes over after).
export default function AuthGate({ children }) {
  const { user, loading } = useAuth();
  const [storageReady, setStorageReady] = useState(false);

  useEffect(() => {
    if (!user) { setStorageReady(false); return; }
    let uninstall = null;
    let cancelled = false;
    setStorageReady(false);
    installUserStorage(user.uid).then((fn) => {
      if (cancelled) { fn(); return; } // user changed before hydrate finished
      uninstall = fn;
      setStorageReady(true);
    });
    return () => { cancelled = true; if (uninstall) uninstall(); };
  }, [user?.uid]);

  if (loading) return <div style={{ minHeight: "100vh", background: "var(--bg, #FAFAFA)" }} />;
  if (!user) return <AuthScreen />;
  if (!storageReady) return <div style={{ minHeight: "100vh", background: "var(--bg, #FAFAFA)" }} />;
  return children;
}
