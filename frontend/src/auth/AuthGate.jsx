import React, { useEffect, useState } from "react";
import { useAuth } from "./AuthContext.jsx";
import AuthScreen from "./AuthScreen.jsx";
import { installUserStorage } from "./userStorage.js";

// Gate the app behind authentication AND behind the user's cloud data being ready.
// Flow: neutral background while auth resolves → the app shell renders (guests get
// a pristine, non-persistent workspace via guest storage) → if nobody is signed in,
// the login card drops in as an overlay on top of the main page.
// The `key` on the wrapper remounts the app on login/logout so it re-reads storage.
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
  if (!user) {
    return (
      <>
        <div key="guest">{children}</div>
        <AuthScreen />
      </>
    );
  }
  if (!storageReady) return <div style={{ minHeight: "100vh", background: "var(--bg, #FAFAFA)" }} />;
  return <div key={user.uid}>{children}</div>;
}
