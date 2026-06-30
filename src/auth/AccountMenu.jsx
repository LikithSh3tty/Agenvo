import React, { useEffect, useRef, useState } from "react";
import { useAuth } from "./AuthContext.jsx";

// Account chip for the app header: avatar + dropdown with the signed-in email and
// a sign-out action. Uses the app's CSS variables (mounted by <App>) so it themes
// automatically in light/dark.
export default function AccountMenu() {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);

  if (!user) return null;

  const label = user.displayName || user.email || "Account";
  const initial = (user.displayName || user.email || "?").trim().charAt(0).toUpperCase();

  const doSignOut = async () => {
    setBusy(true);
    try { await signOut(); } catch { setBusy(false); }
  };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        style={{
          width: 34, height: 34, borderRadius: 999, cursor: "pointer",
          border: "1px solid var(--card-border)", overflow: "hidden", padding: 0,
          display: "grid", placeItems: "center", background: "var(--surface2)",
          color: "var(--ink)", fontWeight: 700, fontSize: 14,
          fontFamily: "'Space Grotesk',sans-serif",
        }}
      >
        {user.photoURL
          ? <img src={user.photoURL} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} referrerPolicy="no-referrer" />
          : initial}
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: "absolute", right: 0, top: "calc(100% + 8px)", zIndex: 200,
            minWidth: 220, background: "var(--card)", border: "1px solid var(--card-border)",
            borderRadius: 12, boxShadow: "0 18px 44px rgba(var(--ink-rgb),0.16)",
            padding: 6, animation: "slideUp 0.18s ease",
          }}
        >
          <div style={{ padding: "9px 11px 10px", borderBottom: "1px solid var(--card-border)" }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</div>
            {user.email && user.email !== label && (
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{user.email}</div>
            )}
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={doSignOut}
            disabled={busy}
            style={{
              width: "100%", textAlign: "left", marginTop: 4, padding: "9px 11px",
              background: "transparent", border: 0, borderRadius: 8, cursor: busy ? "default" : "pointer",
              color: "var(--ink)", font: "inherit", fontSize: 13.5, fontWeight: 600,
              display: "flex", alignItems: "center", gap: 9,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(var(--ink-rgb),0.06)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <path d="m16 17 5-5-5-5" /><path d="M21 12H9" />
            </svg>
            {busy ? "Signing out…" : "Sign out"}
          </button>
        </div>
      )}
    </div>
  );
}
