# Frontend improvement progress

Frontend/UI pass (backend deferred). Every step is its own git commit, so `git log`
shows restore points and `git revert <hash>` undoes any single step cleanly.

Build/verify after a change: `node node_modules/vite/bin/vite.js build` (or `npm run build`).
Note: the build needs `@rollup/rollup-linux-x64-gnu` for this OS — if `npm run build`
errors with a missing rollup module, run `npm install @rollup/rollup-linux-x64-gnu`.

## Done (this pass)
- [x] Step 0 — Baseline: repaired build, git checkpoint, this tracker.
- [x] Step 1 — Quick correctness bugs
      - unique DOM ids on sales inputs (was id={c.id} duplicated)
      - fixed dead CSS rule .mobile-mb-none (marginBottom -> margin-bottom)
      - genId now crypto.randomUUID() (fallback for old browsers)
      - Edit-Cuts modal uses React state + validation (was document.getElementById)
- [x] Step 2 — Per-record edit modal + undo-able delete (toast with Undo, 6s)
      - edits preserve each record's original cut rate
- [x] Step 3 — Working theme switcher (dark / glass / sunset), persisted to storage
      - added --surface/--surface2 vars; routed hardcoded #111412 through them
- [x] Step 4 — Accessibility: :focus-visible ring, prefers-reduced-motion,
      aria-labels on icon buttons (theme swatches, edit/delete, modal close, etc.)
      and on the filter/select controls
- [x] Step 5 — Backup & restore panel in History (JSON save/restore, validated import
      with confirm); also fixed CSV export to quote fields with commas/quotes
- [x] Step 6 — Smart Paste review is now editable: per-match amount edit, include/exclude
      checkbox, "N summed" over-count warning, live running total before applying

## Deferred (do deliberately, each as its own pass)
- [ ] Money as integer cents — touches every amount/cut calculation. Store cents (ints),
      add fmtCents()/toCents() helpers, migrate existing records on load via a version
      bump on STORAGE_KEY, round only at display. Biggest remaining correctness item.
- [ ] Performance — wrap dashboard/client/chatter aggregates in useMemo; build Map
      lookups (id->client, id->chatter) once instead of .find() inside .map().
- [ ] True multi-currency — parser already reads currency symbols but display is USD-only.
      Needs a currency field per record + per-client default. (Data-model change.)
- [ ] Split the 1,600-line file into components / add TypeScript.
- [ ] Backend / cloud sync (the real fix for "data only lives in one browser").

## Map of where things are in agency-tracker.jsx
- THEMES + --surface vars: top of file (~line 38)
- App state ~line 530; handlers (persist/changeTheme/record edit/undo) ~line 600
- parseSales + Smart Paste review logic ~line 740
- exportCSV / exportBackup / handleImportFile ~line 850
- Header (theme swatches + badges) ~line 1015
- History tab (records table, backup panel) ~line 1450
- Modals (edit client cuts, edit record, smart paste) + undo toast ~line 1500+

## Visual redesign pass 2 (done)
- [x] Step E — Animated split donut (agency / chatter / creator) on dashboard, with
      arcs that sweep in and a legend showing amount + %. Colors: agency = emerald,
      chatters = violet, creators = amber (consistent everywhere now).
- [x] Carried the look into Clients (elevated lift cards + stagger, chatter row hover)
      and History (record-row hover, violet chatter-pay accent to match the ring).
- [x] Fix — Mobile invoice/history print was blank: replaced hidden 0x0 iframe +
      injected window.print() (unreliable on mobile Safari/Chrome) with a real visible
      print window that waits for images and uses print-safe colors. Hidden iframe kept
      only as a fallback when popups are blocked (desktop). printElement() in the file.

## Productization (selling to other agencies) — frontend config layer
- [x] Step 1 — Hardcoding audit → see AUDIT.md (checklist of everything agency-specific).
- [x] Step 2 — Config schema + safe defaults (defaults = current values, no visible change).
- [x] Step 3 — Wire config through app via context (plumbing, no visible change).
- [ ] Step 4 — Locale-aware currency + amount-in-words.
- [ ] Step 5 — Terminology pass (config-driven labels; keep internal keys).
- [ ] Step 6 — Branding pass (name/logo/accent from config).
- [ ] Step 7 — De-hardcode invoice (address, tax line, number format, notes).
- [ ] Step 8 — Flexible commission engine (%, flat, tiered) — the core, do carefully.
- [ ] Step 9 — Settings screen to edit all of the above.
- [ ] Step 10 — Onboarding wizard + agency presets (digital / web / chatting).
