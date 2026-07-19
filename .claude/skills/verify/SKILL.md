---
name: verify
description: How to verify Agenvo end-to-end — build, headless-drive the deployed app with a disposable account, and self-clean via the in-app reset/delete flows.
---

# Verifying Agenvo

## Handle

- Frontend build: `cd frontend && npx vite build`; local serve: `npx vite preview` (port 5180, strictPort).
- Full E2E: from `frontend/`, `cp ../.claude/skills/verify/e2e.cjs ./e2e-tmp.cjs && node e2e-tmp.cjs` (Node resolves `require("playwright")` from the script's own path, so it must sit inside `frontend/` where node_modules lives; playwright is a frontend dep, browsers already installed). Delete the copy afterwards.
- Env vars: `BASE` (default https://agenvox.vercel.app; agency-x-six.vercel.app is the same project's legacy domain), `SHOTS_DIR` for screenshots, `E2E_EMAIL` to vary the throwaway account.

## Flow the script drives

signup (email/password, @example.com works) → onboarding (service preset: staff="Team Member", cuts 10%/10%, NOT the 7.5/12.5 code defaults) → add client → add team member → NumInput probe ("05x7"→"57") → $1,000 sale → dashboard math → set business address in Settings (invoices are hard-gated on address) → open invoice from Dashboard By-Client card → history → dark toggle → chat assistant → reload persistence → Reset workspace data (type RESET) → Delete account (type DELETE + password). Cleanup is part of the run — a green run leaves no account behind.

## Gotchas that cost time

- Login overlay sits OVER a live guest dashboard; text like "TOTAL SALES" is "visible" behind it but clicks are intercepted. After auth, wait for "Sign in to your workspace" to become hidden.
- Signup-exists error text is "An account with this email already exists" — match /already (in use|registered|exists)/ and fall back to login.
- Never `waitUntil: "networkidle"` — Firestore keeps sockets open; use "load".
- Labels are terminology-driven (config.terms): buttons are "+ Team Member"/"Add Team Member" under the service preset, not "Add Chatter".
- StatCard labels are lowercase in DOM, uppercased by CSS — use case-insensitive matchers.
- Theme state persists per account; the toggle's aria-label flips between "Switch to dark mode"/"Switch to light mode". Dark check: read `--bg` on documentElement (body bg is pinned to #FAFAFA by main.jsx).
- The invoice "Add your invoice details first" gate has no bypass; "Not now" closes the flow entirely.
- API spot-checks: GET /api/assistant → `{"status":"ok","llm":true}`; POST with data snapshot → reply; malformed → 400. GET /api/rates?base=USD → live rates.
