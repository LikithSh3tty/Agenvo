import React, { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "./AuthContext.jsx";

// Theme tokens mirrored from the main app (agency-tracker.jsx THEME / DARK) so the
// auth screen looks identical before the app's own CSS-variable block mounts.
const LIGHT = {
  bg: "#FAFAFA", card: "#FFFFFF", ink: "#15171a", inkRgb: "17, 24, 28",
  accent: "#111111", accentFg: "#FFFFFF", fieldBg: "rgba(17,24,28,0.03)",
  fieldBorder: "rgba(17,24,28,0.10)", cardBorder: "rgba(17,24,28,0.09)",
  textMuted: "rgba(17,24,28,0.62)", surface2: "#F1F3F4",
  danger: "#B42318", dangerBg: "rgba(180,35,24,0.07)", dangerBorder: "rgba(180,35,24,0.22)",
};
const DARK = {
  bg: "#0E1011", card: "#17191B", ink: "#ECEDEE", inkRgb: "236, 237, 238",
  accent: "#ECEDEE", accentFg: "#15171a", fieldBg: "rgba(255,255,255,0.04)",
  fieldBorder: "rgba(255,255,255,0.13)", cardBorder: "rgba(255,255,255,0.10)",
  textMuted: "rgba(236,237,238,0.58)", surface2: "#26292C",
  danger: "#F97066", dangerBg: "rgba(249,112,102,0.08)", dangerBorder: "rgba(249,112,102,0.26)",
};

const THEME_KEY = "agencyx-theme"; // shared with the app

function useTheme() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    let saved = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch { /* ignore */ }
    if (saved === "dark") return setDark(true);
    if (saved === "light") return setDark(false);
    if (typeof matchMedia !== "undefined") setDark(matchMedia("(prefers-color-scheme: dark)").matches);
  }, []);
  return dark ? DARK : LIGHT;
}

const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e).trim());

// ── Line icons (no emoji, stroke-based to match the app) ─────────────────────
const Eye = ({ off }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    {off ? (
      <>
        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19M6.61 6.61A18.45 18.45 0 0 0 2 12s3 8 10 8a9.12 9.12 0 0 0 5.39-1.61" />
        <path d="M14.12 14.12A3 3 0 1 1 9.88 9.88M1 1l22 22" />
      </>
    ) : (
      <>
        <path d="M2 12s3-8 10-8 10 8 10 8-3 8-10 8-10-8-10-8Z" />
        <circle cx="12" cy="12" r="3" />
      </>
    )}
  </svg>
);

const GoogleMark = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z" />
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65Z" />
    <path fill="#FBBC05" d="M10.53 28.59A14.5 14.5 0 0 1 9.77 24c0-1.6.27-3.15.76-4.59l-7.98-6.19A23.94 23.94 0 0 0 0 24c0 3.88.93 7.55 2.56 10.78l7.97-6.19Z" />
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.9-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.17 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z" />
  </svg>
);

export default function AuthScreen() {
  const T = useTheme();
  const { signIn, signUp, signInWithGoogle, sendReset } = useAuth();

  const [mode, setMode] = useState("login"); // "login" | "signup"
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const emailRef = useRef(null);

  const isSignup = mode === "signup";

  const switchMode = (next) => {
    if (next === mode) return;
    setMode(next);
    setErr("");
    setNotice("");
  };

  const onGoogle = async () => {
    setErr(""); setNotice(""); setGoogleBusy(true);
    try {
      await signInWithGoogle();
      // On success the auth listener swaps this screen for the app.
    } catch (ex) {
      setErr(ex?.message || "Google sign-in failed. Try again.");
      setGoogleBusy(false);
    }
  };

  const onForgot = async () => {
    setErr(""); setNotice("");
    if (!emailOk(email)) { setErr("Enter your email above, then tap “Forgot password”."); return; }
    try {
      await sendReset(email);
      setNotice("Password reset link sent — check your inbox.");
    } catch (ex) {
      setErr(ex?.message || "Couldn't send reset email. Try again.");
    }
  };

  const validate = () => {
    if (isSignup && !name.trim()) return "Enter your name.";
    if (!emailOk(email)) return "Enter a valid email address.";
    if (password.length < 6) return "Password must be at least 6 characters.";
    return "";
  };

  const submit = async (e) => {
    e.preventDefault();
    const v = validate();
    if (v) { setErr(v); return; }
    setErr("");
    setNotice("");
    setBusy(true);
    try {
      if (isSignup) await signUp({ name, email, password });
      else await signIn({ email, password });
      // On success the auth listener swaps this screen for the app.
    } catch (ex) {
      setErr(ex?.message || "Something went wrong. Try again.");
      setBusy(false);
    }
  };

  const css = useMemo(() => `
    @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Space+Grotesk:wght@400;500;600;700&display=swap');
    .ax-auth { --ink:${T.ink}; --ink-rgb:${T.inkRgb}; --bg:${T.bg}; --card:${T.card};
      --accent:${T.accent}; --accent-fg:${T.accentFg}; --field-bg:${T.fieldBg};
      --field-border:${T.fieldBorder}; --card-border:${T.cardBorder}; --muted:${T.textMuted};
      --surface2:${T.surface2}; --danger:${T.danger}; --danger-bg:${T.dangerBg}; --danger-border:${T.dangerBorder};
      min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px;
      background:var(--bg);
      background-image:
        radial-gradient(900px 520px at 12% -12%, rgba(var(--ink-rgb),0.05), transparent 60%),
        radial-gradient(820px 560px at 108% 10%, rgba(var(--ink-rgb),0.04), transparent 55%);
      background-attachment:fixed;
      color:var(--ink); font-family:'Plus Jakarta Sans',system-ui,sans-serif;
      letter-spacing:-0.01em; -webkit-font-smoothing:antialiased; -moz-osx-font-smoothing:grayscale;
    }
    .ax-auth *{ box-sizing:border-box; }
    .ax-brand{ text-align:center; margin-bottom:22px; animation:axRise .55s cubic-bezier(.2,.8,.2,1) both; }
    .ax-logo{ font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:26px; letter-spacing:-0.03em; }
    .ax-tag{ margin-top:6px; font-size:13.5px; color:var(--muted); }
    .ax-card{ width:100%; max-width:380px; background:var(--card); border:1px solid var(--card-border);
      border-radius:18px; padding:26px 24px 24px; box-shadow:0 24px 60px rgba(var(--ink-rgb),0.10), 0 2px 6px rgba(var(--ink-rgb),0.05);
      animation:axRise .6s cubic-bezier(.2,.8,.2,1) both .05s; }
    .ax-seg{ position:relative; display:grid; grid-template-columns:1fr 1fr; background:var(--surface2);
      border-radius:12px; padding:4px; margin-bottom:22px; }
    .ax-seg-pill{ position:absolute; top:4px; bottom:4px; width:calc(50% - 4px); left:4px; border-radius:9px;
      background:var(--card); box-shadow:0 2px 8px rgba(var(--ink-rgb),0.10); transition:transform .32s cubic-bezier(.2,.8,.2,1); }
    .ax-seg-pill.right{ transform:translateX(100%); }
    .ax-seg button{ position:relative; z-index:1; appearance:none; border:0; background:transparent; cursor:pointer;
      padding:9px 0; font:inherit; font-weight:600; font-size:14px; color:var(--muted); transition:color .25s ease; }
    .ax-seg button.active{ color:var(--ink); }
    .ax-field{ margin-bottom:13px; }
    .ax-field label{ display:block; font-size:12.5px; font-weight:600; color:var(--muted); margin-bottom:6px; }
    .ax-inwrap{ position:relative; display:flex; align-items:center; }
    .ax-input{ width:100%; height:44px; border-radius:11px; border:1px solid var(--field-border);
      background:var(--field-bg); color:var(--ink); font:inherit; font-size:14.5px; padding:0 14px;
      outline:none; transition:border-color .18s ease, box-shadow .18s ease, background .18s ease; }
    .ax-input::placeholder{ color:var(--muted); opacity:.85; }
    .ax-input:focus{ border-color:var(--accent); box-shadow:0 0 0 3px rgba(var(--ink-rgb),0.10); background:var(--card); }
    .ax-input.has-eye{ padding-right:44px; }
    .ax-eye{ position:absolute; right:6px; width:34px; height:34px; display:flex; align-items:center; justify-content:center;
      border:0; background:transparent; color:var(--muted); cursor:pointer; border-radius:8px; transition:color .18s, background .18s; }
    .ax-eye:hover{ color:var(--ink); background:rgba(var(--ink-rgb),0.06); }
    .ax-err{ display:flex; gap:8px; align-items:flex-start; font-size:13px; color:var(--danger);
      background:var(--danger-bg); border:1px solid var(--danger-border); border-radius:10px; padding:9px 11px; margin-bottom:14px;
      animation:axRise .3s ease both; }
    .ax-note{ display:flex; gap:8px; align-items:flex-start; font-size:13px; color:var(--ink);
      background:rgba(var(--ink-rgb),0.05); border:1px solid var(--field-border); border-radius:10px; padding:9px 11px; margin-bottom:14px;
      animation:axRise .3s ease both; }
    .ax-forgot{ display:flex; justify-content:flex-end; margin:-4px 0 12px; }
    .ax-forgot button{ background:none; border:0; padding:0; font:inherit; font-size:12.5px; font-weight:600;
      color:var(--muted); cursor:pointer; }
    .ax-forgot button:hover{ color:var(--ink); text-decoration:underline; }
    .ax-submit{ width:100%; height:46px; border:0; border-radius:12px; background:var(--accent); color:var(--accent-fg);
      font:inherit; font-weight:700; font-size:15px; cursor:pointer; margin-top:4px;
      display:flex; align-items:center; justify-content:center; gap:9px;
      transition:transform .15s ease, filter .18s ease, box-shadow .2s ease; box-shadow:0 8px 22px rgba(var(--ink-rgb),0.14); }
    .ax-submit:hover:not(:disabled){ transform:translateY(-1px); filter:brightness(1.06); box-shadow:0 12px 28px rgba(var(--ink-rgb),0.18); }
    .ax-submit:active:not(:disabled){ transform:translateY(0); }
    .ax-submit:disabled{ opacity:.7; cursor:default; }
    .ax-div{ display:flex; align-items:center; gap:12px; margin:18px 0 14px; color:var(--muted); font-size:12px; }
    .ax-div::before,.ax-div::after{ content:""; flex:1; height:1px; background:var(--field-border); }
    .ax-google{ width:100%; height:46px; border:1px solid var(--field-border); border-radius:12px; background:var(--card);
      color:var(--ink); font:inherit; font-weight:600; font-size:14.5px; cursor:pointer;
      display:flex; align-items:center; justify-content:center; gap:10px; transition:background .18s ease, border-color .18s ease; }
    .ax-google:hover{ background:rgba(var(--ink-rgb),0.04); border-color:var(--accent); }
    .ax-foot{ text-align:center; font-size:13px; color:var(--muted); margin-top:18px; }
    .ax-link{ color:var(--ink); font-weight:600; background:none; border:0; cursor:pointer; font:inherit; padding:0; }
    .ax-link:hover{ text-decoration:underline; }
    .ax-spin{ width:17px; height:17px; border:2px solid rgba(var(--ink-rgb),0.30); border-top-color:var(--accent-fg);
      border-radius:50%; animation:axSpin .7s linear infinite; }
    @keyframes axSpin{ to{ transform:rotate(360deg); } }
    @keyframes axRise{ from{ opacity:0; transform:translateY(10px); } to{ opacity:1; transform:translateY(0); } }
    .ax-panel{ animation:axFade .35s ease both; }
    @keyframes axFade{ from{ opacity:0; transform:translateY(4px); } to{ opacity:1; transform:translateY(0); } }
    @media (prefers-reduced-motion: reduce){ .ax-auth *{ animation-duration:.001ms !important; transition-duration:.001ms !important; } }
  `, [T]);

  return (
    <div className="ax-auth">
      <style>{css}</style>
      <div>
        <div className="ax-brand">
          <div className="ax-logo">agencyx</div>
          <div className="ax-tag">{isSignup ? "Create your workspace account" : "Sign in to your workspace"}</div>
        </div>

        <div className="ax-card">
          <div className="ax-seg" role="tablist" aria-label="Authentication mode">
            <span className={"ax-seg-pill" + (isSignup ? " right" : "")} aria-hidden="true" />
            <button type="button" role="tab" aria-selected={!isSignup} className={!isSignup ? "active" : ""} onClick={() => switchMode("login")}>Log in</button>
            <button type="button" role="tab" aria-selected={isSignup} className={isSignup ? "active" : ""} onClick={() => switchMode("signup")}>Sign up</button>
          </div>

          <form className="ax-panel" key={mode} onSubmit={submit} noValidate>
            {isSignup && (
              <div className="ax-field">
                <label htmlFor="ax-name">Name</label>
                <input id="ax-name" className="ax-input" type="text" autoComplete="name"
                  placeholder="Jane Doe" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
            )}

            <div className="ax-field">
              <label htmlFor="ax-email">Email</label>
              <input id="ax-email" ref={emailRef} className="ax-input" type="email" autoComplete="email"
                placeholder="you@agency.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>

            <div className="ax-field">
              <label htmlFor="ax-pw">Password</label>
              <div className="ax-inwrap">
                <input id="ax-pw" className="ax-input has-eye" type={showPw ? "text" : "password"}
                  autoComplete={isSignup ? "new-password" : "current-password"}
                  placeholder={isSignup ? "At least 6 characters" : "Your password"}
                  value={password} onChange={(e) => setPassword(e.target.value)} />
                <button type="button" className="ax-eye" onClick={() => setShowPw((s) => !s)}
                  aria-label={showPw ? "Hide password" : "Show password"} tabIndex={-1}>
                  <Eye off={showPw} />
                </button>
              </div>
            </div>

            {!isSignup && (
              <div className="ax-forgot">
                <button type="button" onClick={onForgot}>Forgot password?</button>
              </div>
            )}

            {notice && (
              <div className="ax-note" role="status">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
                  <path d="M20 6 9 17l-5-5" />
                </svg>
                <span>{notice}</span>
              </div>
            )}

            {err && (
              <div className="ax-err" role="alert">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" style={{ flexShrink: 0, marginTop: 1 }}>
                  <circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16.5v.01" />
                </svg>
                <span>{err}</span>
              </div>
            )}

            <button className="ax-submit" type="submit" disabled={busy}>
              {busy ? <span className="ax-spin" /> : (isSignup ? "Create account" : "Continue")}
            </button>
          </form>

          <div className="ax-div">or</div>
          <button type="button" className="ax-google" onClick={onGoogle} disabled={googleBusy}>
            {googleBusy ? <span className="ax-spin" style={{ borderTopColor: "var(--ink)" }} /> : <GoogleMark />}
            {googleBusy ? "Connecting…" : "Continue with Google"}
          </button>

          <div className="ax-foot">
            {isSignup ? (
              <>Already have an account? <button type="button" className="ax-link" onClick={() => switchMode("login")}>Log in</button></>
            ) : (
              <>New to agencyx? <button type="button" className="ax-link" onClick={() => switchMode("signup")}>Create one</button></>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
