import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "./AuthContext.jsx";

const RED = "#EF4444";

// "Danger zone" block for the Settings panel: permanently delete the account and all
// workspace data, with an explicit type-to-confirm gate (and a password for email
// users; Google users re-confirm via popup). On success the auth listener signs the
// user out and the app returns to the login screen automatically.
export default function DeleteAccountSection() {
  const { user, deleteAccount, getProviderId } = useAuth();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const providerId = open ? getProviderId() : null;
  const isPassword = providerId === "password";

  useEffect(() => {
    if (!open) { setConfirm(""); setPassword(""); setErr(""); setBusy(false); }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape" && !busy) setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, busy]);

  if (!user) return null;

  const canDelete = confirm.trim().toUpperCase() === "DELETE" && (!isPassword || password.length > 0) && !busy;

  const doDelete = async () => {
    if (!canDelete) return;
    setErr(""); setBusy(true);
    try {
      await deleteAccount(isPassword ? { password } : {});
      // Success: onAuthChange fires → AuthGate swaps to the login screen.
    } catch (ex) {
      setErr(ex?.message || "Couldn't delete the account. Try again.");
      setBusy(false);
    }
  };

  const modal = open ? createPortal(
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) setOpen(false); }}
      style={{
        position: "fixed", inset: 0, zIndex: 5000, background: "var(--scrim, rgba(0,0,0,0.55))",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
        backdropFilter: "blur(2px)", animation: "fadeIn 0.18s ease",
      }}
    >
      <div role="dialog" aria-modal="true" aria-label="Delete account" style={{
        width: "100%", maxWidth: 420, background: "var(--card-bg)", color: "var(--ink)",
        border: "1px solid var(--card-border)", borderRadius: 16, padding: "22px 22px 20px",
        boxShadow: "0 24px 60px rgba(0,0,0,0.4)", animation: "slideUp 0.2s ease",
        fontFamily: "'Plus Jakarta Sans', sans-serif",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <span style={{ width: 34, height: 34, borderRadius: 9, display: "grid", placeItems: "center", background: "rgba(239,68,68,0.12)", color: RED, flexShrink: 0 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
            </svg>
          </span>
          <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: -0.2 }}>Delete account</div>
        </div>

        <p style={{ fontSize: 13.5, lineHeight: 1.55, color: "var(--text-muted)", margin: "0 0 16px" }}>
          This permanently deletes your account and <strong style={{ color: "var(--ink)" }}>all workspace data</strong> — clients, records, invoices and settings. This cannot be undone.
        </p>

        {isPassword && (
          <label style={{ display: "block", marginBottom: 12 }}>
            <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6 }}>Confirm your password</span>
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="Your password" style={inputStyle} />
          </label>
        )}
        {!isPassword && (
          <p style={{ fontSize: 12.5, color: "var(--text-muted)", margin: "0 0 12px" }}>
            You'll be asked to re-confirm with Google before deletion.
          </p>
        )}

        <label style={{ display: "block", marginBottom: 14 }}>
          <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6 }}>
            Type <strong style={{ color: "var(--ink)" }}>DELETE</strong> to confirm
          </span>
          <input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="DELETE"
            autoCapitalize="characters" spellCheck={false} style={inputStyle} />
        </label>

        {err && (
          <div role="alert" style={{ fontSize: 13, color: RED, background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.26)", borderRadius: 10, padding: "9px 11px", marginBottom: 14 }}>
            {err}
          </div>
        )}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button type="button" onClick={() => !busy && setOpen(false)} disabled={busy} style={btnSecondary}>Cancel</button>
          <button type="button" onClick={doDelete} disabled={!canDelete} style={{ ...btnDanger, opacity: canDelete ? 1 : 0.5, cursor: canDelete ? "pointer" : "not-allowed" }}>
            {busy ? "Deleting…" : "Delete account"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  ) : null;

  return (
    <div style={{
      marginTop: 28, border: "1px solid rgba(239,68,68,0.30)", borderRadius: 14,
      background: "rgba(239,68,68,0.04)", padding: "16px 18px",
    }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: RED, letterSpacing: 0.3, textTransform: "uppercase", marginBottom: 6 }}>Danger zone</div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
        <div style={{ fontSize: 13, color: "var(--text-muted)", maxWidth: 380, lineHeight: 1.5 }}>
          Permanently delete your account and all workspace data. This can't be undone.
        </div>
        <button type="button" onClick={() => setOpen(true)} style={btnDanger}>Delete account</button>
      </div>
      {modal}
    </div>
  );
}

const inputStyle = {
  width: "100%", height: 42, borderRadius: 10, border: "1px solid var(--field-border)",
  background: "var(--field-bg)", color: "var(--ink)", fontSize: 14.5, padding: "0 12px",
  outline: "none", fontFamily: "inherit",
};
const btnSecondary = {
  height: 40, padding: "0 16px", borderRadius: 10, border: "1px solid var(--card-border)",
  background: "transparent", color: "var(--ink)", fontWeight: 600, fontSize: 14, cursor: "pointer", fontFamily: "inherit",
};
const btnDanger = {
  height: 40, padding: "0 16px", borderRadius: 10, border: "1px solid transparent",
  background: RED, color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "inherit",
};
