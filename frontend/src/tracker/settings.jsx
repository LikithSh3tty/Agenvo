import React, { useState, useRef } from "react";
import DeleteAccountSection from "../auth/DeleteAccountSection.jsx";
import ResetDataSection from "../auth/ResetDataSection.jsx";
import { CURRENCY_CATALOG, curCatalog, currencyReg, fetchLiveRates } from "./currency.js";
import { C } from "./theme.js";
import { BrutalCheck, Btn, Field, Icon, NumInput, inpStyle } from "./ui.jsx";
import { darken } from "./utils.js";

/* ═══ MAIN APP ═══ */

export function CurrencySelect({ value, onChange }) {
  const codes = Object.keys(currencyReg.map);
  return (
    <select value={(value || currencyReg.base).toUpperCase()} onChange={(e) => onChange(e.target.value)}
      style={{ ...inpStyle, cursor: "pointer", background: "var(--surface)" }}>
      {codes.map((c) => <option key={c} value={c}>{c} ({currencyReg.map[c].symbol})</option>)}
    </select>
  );
}

// Dropdown over the currency catalog. A value not in the catalog (old configs,
// exotic codes) is kept as a selectable option so nothing silently changes.
export function CurrencyPicker({ value, onChange, style }) {
  const v = String(value || "USD").toUpperCase();
  const known = CURRENCY_CATALOG.some((c) => c.code === v);
  return (
    <select value={v} onChange={(e) => onChange(e.target.value)}
      style={{ ...inpStyle, cursor: "pointer", background: "var(--surface)", ...style }}>
      {!known && <option value={v}>{v}</option>}
      {CURRENCY_CATALOG.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.name} ({c.symbol})</option>)}
    </select>
  );
}

function TierEditor({ tiers, onChange, symbol }) {
  const rows = (tiers && tiers.length) ? tiers : [{ upTo: null, rate: 0.1 }];
  const set = (i, patch) => onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addRow = () => {
    const caps = rows.filter((r) => r.upTo != null);
    const nextCap = caps.length ? Number(caps[caps.length - 1].upTo) + 1000 : 1000;
    const last = rows[rows.length - 1];
    onChange([...rows.slice(0, -1), { upTo: nextCap, rate: last.rate }, { upTo: null, rate: last.rate }]);
  };
  const removeRow = (i) => { if (rows.length > 1) onChange(rows.filter((_, idx) => idx !== i)); };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      {rows.map((r, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12 }}>
          <span style={{ color: C.textMuted, width: 46 }}>{r.upTo == null ? "Above" : "Up to"}</span>
          {r.upTo == null
            ? <span style={{ flex: 1, color: C.textDim }}>—</span>
            : <div style={{ position: "relative", flex: 1 }}>
                <span style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", color: C.textMuted, fontSize: 11 }}>{symbol}</span>
                <NumInput value={r.upTo} onChange={(v) => set(i, { upTo: Number(v) || 0 })}
                  style={{ ...inpStyle, padding: "7px 8px 7px 18px", fontSize: 12 }} />
              </div>}
          <span style={{ color: C.textMuted }}>→</span>
          <div style={{ position: "relative", width: 78 }}>
            <NumInput value={+((r.rate || 0) * 100).toFixed(4)} onChange={(v) => set(i, { rate: (Number(v) || 0) / 100 })}
              style={{ ...inpStyle, padding: "7px 18px 7px 8px", fontSize: 12 }} />
            <span style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", color: C.textMuted, fontSize: 11 }}>%</span>
          </div>
          <button type="button" onClick={() => removeRow(i)} aria-label="Remove tier" style={{ background: "none", border: "none", color: "rgba(239,68,68,0.5)", cursor: "pointer", fontSize: 13, padding: 2, visibility: rows.length > 1 ? "visible" : "hidden" }}><Icon name="x" size={14} /></button>
        </div>
      ))}
      <button type="button" onClick={addRow} style={{ alignSelf: "flex-start", background: "var(--accent-dim)", border: "1px solid var(--accent-border)", color: "var(--accent)", borderRadius: 7, padding: "5px 10px", cursor: "pointer", fontSize: 11, fontWeight: 600 }}>+ Tier</button>
    </div>
  );
}

export function CommissionEditor({ value, onChange, symbol = "$" }) {
  const v = value || { model: "percent", rate: 0.1 };
  const setModel = (m) => {
    if (m === "percent") onChange({ model: "percent", rate: v.rate != null ? v.rate : 0.1 });
    else if (m === "flat") onChange({ model: "flat", amount: v.amount != null ? v.amount : 0 });
    else if (m === "hourly") onChange({ model: "hourly", rate: v.model === "hourly" ? v.rate : 0 });
    else onChange({ model: "tiered", tiers: (v.tiers && v.tiers.length) ? v.tiers : [{ upTo: 1000, rate: 0.1 }, { upTo: null, rate: 0.15 }] });
  };
  const inline = { display: "flex", alignItems: "center", gap: 8 };
  return (
    <div>
      <select value={v.model} onChange={(e) => setModel(e.target.value)} style={{ ...inpStyle, cursor: "pointer", background: "var(--surface)", marginBottom: 8 }}>
        <option value="percent">Percentage of revenue</option>
        <option value="flat">Flat fee per item</option>
        <option value="tiered">Tiered by amount</option>
        <option value="hourly">Hourly rate</option>
      </select>
      {v.model === "percent" && (
        <div style={inline}>
          <NumInput style={inpStyle} value={+((v.rate || 0) * 100).toFixed(4)} onChange={(nv) => onChange({ model: "percent", rate: (Number(nv) || 0) / 100 })} />
          <span style={{ color: C.textDim, fontSize: 13 }}>%</span>
        </div>
      )}
      {v.model === "flat" && (
        <div style={inline}>
          <span style={{ color: C.textDim, fontSize: 13 }}>{symbol}</span>
          <NumInput style={inpStyle} value={v.amount || 0} onChange={(nv) => onChange({ model: "flat", amount: Number(nv) || 0 })} />
          <span style={{ color: C.textMuted, fontSize: 12, whiteSpace: "nowrap" }}>per item</span>
        </div>
      )}
      {v.model === "hourly" && (
        <div style={inline}>
          <span style={{ color: C.textDim, fontSize: 13 }}>{symbol}</span>
          <NumInput style={inpStyle} value={v.rate || 0} onChange={(nv) => onChange({ model: "hourly", rate: Number(nv) || 0 })} />
          <span style={{ color: C.textMuted, fontSize: 12, whiteSpace: "nowrap" }}>per hour</span>
        </div>
      )}
      {v.model === "tiered" && <TierEditor tiers={v.tiers} onChange={(tiers) => onChange({ model: "tiered", tiers })} symbol={symbol} />}
    </div>
  );
}

// Stable layout helpers for the Settings panel — defined at module scope so they keep a
// constant component identity across re-renders (otherwise inputs lose focus on each keystroke).
const SettingsSection = ({ title, children }) => (
  <div style={{ background: C.card, border: "1px solid " + C.cardBorder, borderRadius: 12, padding: "18px 20px", marginBottom: 16 }}>
    <div style={{ fontSize: 12, color: C.accent, fontFamily: "'JetBrains Mono',monospace", letterSpacing: 1, textTransform: "uppercase", marginBottom: 14 }}>{title}</div>
    {children}
  </div>
);
const SettingsRow = ({ children }) => <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>{children}</div>;

// Read an image File, downscale it to fit `maxSize` px, and return a compact PNG
// data URL. Keeping logos small matters because they're stored inside the user's
// Firestore document (1 MiB cap). PNG preserves transparency for real logos.
function fileToLogoDataUrl(file, maxSize = 256) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type || !file.type.startsWith("image/")) { reject(new Error("Please choose an image file.")); return; }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Couldn't read that file."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("That image couldn't be loaded."));
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) { reject(new Error("Couldn't process that image.")); return; }
        ctx.drawImage(img, 0, 0, w, h);
        try { resolve(canvas.toDataURL("image/png")); }
        catch { reject(new Error("Couldn't process that image.")); }
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

export function SettingsPanel({ initial, onClose, onSave, onResetData }) {
  const [d, setD] = useState(() => JSON.parse(JSON.stringify(initial)));
  const setB = (k, v) => setD((s) => ({ ...s, business: { ...s.business, [k]: v } }));
  const setL = (k, v) => setD((s) => ({ ...s, locale: { ...s.locale, [k]: v } }));
  const setBr = (k, v) => setD((s) => ({ ...s, branding: { ...s.branding, [k]: v } }));
  const setInv = (k, v) => setD((s) => ({ ...s, invoice: { ...s.invoice, [k]: v } }));
  const setTerm = (grp, sub, v) => setD((s) => ({ ...s, terms: { ...s.terms, [grp]: { ...s.terms[grp], [sub]: v } } }));
  const setTermFlat = (k, v) => setD((s) => ({ ...s, terms: { ...s.terms, [k]: v } }));

  // Live FX: refresh every added currency's rate against the base. fxSeq drops
  // responses that arrive after a newer request (e.g. base changed mid-fetch).
  const [fxStatus, setFxStatus] = useState("");
  const fxSeq = useRef(0);
  const refreshRates = async (baseOverride) => {
    const seq = ++fxSeq.current;
    const base = String(baseOverride || d.locale.currency || "USD").toUpperCase();
    setFxStatus("loading");
    try {
      const rates = await fetchLiveRates(base);
      if (seq !== fxSeq.current) return;
      setD((s) => ({
        ...s,
        currencies: (s.currencies || []).map((c) => {
          const r = c.code && rates[String(c.code).toUpperCase()];
          return r ? { ...c, rate: +(1 / r).toFixed(6) } : c;
        }),
      }));
      setFxStatus("ok");
    } catch {
      if (seq === fxSeq.current) setFxStatus("error");
    }
  };
  const pickBaseCurrency = (code) => {
    const cat = curCatalog(code);
    setD((s) => ({
      ...s,
      locale: {
        ...s.locale, currency: code,
        ...(cat ? { currencySymbol: cat.symbol, locale: cat.locale, currencyWords: cat.words } : {}),
      },
    }));
    if ((d.currencies || []).length) refreshRates(code);
  };
  const pickRowCurrency = (i, code) => {
    const cat = curCatalog(code);
    setD((s) => ({
      ...s,
      currencies: s.currencies.map((x, idx) => idx === i
        ? { ...x, code, symbol: cat ? cat.symbol : (x.symbol || code), locale: cat ? cat.locale : x.locale, words: cat ? cat.words : x.words }
        : x),
    }));
    refreshRates();
  };

  const [logoErr, setLogoErr] = useState("");
  const onLogoFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    setLogoErr("");
    if (file.size > 3 * 1024 * 1024) { setLogoErr("Image is too large (max 3 MB). Pick a smaller file."); return; }
    try { setB("logo", await fileToLogoDataUrl(file)); }
    catch (err) { setLogoErr(err.message || "Couldn't use that image."); }
  };

  const save = () => {
    const out = JSON.parse(JSON.stringify(d));
    out.business.address = (typeof d.business.address === "string"
      ? d.business.address.split("\n")
      : d.business.address || []).map((l) => l.trim()).filter(Boolean);
    if (d.branding.accent !== initial.branding.accent) {
      out.branding.accent2 = darken(d.branding.accent, 0.12);
      out.branding.accent3 = darken(d.branding.accent, 0.22);
    }
    out.locale.taxRate = Number(d.locale.taxRate) || 0;
    const baseC = (out.locale.currency || "USD").toUpperCase();
    out.currencies = (d.currencies || [])
      .map((c) => {
        const cat = curCatalog(c.code);
        const row = { code: String(c.code || "").toUpperCase().trim(), symbol: c.symbol || (cat ? cat.symbol : ""), rate: Number(c.rate) || 0 };
        const lc = c.locale || (cat && cat.locale);
        const w = c.words || (cat && cat.words);
        if (lc) row.locale = lc;
        if (w) row.words = w;
        return row;
      })
      .filter((c) => c.code && c.code !== baseC && c.rate > 0)
      .filter((c, i, arr) => arr.findIndex((x) => x.code === c.code) === i);
    out.invoice.fiscalYearStartMonth = Math.min(12, Math.max(1, Number(d.invoice.fiscalYearStartMonth) || 1));
    out.invoice.dueDays = Math.max(0, Number(d.invoice.dueDays) || 0);
    onSave(out);
  };

  const addressStr = Array.isArray(d.business.address) ? d.business.address.join("\n") : (d.business.address || "");
  const half = { flex: "1 1 160px", minWidth: 140 };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 2000, background: "var(--bg)",
      backgroundImage: "radial-gradient(800px 500px at 12% -8%, rgba(var(--accent-rgb),0.10), transparent 60%)",
      overflowY: "auto", animation: "fadeIn 0.2s ease",
    }}>
      <div style={{ maxWidth: 660, margin: "0 auto", padding: "28px 20px 90px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 22 }}>
          <div>
            <h2 style={{ fontSize: 22, fontWeight: 700 }}>Settings</h2>
            <div style={{ fontSize: 12.5, color: C.textDim, marginTop: 2 }}>Customize how the app is branded and worded for your agency.</div>
          </div>
          <button onClick={onClose} aria-label="Close settings" style={{ background: "rgba(var(--ink-rgb),0.05)", border: "none", color: C.textMuted, width: 34, height: 34, borderRadius: 8, cursor: "pointer", fontSize: 15 }}><Icon name="x" size={14} /></button>
        </div>

        <SettingsSection title="Business">
          <Field label="Business name"><input style={inpStyle} value={d.business.name} onChange={(e) => setB("name", e.target.value)} /></Field>
          <Field label="Tagline"><input style={inpStyle} value={d.business.tagline} onChange={(e) => setB("tagline", e.target.value)} /></Field>
          <Field label="Logo (upload from device, or paste a URL — blank = use initial letter)">
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
              {d.business.logo ? (
                <img src={d.business.logo} alt="Logo preview" style={{ width: 46, height: 46, borderRadius: 8, objectFit: "contain", background: "rgba(var(--ink-rgb),0.04)", border: "1px solid var(--field-border)", flex: "none" }} />
              ) : (
                <div style={{ width: 46, height: 46, borderRadius: 8, flex: "none", display: "grid", placeItems: "center", background: "var(--pop)", color: "var(--pop-fg)", fontWeight: 800, fontSize: 20, fontFamily: "'Space Grotesk',sans-serif" }}>{(d.business.name || "?").charAt(0).toUpperCase()}</div>
              )}
              <label style={{ display: "inline-flex", alignItems: "center", gap: 7, background: "var(--accent-dim)", border: "1px solid var(--accent-border)", color: "var(--accent)", borderRadius: 8, padding: "8px 13px", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
                <Icon name="upload" size={14} /> Upload logo
                <input type="file" accept="image/*" onChange={onLogoFile} style={{ display: "none" }} />
              </label>
              {d.business.logo && (
                <button type="button" onClick={() => { setB("logo", ""); setLogoErr(""); }} style={{ background: "none", border: "1px solid var(--field-border)", color: C.textDim, borderRadius: 8, padding: "8px 12px", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>Remove</button>
              )}
            </div>
            <input style={inpStyle} value={d.business.logo && d.business.logo.startsWith("data:") ? "" : d.business.logo} onChange={(e) => setB("logo", e.target.value)} placeholder="…or paste an image URL (https://…)" />
            {logoErr && <div style={{ color: "#ef4444", fontSize: 12, marginTop: 6 }}>{logoErr}</div>}
          </Field>
          <Field label="Address (one line per row, shown on invoices)">
            <textarea style={{ ...inpStyle, minHeight: 90, resize: "vertical", fontFamily: "'Space Grotesk',sans-serif" }} value={addressStr} onChange={(e) => setB("address", e.target.value)} />
          </Field>
        </SettingsSection>


        <SettingsSection title="Terminology">
          <SettingsRow>
            <div style={half}><Field label="Client (singular)"><input style={inpStyle} value={d.terms.client.one} onChange={(e) => setTerm("client", "one", e.target.value)} /></Field></div>
            <div style={half}><Field label="Clients (plural)"><input style={inpStyle} value={d.terms.client.many} onChange={(e) => setTerm("client", "many", e.target.value)} /></Field></div>
          </SettingsRow>
          <SettingsRow>
            <div style={half}><Field label="Staff member (singular)"><input style={inpStyle} value={d.terms.staff.one} onChange={(e) => setTerm("staff", "one", e.target.value)} /></Field></div>
            <div style={half}><Field label="Staff (plural)"><input style={inpStyle} value={d.terms.staff.many} onChange={(e) => setTerm("staff", "many", e.target.value)} /></Field></div>
          </SettingsRow>
          <SettingsRow>
            <div style={half}><Field label="Revenue item (singular)"><input style={inpStyle} value={d.terms.revenue.one} onChange={(e) => setTerm("revenue", "one", e.target.value)} /></Field></div>
            <div style={half}><Field label="Revenue (plural)"><input style={inpStyle} value={d.terms.revenue.many} onChange={(e) => setTerm("revenue", "many", e.target.value)} /></Field></div>
          </SettingsRow>
          <SettingsRow>
            <div style={half}><Field label="Agency share label"><input style={inpStyle} value={d.terms.agencyShareLabel} onChange={(e) => setTermFlat("agencyShareLabel", e.target.value)} /></Field></div>
            <div style={half}><Field label="Staff pay label"><input style={inpStyle} value={d.terms.staffShareLabel} onChange={(e) => setTermFlat("staffShareLabel", e.target.value)} /></Field></div>
          </SettingsRow>
        </SettingsSection>

        <SettingsSection title="Currency & Tax">
          <SettingsRow>
            <div style={half}><Field label="Currency"><CurrencyPicker value={d.locale.currency} onChange={pickBaseCurrency} /></Field></div>
            <div style={half}><Field label="Symbol"><input style={inpStyle} value={d.locale.currencySymbol} onChange={(e) => setL("currencySymbol", e.target.value)} placeholder="$" /></Field></div>
            <div style={half}><Field label="Locale"><input style={inpStyle} value={d.locale.locale} onChange={(e) => setL("locale", e.target.value)} placeholder="en-US" /></Field></div>
          </SettingsRow>
          <SettingsRow>
            <div style={half}><Field label="Tax label"><input style={inpStyle} value={d.locale.taxLabel} onChange={(e) => setL("taxLabel", e.target.value)} placeholder="VAT / GST" /></Field></div>
            <div style={half}><Field label="Tax rate (%)"><NumInput style={inpStyle} value={+((Number(d.locale.taxRate) || 0) * 100).toFixed(4)} onChange={(v) => setL("taxRate", (Number(v) || 0) / 100)} /></Field></div>
          </SettingsRow>
          <Field label="Tax line on invoice (optional)"><input style={inpStyle} value={d.locale.taxLine} onChange={(e) => setL("taxLine", e.target.value)} /></Field>
          <label style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 13, color: C.textDim, cursor: "pointer", marginTop: 8 }}>
            <BrutalCheck checked={d.locale.amountInWords !== false} onChange={(e) => setL("amountInWords", e.target.checked)} ariaLabel="Show amount in words on invoices" />
            Show amount in words on invoices
          </label>
        </SettingsSection>

        <SettingsSection title="Currencies">
          <p style={{ fontSize: 12.5, color: C.textDim, marginBottom: 14, lineHeight: 1.5 }}>
            Base currency is <strong>{(d.locale.currency || "USD").toUpperCase()}</strong>. Add other currencies your {(d.terms?.client?.many || "clients").toLowerCase()} invoice in — the <em>rate</em> (value of 1 unit in {(d.locale.currency || "USD").toUpperCase()}) is fetched live when you pick a currency and refreshed automatically every time the app loads, so conversions track the market. You can still edit a rate by hand.
          </p>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, fontSize: 12, color: C.textMuted, fontFamily: "'JetBrains Mono',monospace" }}>
            <span style={{ width: 78, fontWeight: 700, color: C.accent }}>{(d.locale.currency || "USD").toUpperCase()}</span>
            <span style={{ width: 52 }}>{d.locale.currencySymbol}</span>
            <span>base · rate 1.0000</span>
          </div>
          {(d.currencies || []).map((c, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
              <select value={c.code || ""} onChange={(e) => pickRowCurrency(i, e.target.value)}
                style={{ ...inpStyle, width: 150, cursor: "pointer", background: "var(--surface)", fontFamily: "'JetBrains Mono',monospace" }}>
                <option value="">Pick…</option>
                {c.code && !curCatalog(c.code) && <option value={c.code}>{c.code}</option>}
                {CURRENCY_CATALOG.filter((cc) => cc.code !== (d.locale.currency || "USD").toUpperCase())
                  .map((cc) => <option key={cc.code} value={cc.code}>{cc.code} ({cc.symbol})</option>)}
              </select>
              <input placeholder="€" value={c.symbol || ""} onChange={(e) => setD((s) => ({ ...s, currencies: s.currencies.map((x, idx) => idx === i ? { ...x, symbol: e.target.value } : x) }))}
                style={{ ...inpStyle, width: 52, textAlign: "center" }} />
              <div style={{ position: "relative", flex: 1, minWidth: 140 }}>
                <NumInput placeholder="rate in base" value={c.rate ?? ""} onChange={(v) => setD((s) => ({ ...s, currencies: s.currencies.map((x, idx) => idx === i ? { ...x, rate: v } : x) }))}
                  style={inpStyle} />
              </div>
              <button type="button" aria-label="Remove currency" title="Remove currency" onClick={() => setD((s) => ({ ...s, currencies: s.currencies.filter((_, idx) => idx !== i) }))}
                style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.35)", color: "#ef4444", borderRadius: 8, width: 34, height: 34, cursor: "pointer" }}><Icon name="x" size={14} /></button>
            </div>
          ))}
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 4, flexWrap: "wrap" }}>
            <button type="button" onClick={() => setD((s) => ({ ...s, currencies: [...(s.currencies || []), { code: "", symbol: "", rate: "" }] }))}
              style={{ background: "var(--accent-dim)", border: "1px solid var(--accent-border)", color: "var(--accent)", borderRadius: 8, padding: "7px 12px", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>+ Add currency</button>
            {(d.currencies || []).some((c) => c.code) && (
              <button type="button" onClick={() => refreshRates()}
                style={{ background: "none", border: "1px solid var(--field-border)", color: C.textDim, borderRadius: 8, padding: "7px 12px", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                {fxStatus === "loading" ? "Fetching rates…" : "Refresh live rates"}
              </button>
            )}
            {fxStatus === "ok" && <span style={{ fontSize: 11.5, color: C.earn }}>Live rates applied</span>}
            {fxStatus === "error" && <span style={{ fontSize: 11.5, color: "#ef4444" }}>Couldn't fetch rates — check your connection or enter rates manually</span>}
          </div>
        </SettingsSection>

        <SettingsSection title="Invoice">
          <Field label="Invoice title"><input style={inpStyle} value={d.invoice.title} onChange={(e) => setInv("title", e.target.value)} /></Field>
          <SettingsRow>
            <div style={half}><Field label="Number format"><input style={{ ...inpStyle, fontFamily: "'JetBrains Mono',monospace" }} value={d.invoice.numberFormat} onChange={(e) => setInv("numberFormat", e.target.value)} /></Field></div>
            <div style={half}><Field label="Fiscal year start month (1–12)"><NumInput integer style={inpStyle} value={d.invoice.fiscalYearStartMonth} onChange={(v) => setInv("fiscalYearStartMonth", v)} /></Field></div>
          </SettingsRow>
          <div style={{ fontSize: 11, color: C.textMuted, marginTop: -6, marginBottom: 12 }}>Tokens: {"{FY} {YYYY} {YY} {MM} {SEQ}"}</div>
          <SettingsRow>
            <div style={half}><Field label="Line-item label"><input style={inpStyle} value={d.invoice.lineItemLabel} onChange={(e) => setInv("lineItemLabel", e.target.value)} /></Field></div>
            <div style={half}><Field label="Payment due (days)"><NumInput integer style={inpStyle} value={d.invoice.dueDays} onChange={(v) => setInv("dueDays", v)} /></Field></div>
          </SettingsRow>
          <Field label="Notes"><input style={inpStyle} value={d.invoice.notes} onChange={(e) => setInv("notes", e.target.value)} /></Field>
          <Field label="Signatory"><input style={inpStyle} value={d.invoice.signatory} onChange={(e) => setInv("signatory", e.target.value)} /></Field>
        </SettingsSection>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 20 }}>
          <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
          <Btn onClick={save}>Save settings</Btn>
        </div>

        <ResetDataSection onReset={onResetData} />
        <DeleteAccountSection />
      </div>
    </div>
  );
}

