# Frontend improvement progress

Working through frontend/UI fixes (backend deferred). Each step is committed to git
so you can `git log` to see restore points and `git revert <hash>` if a step misbehaves.

How to resume: read this file top to bottom. Anything unchecked is still to do.
Build check after any change: `node node_modules/vite/bin/vite.js build` (or `npm run build`).

## Done
- [x] Step 0 — Baseline: repaired build, git checkpoint, this tracker.

## In progress / to do (frontend only)
- [x] Step 1 — Quick correctness bugs
      - duplicate DOM `id={c.id}` on sales inputs → unique ids
      - broken CSS `.mobile-mb-none { marginBottom }` → `margin-bottom`
      - `genId` Math.random → `crypto.randomUUID()` (with fallback)
      - Edit-Cuts modal `document.getElementById(...).value` → React state + validation
- [x] Step 2 — Per-record edit & delete, with an undo toast
- [x] Step 3 — Theme switcher (finish the dead `currentTheme` feature) + persist choice;
      route remaining hardcoded colors through CSS vars
- [x] Step 4 — Accessibility pass: aria-labels on icon-only buttons, labelled inputs,
      visible keyboard focus, respect reduced-motion
- [x] Step 5 — Settings: JSON backup export + import (local file, no backend)
- [x] Step 6 — Smart Paste: review/confirm screen before applying + respect parsed currency

## Deferred (bigger, do deliberately later)
- [ ] Money as integer cents (touches all math — do as its own focused pass)
- [ ] Performance: memoize aggregates + build id→entity lookup maps
- [ ] Split the 1,600-line file into components / TypeScript
- [ ] Backend / cloud sync

## Notes
- Build needs `@rollup/rollup-linux-x64-gnu` present (installed once with --no-save).
- App entry: `agency-tracker.jsx` (single component). Persists via `window.storage`
  (polyfilled to localStorage in `src/main.jsx`).
