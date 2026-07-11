import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";

const AMBER = "#D97706";

// "Reset workspace data" block for the Settings panel: clears all clients, records,
// invoices and other rows for the current account (keeping the login and business
// settings), with a type-RESET-to-confirm gate. `onReset` performs the actual wipe
// through the app's persist() so the change is saved to the cloud.
export default function ResetDataSection({ onReset }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (!open) { setConfirm(""); setBusy(false); } }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape" && !busy) setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, busy]);

  const canReset = confirm.trim().toUpperCase() === "RESET" && !busy;

  const doReset = () => {
    if (!canReset) return;
    setBusy(true);
    try { onReset?.(); } finally { /* panel closes via onReset */ }
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
      <div role="dialog" aria-modal="true" aria-label="Reset workspace data" style={{
        width: "100%", maxWidth: 420, background: "var(--card-bg)", color: "var(--ink)",
        border: "1px solid var(--card-border)", borderRadius: 16, padding: "22px 22px 20px",
        boxShadow: "0 24px 60px rgba(0,0,0,0.4)", animation: "slideUp 0.2s ease",
        fontFamily: "'Plus Jakarta Sans', sans-serif",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <span style={{ width: 34, height: 34, borderRadius: 9, display: "grid", placeItems: "center", background: "rgba(217,119,6,0.14)", color: AMBER, flexShrink: 0 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" />
            </svg>
          </span>
          <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: -0.2 }}>Reset workspace data</div>
        </div>

        <p style={{ fontSize: 13.5, lineHeight: 1.55, color: "var(--text-muted)", margin: "0 0 16px" }}>
          This clears <strong style={{ color: "var(--ink)" }}>all clients, records, invoices and other entries</strong> for this account. Your login and business settings are kept. This can't be undone.
        </p>

        <label style={{ display: "block", marginBottom: 14 }}>
          <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6 }}>
            Type <strong style={{ color: "var(--ink)" }}>RESET</strong> to confirm
          </span>
          <input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="RESET"
            autoCapitalize="characters" spellCheck={false} style={inputStyle} />
        </label>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button type="button" onClick={() => !busy && setOpen(false)} disabled={busy} style={btnSecondary}>Cancel</button>
          <button type="button" onClick={doReset} disabled={!canReset} style={{ ...btnAmber, opacity: canReset ? 1 : 0.5, cursor: canReset ? "pointer" : "not-allowed" }}>
            {busy ? "Resetting…" : "Reset data"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  ) : null;

  return (
    <div style={{
      marginTop: 20, border: "1px solid rgba(217,119,6,0.30)", borderRadius: 14,
      background: "rgba(217,119,6,0.05)", padding: "16px 18px",
    }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: AMBER, letterSpacing: 0.3, textTransform: "uppercase", marginBottom: 6 }}>Reset data</div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
        <div style={{ fontSize: 13, color: "var(--text-muted)", maxWidth: 380, lineHeight: 1.5 }}>
          Clear all clients, records and invoices for this account, keeping your login and settings.
        </div>
        <button type="button" onClick={() => setOpen(true)} style={btnAmber}>Reset workspace data</button>
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
const btnAmber = {
  height: 40, padding: "0 16px", borderRadius: 10, border: "1px solid transparent",
  background: AMBER, color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "inherit",
};
