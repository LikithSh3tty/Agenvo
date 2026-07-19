import React, { useState, useEffect } from "react";
import { useConfig } from "./config.js";
import { Icon } from "./ui.jsx";

// Slide-in navigation drawer for mobile. Rendered only while open; closes on
// item tap, backdrop tap, Escape, or the X button. Locks body scroll while open.
function NavDrawer({ onClose, tabs, active, onChange, onSettings }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);
  return (
    <div className="no-print" style={{ position: "fixed", inset: 0, zIndex: 1500 }}>
      <div onClick={onClose} style={{
        position: "absolute", inset: 0, background: "rgba(0,0,0,0.45)",
        backdropFilter: "blur(2px)", animation: "fadeIn 0.25s ease",
      }} />
      <nav role="dialog" aria-label="Navigation menu" style={{
        position: "absolute", top: 0, right: 0, bottom: 0, width: "78%", maxWidth: 320,
        background: "var(--bg)", borderLeft: "1px solid var(--card-border)",
        boxShadow: "-18px 0 50px rgba(0,0,0,0.25)", display: "flex", flexDirection: "column",
        padding: "18px 16px", animation: "drawerIn 0.28s cubic-bezier(0.32,0.72,0.35,1)",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: -0.2, fontFamily: "'Space Grotesk',sans-serif" }}>Menu</div>
          <button onClick={onClose} aria-label="Close menu" style={{
            background: "rgba(var(--ink-rgb),0.05)", border: "none", color: "var(--text-dim)",
            width: 32, height: 32, borderRadius: 8, cursor: "pointer", display: "grid", placeItems: "center",
          }}><Icon name="x" size={14} /></button>
        </div>
        {tabs.map((t) => (
          <button key={t.key} onClick={() => { onChange(t.key); onClose(); }} style={{
            display: "block", textAlign: "left",
            background: active === t.key ? "var(--pop-dim)" : "transparent",
            border: "1px solid " + (active === t.key ? "var(--pop-border)" : "transparent"),
            padding: "13px 14px", borderRadius: 8, color: active === t.key ? "var(--pop)" : "var(--text-dim)",
            cursor: "pointer", fontSize: 15, fontWeight: 600, marginBottom: 4, transition: "all 0.2s",
          }}>{t.label}</button>
        ))}
        <div style={{ marginTop: "auto", borderTop: "1px solid var(--card-border)", paddingTop: 10 }}>
          <button onClick={() => { onSettings(); onClose(); }} style={{
            display: "flex", alignItems: "center", gap: 8, width: "100%",
            background: "transparent", border: "1px solid transparent", padding: "13px 14px",
            borderRadius: 8, color: "var(--text-dim)", cursor: "pointer", fontSize: 15, fontWeight: 600,
          }}><Icon name="settings" size={15} />Settings</button>
        </div>
      </nav>
    </div>
  );
}

// Line icons for the sidebar, keyed by tab key across both agency modes.
const NAV_ICONS = {
  "Dashboard": "pie", "Add Sales": "edit", "Add Entry": "edit", "Clients": "users",
  "Brands": "briefcase", "Categories": "tag", "Invoices": "printer", "History": "clock",
};

// Shared nav for both agency modes. Wide desktop (≥900px): fixed "ledger index"
// sidebar where the active section is a thumb-tab poking through the right rule.
// Mid: horizontal tab row. Mobile (≤640px): compact bar with hamburger + NavDrawer.
export function TabBar({ tabs: tabsProp, active, onChange, onSettings }) {
  const { terms } = useConfig();
  const [menuOpen, setMenuOpen] = useState(false);
  // Desktop sidebar collapse — icon-only rail, remembered across sessions.
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem("agenvo-snav") === "collapsed"; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem("agenvo-snav", collapsed ? "collapsed" : "open"); } catch { /* ignore */ }
    // The content column reads this var to clear the rail (see .app-main CSS).
    document.documentElement.style.setProperty("--snav-w", collapsed ? "94px" : "250px");
  }, [collapsed]);
  // Label that slides + fades as the rail expands/collapses (keeps it in the DOM
  // so the transition is smooth instead of popping).
  const navLabel = (text) => (
    <span style={{
      whiteSpace: "nowrap", overflow: "hidden",
      maxWidth: collapsed ? 0 : 180, opacity: collapsed ? 0 : 1,
      transition: "max-width .22s cubic-bezier(.4,0,.2,1), opacity .18s ease",
    }}>{text}</span>
  );
  const tabs = tabsProp || [
    { key: "Dashboard", label: "Dashboard" },
    { key: "Add Sales", label: "Add " + terms.revenue.one },
    { key: "Clients", label: terms.client.many },
    { key: "Invoices", label: "Invoices" },
    { key: "History", label: "History" },
  ];
  const activeLabel = (tabs.find((t) => t.key === active) || tabs[0]).label;
  return (
    <>
      <div className="no-print side-nav glass" style={{
        position: "fixed", top: 14, left: 14, width: collapsed ? 64 : 220, height: 48, zIndex: 120,
        alignItems: "center", justifyContent: "flex-start", gap: 10,
        padding: collapsed ? 0 : "0 12px",
        background: "var(--header-bg)", border: "1px solid var(--card-border)",
        borderRadius: 14,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.10), 0 12px 30px rgba(0,0,0,0.14)",
      }}>
        <button onClick={() => setCollapsed((c) => !c)} className="snav-burger"
          aria-label={collapsed ? "Expand menu" : "Collapse menu"} aria-expanded={!collapsed}
          title={collapsed ? "Expand menu" : "Collapse menu"} style={{
            flex: "none", width: collapsed ? 64 : 34, height: collapsed ? 46 : 34, display: "grid", placeItems: "center",
            background: "transparent", border: "none", borderRadius: 9, color: "var(--text-dim)", cursor: "pointer",
          }}><Icon name="menu" size={18} /></button>
        <div style={{
          fontSize: 17, fontWeight: 700, letterSpacing: -0.4, color: "var(--ink)",
          fontFamily: "'Space Grotesk',sans-serif",
          whiteSpace: "nowrap", overflow: "hidden",
          maxWidth: collapsed ? 0 : 160, opacity: collapsed ? 0 : 1,
          transition: "max-width .22s cubic-bezier(.4,0,.2,1), opacity .18s ease",
        }}>agenvo</div>
        <span aria-hidden="true" style={{
          width: 9, height: 9, flex: "none", background: "var(--pop)", borderRadius: 3,
          marginLeft: "auto", opacity: collapsed ? 0 : 1, transition: "opacity .18s ease",
        }} />
      </div>
      <nav className="no-print side-nav glass" aria-label="Primary" style={{
        position: "fixed", top: 74, left: 14, bottom: 14, width: collapsed ? 64 : 220, zIndex: 50,
        flexDirection: "column", gap: 4, padding: 12,
        background: "var(--header-bg)", border: "1px solid var(--card-border)",
        borderRadius: 14, overflow: "hidden",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.10), 0 18px 44px rgba(0,0,0,0.16)",
      }}>
        <div aria-hidden="true" style={{
          position: "absolute", top: -70, right: -70, width: 190, height: 190,
          borderRadius: "50%", background: "rgba(var(--pop-rgb),0.18)", filter: "blur(46px)",
        }} />
        <div aria-hidden="true" style={{
          position: "absolute", bottom: -80, left: -60, width: 170, height: 170,
          borderRadius: "50%", background: "rgba(var(--accent-rgb),0.07)", filter: "blur(40px)",
        }} />
        {tabs.map((t) => {
          const on = active === t.key;
          return (
            <button key={t.key} onClick={() => onChange(t.key)} aria-current={on ? "page" : undefined}
              className={"snav-item" + (on ? " snav-active" : "")} title={collapsed ? t.label : undefined}
              style={{
                display: "flex", alignItems: "center", gap: collapsed ? 0 : 10, textAlign: "left",
                position: "relative", justifyContent: collapsed ? "center" : "flex-start",
                background: on ? "var(--accent)" : "transparent",
                border: "none", borderRadius: 9, padding: collapsed ? "11px 0" : "11px 12px",
                color: on ? "var(--accent-fg)" : "var(--text-dim)",
                cursor: on ? "default" : "pointer", fontSize: 14, fontWeight: on ? 700 : 600,
                boxShadow: on ? "0 6px 16px rgba(0,0,0,0.18)" : "none",
              }}>
              <Icon name={NAV_ICONS[t.key] || "tag"} size={15} />{navLabel(t.label)}
            </button>
          );
        })}
        <div style={{ marginTop: "auto" }}>
          <button onClick={onSettings} className="snav-item" title={collapsed ? "Settings" : undefined} style={{
            display: "flex", alignItems: "center", gap: collapsed ? 0 : 10, width: "100%", position: "relative",
            justifyContent: collapsed ? "center" : "flex-start",
            background: "transparent", border: "none", borderRadius: 9,
            padding: collapsed ? "11px 0" : "11px 12px", color: "var(--text-dim)", cursor: "pointer", fontSize: 14, fontWeight: 600,
          }}><Icon name="settings" size={15} />{navLabel("Settings")}</button>
        </div>
      </nav>
      <div className="no-print desktop-nav" style={{
        display: "flex", gap: 10, marginBottom: 28, borderBottom: "1px solid var(--card-border)",
        paddingBottom: 12, overflowX: "auto", alignItems: "center",
      }}>
        {tabs.map((t) => (
          <button key={t.key} onClick={() => onChange(t.key)} style={{
            background: active === t.key ? "var(--pop-dim)" : "transparent",
            border: "1px solid " + (active === t.key ? "var(--pop-border)" : "transparent"),
            padding: "8px 16px", borderRadius: 8, color: active === t.key ? "var(--pop)" : "var(--text-dim)",
            cursor: "pointer", fontSize: 14, fontWeight: 600, transition: "all 0.2s",
            whiteSpace: "nowrap",
          }}>{t.label}</button>
        ))}
        <button onClick={onSettings} title="Settings" aria-label="Settings" style={{
          marginLeft: "auto", background: "transparent", border: "1px solid transparent",
          padding: "8px 16px", borderRadius: 8, color: "var(--text-dim)",
          cursor: "pointer", fontSize: 14, fontWeight: 600, transition: "all 0.2s",
          whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 6,
        }}>
          <Icon name="settings" size={15} /><span className="mobile-hide">Settings</span>
        </button>
      </div>
      <div className="no-print mobile-nav" style={{
        marginBottom: 24, borderBottom: "1px solid var(--card-border)", paddingBottom: 12,
        alignItems: "center", justifyContent: "space-between", gap: 10,
      }}>
        <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: -0.3 }}>{activeLabel}</div>
        <button onClick={() => setMenuOpen(true)} aria-label="Open menu" aria-expanded={menuOpen} style={{
          background: "rgba(var(--ink-rgb),0.04)", border: "1px solid rgba(var(--ink-rgb),0.08)",
          width: 38, height: 38, borderRadius: 8, color: "var(--text-dim)", cursor: "pointer",
          display: "grid", placeItems: "center",
        }}><Icon name="menu" size={17} /></button>
      </div>
      {menuOpen && (
        <NavDrawer onClose={() => setMenuOpen(false)} tabs={tabs} active={active}
          onChange={onChange} onSettings={onSettings} />
      )}
    </>
  );
}

