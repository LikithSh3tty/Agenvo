import React, { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "./AuthContext.jsx";

// ── "Ledger card" auth overlay ───────────────────────────────────────────────
// agenvo is an agency revenue & commission ledger, so the sign-in is an
// accounting artifact: a hard-edged form block with a rubber-stamp CTA. It
// renders as an overlay on top of the app shell — the main page paints first,
// then the card drops in over a dimmed, blurred backdrop.

const LIGHT = {
  bg: "#E4EAE1", rule: "rgba(40,70,40,0.10)", ink: "#141414", card: "#FBFBF8",
  field: "#FFFFFF", sub: "#5B6058", stamp: "#F35627", onStamp: "#FFFFFF", err: "#B5331B",
};
const DARK = {
  bg: "#101315", rule: "rgba(255,255,255,0.045)", ink: "#EDEDEA", card: "#1A1E20",
  field: "#14181A", sub: "#9AA29A", stamp: "#EDF973", onStamp: "#161900", err: "#F0815F",
};

const THEME_KEY = "agenvo-theme"; // shared with the app

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

const GoogleMark = () => (
  <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z" />
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65Z" />
    <path fill="#FBBC05" d="M10.53 28.59A14.5 14.5 0 0 1 9.77 24c0-1.6.27-3.15.76-4.59l-7.98-6.19A23.94 23.94 0 0 0 0 24c0 3.88.93 7.55 2.56 10.78l7.97-6.19Z" />
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.9-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.17 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z" />
  </svg>
);

export default function AuthScreen() {
  const T = useTheme();
  const { signIn, signUp, signInWithGoogle, sendReset } = useAuth();

  // Let the main page paint first, then drop the card in after a short beat
  // instead of confronting immediately.
  const [showCard, setShowCard] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShowCard(true), 700);
    return () => clearTimeout(t);
  }, []);

  const [mode, setMode] = useState("login"); // "login" | "signup"
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);

  const isSignup = mode === "signup";

  const switchMode = (next) => {
    if (next === mode) return;
    setMode(next); setErr(""); setNotice("");
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
    setErr(""); setNotice(""); setBusy(true);
    try {
      if (isSignup) await signUp({ name, email, password });
      else await signIn({ email, password });
    } catch (ex) {
      setErr(ex?.message || "Something went wrong. Try again.");
      setBusy(false);
    }
  };

  const onGoogle = async () => {
    setErr(""); setNotice(""); setGoogleBusy(true);
    try { await signInWithGoogle(); }
    catch (ex) { setErr(ex?.message || "Google sign-in failed. Try again."); setGoogleBusy(false); }
  };

  const onForgot = async () => {
    setErr(""); setNotice("");
    if (!emailOk(email)) { setErr("Enter your email above, then tap “Forgot password”."); return; }
    try { await sendReset(email); setNotice("Reset link sent — check your inbox."); }
    catch (ex) { setErr(ex?.message || "Couldn't send reset email. Try again."); }
  };

  const css = useMemo(() => `
    @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap');
    .lx { --bg:${T.bg}; --rule:${T.rule}; --ink:${T.ink}; --card:${T.card}; --field:${T.field};
      --sub:${T.sub}; --stamp:${T.stamp}; --on-stamp:${T.onStamp}; --err:${T.err};
      position:fixed; inset:0; z-index:6000; display:flex; justify-content:center; padding:24px 16px;
      overflow-y:auto; -webkit-overflow-scrolling:touch;
      background:rgba(12,15,13,0.50);
      backdrop-filter:blur(7px); -webkit-backdrop-filter:blur(7px);
      color:var(--ink); font-family:'Plus Jakarta Sans',system-ui,sans-serif;
      -webkit-font-smoothing:antialiased; -moz-osx-font-smoothing:grayscale;
      animation:lxDim .35s ease both;
    }
    @keyframes lxDim{ from{ opacity:0; } to{ opacity:1; } }
    .lx *{ box-sizing:border-box; }
    .lx-mono{ font-family:'JetBrains Mono',ui-monospace,monospace; }
    .lx-card{ width:100%; max-width:382px; margin:auto; background:var(--card); border:2px solid var(--ink);
      box-shadow:8px 8px 0 var(--ink); border-radius:3px; overflow:hidden; flex:none;
      animation:lxDrop .5s cubic-bezier(.2,.9,.25,1) both; }
    @keyframes lxDrop{ from{ opacity:0; transform:translate(-5px,-7px); box-shadow:14px 16px 0 var(--ink); } to{ opacity:1; transform:translate(0,0); box-shadow:8px 8px 0 var(--ink); } }

    .lx-head{ background:var(--ink); color:var(--card); padding:13px 18px; display:flex;
      align-items:center; justify-content:space-between; }
    .lx-logo{ font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:23px; letter-spacing:-.03em; }
    .lx-mark{ width:15px; height:15px; background:var(--stamp); border-radius:1px; }

    .lx-body{ padding:20px 20px 22px; }
    .lx-eyebrow{ font-size:10px; letter-spacing:2.5px; color:var(--sub); margin-bottom:9px; }
    .lx-title{ font-family:'Space Grotesk',sans-serif; font-weight:600; font-size:20px; letter-spacing:-.01em; margin-bottom:18px; }

    .lx-tabs{ display:grid; grid-template-columns:1fr 1fr; border:2px solid var(--ink); border-radius:2px;
      box-shadow:3px 3px 0 var(--ink); margin-bottom:20px; overflow:hidden; }
    .lx-tab{ appearance:none; border:0; background:var(--card); color:var(--sub); cursor:pointer;
      padding:10px 0; font-family:'JetBrains Mono',monospace; font-weight:600; font-size:12px; letter-spacing:1.5px;
      transition:background .12s, color .12s; }
    .lx-tab+.lx-tab{ border-left:2px solid var(--ink); }
    .lx-tab.on{ background:var(--ink); color:var(--card); }

    .lx-field{ margin-bottom:13px; }
    .lx-lab{ display:flex; align-items:baseline; justify-content:space-between; margin-bottom:6px; }
    .lx-lab span{ font-family:'JetBrains Mono',monospace; font-size:10.5px; letter-spacing:1.5px; color:var(--sub); }
    .lx-reveal{ appearance:none; border:0; background:none; cursor:pointer; padding:0;
      font-family:'JetBrains Mono',monospace; font-size:10.5px; letter-spacing:1px; color:var(--ink); text-decoration:underline; }
    .lx-input{ width:100%; height:46px; border:2px solid var(--ink); background:var(--field); color:var(--ink);
      box-shadow:3px 3px 0 var(--ink); border-radius:2px; font:inherit; font-size:14.5px; font-weight:500;
      padding:0 13px; outline:none; transition:box-shadow .12s, border-color .12s, transform .12s; }
    .lx-input::placeholder{ color:var(--sub); }
    .lx-input:focus{ border-color:var(--stamp); box-shadow:3px 3px 0 var(--stamp); }

    .lx-forgot{ display:flex; justify-content:flex-end; margin:-2px 0 14px; }
    .lx-forgot button{ appearance:none; border:0; background:none; cursor:pointer; padding:0;
      font-family:'JetBrains Mono',monospace; font-size:11px; letter-spacing:.5px; color:var(--sub); }
    .lx-forgot button:hover{ color:var(--ink); text-decoration:underline; }

    .lx-alert{ border:2px solid; border-radius:2px; box-shadow:2px 2px 0; padding:9px 11px; margin-bottom:14px;
      font-size:12.5px; display:flex; gap:8px; align-items:flex-start; animation:lxDrop .25s ease both; }
    .lx-alert.err{ border-color:var(--err); box-shadow:2px 2px 0 var(--err); color:var(--err); background:rgba(243,86,39,.07); }
    .lx-alert.note{ border-color:var(--ink); box-shadow:2px 2px 0 var(--ink); color:var(--ink); background:var(--field); }

    .lx-stamp{ width:100%; height:50px; border:2px solid var(--ink); background:var(--stamp); color:var(--on-stamp);
      box-shadow:5px 5px 0 var(--ink); border-radius:2px; cursor:pointer; margin-top:4px;
      font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:15px; letter-spacing:.3px;
      display:flex; align-items:center; justify-content:center; gap:9px;
      transition:transform .08s ease, box-shadow .08s ease; }
    .lx-stamp:hover:not(:disabled){ transform:translate(-1px,-1px); box-shadow:6px 6px 0 var(--ink); }
    .lx-stamp:active:not(:disabled){ transform:translate(5px,5px); box-shadow:0 0 0 var(--ink); }
    .lx-stamp:disabled{ opacity:.65; cursor:default; }

    .lx-or{ display:flex; align-items:center; gap:12px; margin:16px 0 14px; }
    .lx-or::before,.lx-or::after{ content:""; flex:1; height:2px; background:var(--ink); opacity:.18; }
    .lx-or span{ font-family:'JetBrains Mono',monospace; font-size:10.5px; letter-spacing:2px; color:var(--sub); }

    .lx-google{ width:100%; height:48px; border:2px solid var(--ink); background:var(--card); color:var(--ink);
      box-shadow:3px 3px 0 var(--ink); border-radius:2px; cursor:pointer;
      font:inherit; font-weight:600; font-size:14px; display:flex; align-items:center; justify-content:center; gap:10px;
      transition:transform .08s ease, box-shadow .08s ease; }
    .lx-google:hover:not(:disabled){ transform:translate(-1px,-1px); box-shadow:4px 4px 0 var(--ink); }
    .lx-google:active:not(:disabled){ transform:translate(3px,3px); box-shadow:0 0 0 var(--ink); }
    .lx-google:disabled{ opacity:.7; cursor:default; }

    .lx-foot{ text-align:center; font-size:12.5px; color:var(--sub); margin-top:16px; }
    .lx-foot button{ appearance:none; border:0; background:none; cursor:pointer; padding:0; font:inherit;
      font-weight:700; color:var(--ink); text-decoration:underline; }

    .lx-spin{ width:16px; height:16px; border:2.5px solid rgba(127,127,127,.35); border-top-color:currentColor;
      border-radius:50%; animation:lxSpin .7s linear infinite; }
    .lx-spin.dark{ border-color:rgba(127,127,127,.25); border-top-color:var(--ink); }
    @keyframes lxSpin{ to{ transform:rotate(360deg); } }

    @media (prefers-reduced-motion: reduce){ .lx, .lx *{ animation-duration:.001ms !important; transition-duration:.001ms !important; } }
  `, [T]);

  // Main page stays fully visible for a beat before the overlay fades in.
  if (!showCard) return null;

  return (
    <div className="lx" role="dialog" aria-modal="true" aria-label="Sign in to agenvo">
      <style>{css}</style>
      <div className="lx-card">
        <div className="lx-head">
          <span className="lx-logo">agenvo</span>
          <span className="lx-mark" aria-hidden="true" />
        </div>

        <div className="lx-body">
          <div className="lx-eyebrow lx-mono">REVENUE · COMMISSIONS · INVOICES</div>
          <div className="lx-title">{isSignup ? "Open your workspace" : "Sign in to your workspace"}</div>

          <div className="lx-tabs" role="tablist" aria-label="Authentication mode">
            <button type="button" role="tab" aria-selected={!isSignup} className={"lx-tab" + (!isSignup ? " on" : "")} onClick={() => switchMode("login")}>LOG IN</button>
            <button type="button" role="tab" aria-selected={isSignup} className={"lx-tab" + (isSignup ? " on" : "")} onClick={() => switchMode("signup")}>SIGN UP</button>
          </div>

          <form onSubmit={submit} noValidate>
            {isSignup && (
              <div className="lx-field">
                <div className="lx-lab"><span>NAME</span></div>
                <input className="lx-input" type="text" autoComplete="name" placeholder="Jane Doe"
                  value={name} onChange={(e) => setName(e.target.value)} />
              </div>
            )}

            <div className="lx-field">
              <div className="lx-lab"><span>EMAIL</span></div>
              <input className="lx-input" type="email" autoComplete="email" placeholder="you@agency.com"
                value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>

            <div className="lx-field">
              <div className="lx-lab">
                <span>PASSWORD</span>
                <button type="button" className="lx-reveal" onClick={() => setShowPw((s) => !s)} tabIndex={-1}>
                  {showPw ? "HIDE" : "SHOW"}
                </button>
              </div>
              <input className="lx-input" type={showPw ? "text" : "password"}
                autoComplete={isSignup ? "new-password" : "current-password"}
                placeholder={isSignup ? "At least 6 characters" : "Your password"}
                value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>

            {!isSignup && (
              <div className="lx-forgot">
                <button type="button" onClick={onForgot}>forgot password? →</button>
              </div>
            )}

            {notice && <div className="lx-alert note" role="status">{notice}</div>}
            {err && <div className="lx-alert err" role="alert">{err}</div>}

            <button className="lx-stamp" type="submit" disabled={busy}>
              {busy ? <span className="lx-spin" /> : (isSignup ? "Open workspace  →" : "Enter workspace  →")}
            </button>
          </form>

          <div className="lx-or"><span>OR</span></div>

          <button type="button" className="lx-google" onClick={onGoogle} disabled={googleBusy}>
            {googleBusy ? <span className="lx-spin dark" /> : <GoogleMark />}
            {googleBusy ? "Connecting…" : "Continue with Google"}
          </button>

          <div className="lx-foot">
            {isSignup
              ? <>Already keeping books? <button type="button" onClick={() => switchMode("login")}>Log in</button></>
              : <>New to agenvo? <button type="button" onClick={() => switchMode("signup")}>Create one</button></>}
          </div>
        </div>
      </div>
    </div>
  );
}
