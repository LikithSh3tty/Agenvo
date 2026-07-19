import React, { useState } from "react";
import { fmt, fmtIn, numClean } from "./currency.js";
import { useCountUp } from "./hooks.js";
import { C } from "./theme.js";

// Controlled numeric input that never shows a stale leading zero. React skips
// syncing a focused type="number" input when Number(domValue) equals the state
// value, so "05" would stay on screen; this keeps a sanitized string draft while
// focused instead, and reports the sanitized string via onChange (parents that
// store numbers call Number() on it).
export function NumInput({ value, onChange, integer = false, ...rest }) {
  const [draft, setDraft] = useState(null);
  return (
    <input {...rest} type="text" inputMode="decimal"
      value={draft !== null ? draft : (value ?? "")}
      onFocus={(e) => { setDraft(numClean(e.target.value, { integer })); rest.onFocus && rest.onFocus(e); }}
      onBlur={(e) => { setDraft(null); rest.onBlur && rest.onBlur(e); }}
      onChange={(e) => { const v = numClean(e.target.value, { integer }); setDraft(v); onChange(v); }} />
  );
}

// ── Currency catalog ────────────────────────────────────────────────

/* ═══ UI COMPONENTS ═══ */

export function Modal({ open, onClose, title, children }) {
  if (!open) return null;
  return (
    <div className="no-print-modal-overlay" onClick={onClose} style={{
      position: "fixed", inset: 0, background: "var(--scrim)", backdropFilter: "blur(3px)", WebkitBackdropFilter: "blur(3px)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: "var(--surface)", border: "1px solid " + C.cardBorder, borderRadius: 20,
        padding: "28px 32px", width: "92%", maxWidth: 440,
        boxShadow: "0 40px 80px rgba(0,0,0,0.5)", maxHeight: "85vh", overflowY: "auto",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 19, fontWeight: 600 }}>{title}</h3>
          <button onClick={onClose} aria-label="Close dialog" style={{
            background: "rgba(var(--ink-rgb),0.05)", border: "none", color: C.textMuted,
            width: 30, height: 30, borderRadius: 8, cursor: "pointer", fontSize: 14,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}><Icon name="x" size={14} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export const inpStyle = {
  width: "100%", boxSizing: "border-box", padding: "11px 14px",
  background: "var(--field-bg)", border: "1px solid var(--field-border)",
  borderRadius: 8, color: "var(--ink)", fontSize: 14, outline: "none",
  fontFamily: "'Space Grotesk',sans-serif", transition: "border-color 0.2s",
};

export function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{
        display: "block", fontSize: 12.5, color: C.textDim, marginBottom: 5, fontWeight: 600,
      }}>{label}</label>
      {children}
    </div>
  );
}

export function Btn({ children, onClick, disabled, variant, style: s }) {
  const isPrimary = variant !== "secondary";
  const base = isPrimary
    ? {
      background: disabled ? "rgba(var(--pop-rgb),0.35)" : "var(--pop)",
      color: "var(--pop-fg)",
      border: "2px solid var(--ink)",
      boxShadow: disabled ? "none" : "3px 3px 0 var(--ink)",
    }
    : {
      background: "var(--surface)",
      border: "2px solid rgba(var(--ink-rgb),0.25)",
      color: "var(--text-dim)",
      boxShadow: "3px 3px 0 rgba(var(--ink-rgb),0.15)",
    };
  return (
    <button onClick={onClick} disabled={disabled} className={isPrimary ? "btnp" : "btns"} style={{
      padding: "10px 22px", borderRadius: 2, fontSize: 14, fontWeight: 700,
      cursor: disabled ? "not-allowed" : "pointer", fontFamily: "'Space Grotesk',sans-serif",
      transition: "transform 0.08s ease, box-shadow 0.08s ease, background 0.2s ease",
      opacity: disabled ? 0.5 : 1, ...base, ...s,
    }}>{children}</button>
  );
}

// Monochrome line-icon set (Lucide-style). Inherits color via currentColor — no emoji in-product.
const ICON_PATHS = {
  "trending-up": <><polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" /></>,
  "trending-down": <><polyline points="22 17 13.5 8.5 8.5 13.5 2 7" /><polyline points="16 17 22 17 22 11" /></>,
  award: <><circle cx="12" cy="8" r="6" /><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11" /></>,
  star: <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26" />,
  flame: <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />,
  "file-text": <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></>,
  alert: <><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></>,
  pie: <><path d="M21.21 15.89A10 10 0 1 1 8 2.83" /><path d="M22 12A10 10 0 0 0 12 2v10z" /></>,
  briefcase: <><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /></>,
  tag: <><path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" /><circle cx="7.5" cy="7.5" r=".5" fill="currentColor" /></>,
  inbox: <><polyline points="22 12 16 12 14 15 10 15 8 12 2 12" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></>,
  x: <><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>,
  menu: <><line x1="4" y1="6" x2="20" y2="6" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="18" x2="20" y2="18" /></>,
  edit: <><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" /></>,
  download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></>,
  upload: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></>,
  printer: <><polyline points="6 9 6 2 18 2 18 9" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="8" /></>,
  share: <><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" /></>,
  sparkles: <path d="M9.94 14.06A2 2 0 0 0 8.5 12.6l-5.1-1.32a.5.5 0 0 1 0-.96L8.5 9a2 2 0 0 0 1.44-1.44l1.32-5.1a.5.5 0 0 1 .96 0l1.32 5.1A2 2 0 0 0 15 9l5.1 1.32a.5.5 0 0 1 0 .96L15 12.6a2 2 0 0 0-1.44 1.46l-1.32 5.1a.5.5 0 0 1-.96 0z" />,
  users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>,
  clock: <><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></>,
  check: <polyline points="20 6 9 17 4 12" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2" /><path d="M12 20v2" /><path d="m4.93 4.93 1.41 1.41" /><path d="m17.66 17.66 1.41 1.41" /><path d="M2 12h2" /><path d="M20 12h2" /><path d="m6.34 17.66-1.41 1.41" /><path d="m19.07 4.93-1.41 1.41" /></>,
  moon: <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />,
  "chevron-left": <polyline points="15 18 9 12 15 6" />,
};
export function Icon({ name, size = 18, stroke = 1.7, style }) {
  const path = ICON_PATHS[name];
  if (!path) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      style={{ flex: "none", display: "inline-block", verticalAlign: "middle", ...style }}>
      {path}
    </svg>
  );
}

// Light/dark switch — a pill toggle with a sliding thumb carrying the active icon.
export function ThemeToggle({ dark, onToggle }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      role="switch"
      aria-checked={dark}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Light mode" : "Dark mode"}
      className="lift"
      style={{
        position: "relative", width: 60, height: 32, flex: "none", padding: 0,
        borderRadius: 999, cursor: "pointer",
        border: "1px solid var(--card-border)", background: "var(--surface2)",
        transition: "background .3s ease, border-color .3s ease",
      }}
    >
      <span style={{
        position: "absolute", top: "50%", left: 9, transform: "translateY(-50%)",
        color: "var(--text-muted)", opacity: dark ? 0.55 : 0, transition: "opacity .3s ease",
      }}>
        <Icon name="sun" size={13} />
      </span>
      <span style={{
        position: "absolute", top: "50%", right: 9, transform: "translateY(-50%)",
        color: "var(--text-muted)", opacity: dark ? 0 : 0.55, transition: "opacity .3s ease",
      }}>
        <Icon name="moon" size={13} />
      </span>
      <span style={{
        position: "absolute", top: 3, left: dark ? 31 : 3, width: 24, height: 24, borderRadius: "50%",
        background: "var(--accent)", color: "var(--accent-fg)", display: "grid", placeItems: "center",
        boxShadow: "0 2px 8px rgba(0,0,0,0.28)",
        transition: "left .28s cubic-bezier(.2,.8,.2,1), background .3s ease, color .3s ease",
      }}>
        <Icon name={dark ? "moon" : "sun"} size={13} />
      </span>
    </button>
  );
}

export function StatCard({ label, amount, delta = null, pop = false, currency = null }) {
  const animated = useCountUp(typeof amount === "number" ? amount : 0);
  const cfmt = (v) => (currency ? fmtIn(v, currency) : fmt(v));
  const up = typeof delta === "number" && delta >= 0;
  return (
    <div style={{
      background: C.card, border: "1px solid " + C.cardBorder, borderRadius: 12,
      padding: "20px 24px", flex: "1 1 180px", minWidth: 155,
    }}>
      <div style={{
        fontSize: 11, color: C.textDim, letterSpacing: 1, textTransform: "uppercase",
        marginBottom: 8, fontFamily: "'JetBrains Mono',monospace",
      }}>{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <div style={{
          fontSize: 27, fontWeight: 700, letterSpacing: -0.5, fontFamily: "'Space Grotesk',sans-serif",
          fontVariantNumeric: "tabular-nums", color: pop ? "var(--pop)" : "var(--ink)",
        }}>{cfmt(animated)}</div>
        {typeof delta === "number" && (
          <span className="delta-pill" style={{
            background: up ? "rgba(22,163,74,0.12)" : "rgba(255,107,107,0.12)",
            color: up ? "#16A34A" : "#ff6b6b",
          }} title="vs. last month">
            <Icon name={up ? "trending-up" : "trending-down"} size={11} /> {Math.abs(delta)}%
          </span>
        )}
      </div>
    </div>
  );
}

// Brutalist checkbox: organic blob shape, hard offset shadow, splash tick. Themed to --pop.
// Renders as a <span> (not <label>) so it can be safely nested inside an outer <label>.
export function BrutalCheck({ checked, onChange, size = 17, ariaLabel }) {
  return (
    <span className="brutal-check" style={{ fontSize: size }}>
      <input type="checkbox" checked={checked} onChange={onChange} aria-label={ariaLabel} />
      <span className="bmk" />
    </span>
  );
}


function Badge({ children }) {
  return (
    <span style={{
      display: "inline-block", padding: "3px 9px", borderRadius: 6,
      background: C.accentDim, color: C.accent, fontSize: 11, fontWeight: 600,
      fontFamily: "'JetBrains Mono',monospace",
    }}>{children}</span>
  );
}

export function EmptyState({ icon, text, sub, action }) {
  return (
    <div style={{
      textAlign: "center", padding: "48px 24px", color: C.textMuted,
      border: "1px dashed " + C.cardBorder, borderRadius: 12,
    }}>
      {icon && (
        <div style={{
          width: 52, height: 52, borderRadius: 14, margin: "0 auto 14px", display: "grid", placeItems: "center",
          background: "rgba(var(--ink-rgb),0.04)", border: "1px solid " + C.cardBorder, color: C.textDim,
        }}>
          <Icon name={icon} size={24} stroke={1.6} />
        </div>
      )}
      <div style={{ fontSize: 15, marginBottom: 6, color: C.textDim }}>{text}</div>
      {sub && <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 14 }}>{sub}</div>}
      {action}
    </div>
  );
}

export const CLIENT_COLORS = [
  "#65A30D", "#2563EB", "#16A34A", "#7C3AED", "#0891B2",
  "#DB2777", "#CA8A04", "#475569", "#DC2626", "#0D9488",
];

// A client's avatar color: explicit choice if set, else a stable color derived from its name.
export const clientColor = (cl) => {
  if (!cl) return CLIENT_COLORS[0];
  if (cl.color) return cl.color;
  const n = cl.name || "A";
  let h = 0;
  for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0;
  return CLIENT_COLORS[h % CLIENT_COLORS.length];
};

export function Avatar({ name, size, color }) {
  const s = size || 36;
  const l = 22 + (((name || "A").charCodeAt(0) * 7) % 12);
  const bg = color || "hsl(0,0%," + l + "%)";
  return (
    <div style={{
      width: s, height: s, borderRadius: s * 0.32, flexShrink: 0,
      background: bg,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: s * 0.4, fontWeight: 700, color: "#fff", letterSpacing: 0.3,
    }}>{(name || "?")[0].toUpperCase()}</div>
  );
}

