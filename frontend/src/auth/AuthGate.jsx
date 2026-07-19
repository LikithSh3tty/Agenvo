import React, { useEffect, useState } from "react";
import { useAuth } from "./AuthContext.jsx";
import AuthScreen from "./AuthScreen.jsx";
import { installUserStorage } from "./userStorage.js";

// Gate the app behind authentication AND behind the user's cloud data being ready.
// Flow: neutral background while auth resolves → the app shell renders (guests get
// a pristine, non-persistent workspace via guest storage) → if nobody is signed in,
// the login card drops in as an overlay on top of the main page.
// The `key` on the wrapper remounts the app on login/logout so it re-reads storage.
// Branded full-screen loader shown while auth resolves / cloud data hydrates.
// Follows the OS color scheme since the user's saved theme isn't loaded yet.
function Splash() {
  return (
    <div style={{
      minHeight: "100vh", background: "var(--bg, #FAFAFA)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <style>{`
        @keyframes agvSplash { 0%,100% { opacity: 1; } 50% { opacity: 0.45; } }
        @media (prefers-color-scheme: dark) { .agv-splash-bg { background: #0E1011 !important; } }
      `}</style>
      <div className="agv-splash-bg" style={{ position: "fixed", inset: 0, background: "#FAFAFA", zIndex: -1 }} />
      <picture>
        <source media="(prefers-color-scheme: dark)" srcSet="/brand/mark-white.png" />
        <img src="/brand/mark-black.png" alt="Agenvo" width="72"
          style={{ animation: "agvSplash 1.6s ease-in-out infinite" }} />
      </picture>
    </div>
  );
}

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

  if (loading) return <Splash />;
  if (!user) {
    return (
      <>
        <div key="guest">{children}</div>
        <AuthScreen />
      </>
    );
  }
  if (!storageReady) return <Splash />;
  return <div key={user.uid}>{children}</div>;
}
