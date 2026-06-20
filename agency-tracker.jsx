import React, { useState, useEffect, useCallback, useRef, useMemo, createContext, useContext } from "react";

const STORAGE_KEY = "fanlink-tracker-v4";
const defaultState = { clients: [], chatters: [], records: [] };

const genId = () =>
  (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
const today = () => new Date().toISOString().slice(0, 10);
// Active currency — kept in sync with config.locale by <App>. Single tenant per browser,
// so a module-level value lets fmt()/toWords() stay config-driven without threading props.
let activeCurrency = { locale: "en-US", currency: "USD", symbol: "$", words: { major: "Dollars", minor: "Cents" } };
const setActiveCurrency = (loc) => {
  activeCurrency = {
    locale: loc.locale || "en-US",
    currency: loc.currency || "USD",
    symbol: loc.currencySymbol || "$",
    words: loc.currencyWords || { major: "Dollars", minor: "Cents" },
  };
};
const fmt = (n) => {
  const v = Number(n) || 0;
  try {
    return new Intl.NumberFormat(activeCurrency.locale, { style: "currency", currency: activeCurrency.currency }).format(v);
  } catch {
    return activeCurrency.symbol + v.toFixed(2);
  }
};

// ── Money in integer cents ──────────────────────────────────────────
// All money math goes through cents to avoid floating-point drift (e.g. 0.1 + 0.2).
// Storage stays in dollars for back-compat; we convert at the arithmetic boundaries.
const toCents = (dollars) => Math.round(((Number(dollars) || 0) + Number.EPSILON) * 100);
const fromCents = (c) => (Number(c) || 0) / 100;
// Round a dollar amount to whole cents.
const money = (dollars) => fromCents(toCents(dollars));
// Sum an array of dollar values exactly (accumulate in integer cents).
const sumMoney = (arr, fn = (x) => x) => fromCents(arr.reduce((c, x) => c + toCents(fn(x)), 0));

function useCountUp(target, duration = 1000) {
  const [val, setVal] = useState(0);
  const fromRef = useRef(0);
  useEffect(() => {
    const reduce = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || typeof requestAnimationFrame === "undefined") { setVal(target); fromRef.current = target; return; }
    const from = fromRef.current;
    const start = (typeof performance !== "undefined" ? performance.now() : Date.now());
    let raf;
    const tick = (t) => {
      const p = Math.min(1, ((typeof performance !== "undefined" ? t : Date.now()) - start) / duration);
      const e = 1 - Math.pow(1 - p, 3);
      setVal(from + (target - from) * e);
      if (p < 1) raf = requestAnimationFrame(tick); else fromRef.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return val;
}
const shortDate = (d) => {
  const dt = new Date(d + "T00:00:00");
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};
const AGENCY_CUT = 0.075;
const CHATTER_CUT = 0.125;

/* ── Productization: per-agency config. Defaults reproduce the current app exactly,
   so adding this changes nothing visible. Later steps make the UI read from it. ── */
const defaultConfig = {
  business: {
    name: "AgencyX",
    tagline: "Agency Dashboard",
    logo: "",
    address: [],
    country: "",
  },
  locale: {
    locale: "en-US",
    currency: "USD",
    currencySymbol: "$",
    amountInWords: true,
    currencyWords: { major: "Dollars", minor: "Cents" },
    taxRate: 0,
    taxLabel: "Tax",
    taxLine: "",
  },
  terms: {
    client: { one: "Client", many: "Clients" },
    staff: { one: "Chatter", many: "Chatters" },
    revenue: { one: "Sale", many: "Sales" },
    agencyShareLabel: "Agency Cut",
    staffShareLabel: "Chatter Pay",
  },
  branding: {
    accent: "#5EEAD4",
    accent2: "#34D399",
    accent3: "#2DD4BF",
  },
  invoice: {
    title: "Customer Invoices",
    numberFormat: "INV/{FY}/{SEQ}",
    fiscalYearStartMonth: 4,
    lineItemLabel: "Agency Fees",
    notes: "Please make the payment within 7 days.",
    signatory: "Authorized Signatory",
    dueDays: 0,
  },
  commission: {
    model: "percent",
    defaults: { agencyShare: AGENCY_CUT, staffShare: CHATTER_CUT },
  },
  onboarded: false,
};

// ── Commission engine ──────────────────────────────────────────────
// A "part" describes how one side (agency or staff) is paid per revenue record:
//   { model:"percent", rate:0.075 }              -> share = amount * rate
//   { model:"flat",    amount:200 }              -> share = fixed amount per record
//   { model:"tiered",  tiers:[{upTo,rate}, ...] } -> share = amount * rate of matching bracket
//   { model:"hourly",  rate:50 }                 -> share = hours * rate
const computeShare = (part, amount, hours = 0) => {
  if (!part) return 0;
  const amt = Number(amount) || 0, hrs = Number(hours) || 0;
  let raw;
  switch (part.model) {
    case "flat": raw = Math.max(0, Number(part.amount) || 0); break;
    case "hourly": raw = Math.max(0, hrs * (Number(part.rate) || 0)); break;
    case "tiered": {
      const tiers = (part.tiers || []).slice().sort((a, b) => (a.upTo == null ? Infinity : a.upTo) - (b.upTo == null ? Infinity : b.upTo));
      raw = amt * (Number((tiers.find((tr) => tr.upTo == null || amt <= Number(tr.upTo)) || tiers[tiers.length - 1] || {}).rate) || 0);
      break;
    }
    case "percent":
    default: raw = amt * (Number(part.rate) || 0); break;
  }
  return money(raw);
};

// Normalize a client to a commission object (back-compat with legacy agencyCut/chatterCut).
const clientCommission = (client) => {
  if (client && client.commission && client.commission.agency && client.commission.staff) return client.commission;
  return {
    agency: { model: "percent", rate: (client && client.agencyCut != null) ? client.agencyCut : AGENCY_CUT },
    staff: { model: "percent", rate: (client && client.chatterCut != null) ? client.chatterCut : CHATTER_CUT },
  };
};

const computeShares = (client, amount, hours = 0) => {
  const c = clientCommission(client);
  return { agencyShare: computeShare(c.agency, amount, hours), staffShare: computeShare(c.staff, amount, hours) };
};

// True if any side of a client's commission is hourly (so a record needs an hours input).
const clientUsesHours = (client) => {
  const c = clientCommission(client);
  return c.agency.model === "hourly" || c.staff.model === "hourly";
};

// Short human label for a commission part, e.g. "7.5%", "$200 flat", "$50/hr", "tiered".
const partLabel = (part, symbol = "$") => {
  if (!part) return "";
  switch (part.model) {
    case "flat": return `${symbol}${Number(part.amount) || 0} flat`;
    case "hourly": return `${symbol}${Number(part.rate) || 0}/hr`;
    case "tiered": return "tiered";
    default: return `${((Number(part.rate) || 0) * 100).toFixed(1).replace(/\.0$/, "")}%`;
  }
};

// The agency's default commission parts (for seeding new clients). Reads either the new
// {agency, staff} part shape or the legacy {agencyShare, staffShare} fractions.
const defaultCommissionParts = (config) => {
  const d = (config && config.commission && config.commission.defaults) || {};
  if (d.agency && d.staff) return { agency: d.agency, staff: d.staff };
  return {
    agency: { model: "percent", rate: d.agencyShare != null ? d.agencyShare : AGENCY_CUT },
    staff: { model: "percent", rate: d.staffShare != null ? d.staffShare : CHATTER_CUT },
  };
};
const AGENCY_PRESETS = {
  chatting: {
    label: "Chatting agency", icon: "💬", tagline: "Chatting Agency",
    terms: { client: { one: "Client", many: "Clients" }, staff: { one: "Chatter", many: "Chatters" }, revenue: { one: "Sale", many: "Sales" }, agencyShareLabel: "Agency Cut", staffShareLabel: "Chatter Pay" },
    commission: { agencyShare: 0.075, staffShare: 0.125 }, lineItemLabel: "Agency Fees",
  },
  marketing: {
    label: "Marketing / digital", icon: "📈", tagline: "Marketing Agency",
    terms: { client: { one: "Client", many: "Clients" }, staff: { one: "Specialist", many: "Specialists" }, revenue: { one: "Campaign", many: "Campaigns" }, agencyShareLabel: "Agency Fee", staffShareLabel: "Specialist Pay" },
    commission: { agencyShare: 0.20, staffShare: 0.10 }, lineItemLabel: "Marketing Services",
  },
  web: {
    label: "Web / design studio", icon: "🎨", tagline: "Web & Design Studio",
    terms: { client: { one: "Client", many: "Clients" }, staff: { one: "Developer", many: "Developers" }, revenue: { one: "Project", many: "Projects" }, agencyShareLabel: "Agency Fee", staffShareLabel: "Developer Pay" },
    commission: { agencyShare: 0.30, staffShare: 0.15 }, lineItemLabel: "Development Services",
  },
  custom: {
    label: "Something else", icon: "✨", tagline: "Agency",
    terms: { client: { one: "Client", many: "Clients" }, staff: { one: "Team Member", many: "Team Members" }, revenue: { one: "Job", many: "Jobs" }, agencyShareLabel: "Agency Share", staffShareLabel: "Team Pay" },
    commission: { agencyShare: 0.10, staffShare: 0.10 }, lineItemLabel: "Services",
  },
};

// Merge a saved config over defaults so older saves still pick up new keys.
const mergeConfig = (saved) => {
  const base = JSON.parse(JSON.stringify(defaultConfig));
  if (!saved || typeof saved !== "object") return base;
  for (const k of Object.keys(base)) {
    if (saved[k] && typeof saved[k] === "object" && !Array.isArray(saved[k])) {
      base[k] = { ...base[k], ...saved[k] };
    } else if (saved[k] !== undefined) {
      base[k] = saved[k];
    }
  }
  // One-time cleanup: strip leftover single-tenant defaults that older saves baked in,
  // so they don't persist as if the user had chosen them.
  if (base.locale.taxLine === "Place of supply: Maharashtra") base.locale.taxLine = "";
  if (Array.isArray(base.business.address) &&
      base.business.address.join("|") === "Ghansoli|Navi Mumbai|Vashi 400703|Maharashtra MH|India") {
    base.business.address = [];
  }
  if (base.business.country === "India") base.business.country = "";
  if (base.business.logo === "/logo.svg") base.business.logo = "";
  if (base.business.name === "Fanlink Chatting") base.business.name = "AgencyX";
  if (base.business.tagline === "Chatting Agency") base.business.tagline = "Agency Dashboard";
  return base;
};

// Any component can read the active agency config via useConfig().
const ConfigContext = createContext(defaultConfig);
const useConfig = () => useContext(ConfigContext);
const LOGO = "/logo.svg";

// Fiscal-year label for a date, given the FY start month (e.g. 4 = April -> "26-27").
const fiscalYear = (dateStr, startMonth = 1) => {
  const d = new Date((dateStr || today()) + "T00:00:00");
  const m = d.getMonth() + 1, y = d.getFullYear();
  const start = m >= startMonth ? y : y - 1;
  const pad = (n) => String(n % 100).padStart(2, "0");
  return `${pad(start)}-${pad(start + 1)}`;
};

// Expand an invoice-number template using a record + invoice config.
const invoiceNumber = (record, inv) => {
  if (record.invoiceNo) return record.invoiceNo;
  const d = new Date((record.date || today()) + "T00:00:00");
  const seq = (record.id || "").replace(/[^a-z0-9]/gi, "").slice(0, 4).toUpperCase() || "0001";
  return (inv.numberFormat || "INV/{FY}/{SEQ}")
    .replace(/\{FY\}/g, fiscalYear(record.date, inv.fiscalYearStartMonth || 1))
    .replace(/\{YYYY\}/g, String(d.getFullYear()))
    .replace(/\{YY\}/g, String(d.getFullYear() % 100).padStart(2, "0"))
    .replace(/\{MM\}/g, String(d.getMonth() + 1).padStart(2, "0"))
    .replace(/\{SEQ\}/g, seq);
};

// "#5EEAD4" -> "94, 234, 212"  (for rgba(var(--accent-rgb), a) glows)
const hexToRgb = (hex) => {
  const m = /^#?([0-9a-fA-F]{6})$/.exec((hex || "").trim());
  if (!m) return "94, 234, 212";
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
};

// Darken a hex by a fraction (0..1) — used to derive the accent ramp from one color.
const darken = (hex, f) => {
  const m = /^#?([0-9a-fA-F]{6})$/.exec((hex || "").trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => Math.max(0, Math.round(x * (1 - f))));
  return "#" + ch.map((x) => x.toString(16).padStart(2, "0")).join("");
};

const toWords = (num) => {
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const convert = (n) => {
    if (n < 20) return ones[n];
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? " " + ones[n % 10] : "");
    if (n < 1000) return ones[Math.floor(n / 100)] + " Hundred" + (n % 100 ? " And " + convert(n % 100) : "");
    if (n < 1000000) return convert(Math.floor(n / 1000)) + " Thousand" + (n % 1000 ? " " + convert(n % 1000) : "");
    return "";
  };
  const main = Math.floor(num);
  const cents = Math.round((num - main) * 100);
  let str = convert(main) + " " + activeCurrency.words.major;
  if (cents > 0) str += " And " + convert(cents) + " " + activeCurrency.words.minor;
  return str;
};

const THEME = {
  name: "Operator Console",
  bg: "#070A09",
  card: "rgba(255,255,255,0.035)",
  cardBorder: "rgba(255,255,255,0.07)",
  accent: "#5EEAD4",
  accent2: "#34D399",
  accent3: "#2DD4BF",
  accentGlow: "rgba(var(--accent-rgb),0.14)",
  accentDim: "rgba(var(--accent-rgb),0.08)",
  accentBorder: "rgba(var(--accent-rgb),0.16)",
  textDim: "rgba(234,242,238,0.55)",
  textMuted: "rgba(234,242,238,0.30)",
  earn: "#FBBF24",
  violet: "#A78BFA",
  surface: "#0E1411",
  surface2: "#0A0F0D",
  blur: "blur(16px)",
};

const C = {
  bg: "var(--bg)",
  card: "var(--card-bg)",
  cardBorder: "var(--card-border)",
  accent: "var(--accent)",
  accent2: "var(--accent2)",
  accent3: "var(--accent3)",
  accentGlow: "var(--accent-glow)",
  accentDim: "var(--accent-dim)",
  accentBorder: "var(--accent-border)",
  textDim: "var(--text-dim)",
  textMuted: "var(--text-muted)",
  earn: "var(--earn)",
  violet: "var(--violet)",
  surface: "var(--surface)",
  surface2: "var(--surface2)",
  blur: "var(--blur)",
};

async function loadData() {
  try {
    const r = await window.storage.get(STORAGE_KEY);
    return r ? JSON.parse(r.value) : null;
  } catch (e) {
    return null;
  }
}

async function saveData(d) {
  try {
    await window.storage.set(STORAGE_KEY, JSON.stringify(d));
  } catch (e) {
    console.error("Save failed", e);
  }
}

const printElement = (elId, title) => {
  const el = document.getElementById(elId);
  if (!el) return;

  const css = `
    @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;700&family=Inter:wght@400;600;700&display=swap');
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #fff; color: #111; font-family: 'Inter', sans-serif; }
    body { padding: 16px; }
    #invoice-printable { width: 100% !important; max-width: 760px !important; min-height: 0 !important; margin: 0 auto !important; box-shadow: none !important; padding: 24px !important; }
    #history-printable, #history-printable * { color: #111 !important; background: transparent !important; border-color: #ddd !important; }
    .no-print, .no-print-modal-overlay { display: none !important; }
    @media print { @page { margin: 14mm; size: auto; } body { padding: 0; } }
  `;

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title || "Print"}</title><style>${css}</style></head><body>${el.outerHTML}<script>
    (function(){
      function go(){ try { window.focus(); } catch(e){} try { window.print(); } catch(e){} }
      window.onafterprint = function(){ setTimeout(function(){ try { window.close(); } catch(e){} }, 300); };
      var imgs = Array.prototype.slice.call(document.images || []);
      var pending = imgs.filter(function(i){ return !i.complete; });
      if (pending.length === 0) { setTimeout(go, 350); return; }
      var done = 0;
      pending.forEach(function(i){
        var f = function(){ if (++done >= pending.length) setTimeout(go, 200); };
        i.addEventListener('load', f); i.addEventListener('error', f);
      });
      setTimeout(go, 1600);
    })();
  <\/script></body></html>`;

  // Preferred path: a real, visible window. Reliable on mobile Safari/Chrome,
  // where a hidden 0x0 iframe often prints blank or never fires.
  let w = null;
  try { w = window.open("", "_blank"); } catch (e) { w = null; }
  if (w && w.document) {
    w.document.open();
    w.document.write(html);
    w.document.close();
    return;
  }

  // Fallback for blocked popups (typically desktop): hidden iframe.
  const iframe = document.createElement("iframe");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow.document;
  doc.open();
  doc.write(html);
  doc.close();
  setTimeout(() => { try { iframe.remove(); } catch (e) {} }, 60000);
};

/* ═══ UI COMPONENTS ═══ */

function Modal({ open, onClose, title, children }) {
  if (!open) return null;
  return (
    <div className="no-print-modal-overlay" onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(10px)",
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
            background: "rgba(255,255,255,0.05)", border: "none", color: C.textMuted,
            width: 30, height: 30, borderRadius: 8, cursor: "pointer", fontSize: 14,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>✖</button>
        </div>
        {children}
      </div>
    </div>
  );
}

const inpStyle = {
  width: "100%", boxSizing: "border-box", padding: "11px 14px",
  background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 9, color: "#fff", fontSize: 14, outline: "none",
  fontFamily: "'Outfit',sans-serif", transition: "border-color 0.2s",
};

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{
        display: "block", fontSize: 11, color: C.textDim, marginBottom: 5,
        letterSpacing: 0.6, textTransform: "uppercase", fontFamily: "'JetBrains Mono',monospace",
      }}>{label}</label>
      {children}
    </div>
  );
}

function Btn({ children, onClick, disabled, variant, style: s }) {
  const isPrimary = variant !== "secondary";
  const base = isPrimary
    ? {
      background: disabled ? "rgba(var(--accent-rgb),0.15)" : "linear-gradient(135deg, var(--accent), var(--accent2))",
      color: "#04231b",
      boxShadow: disabled ? "none" : "0 6px 26px rgba(var(--accent-rgb),0.28), inset 0 1px 0 rgba(255,255,255,0.4)",
    }
    : {
      background: "rgba(255,255,255,0.04)",
      border: "1px solid rgba(255,255,255,0.08)",
      color: "rgba(255,255,255,0.6)",
    };
  return (
    <button onClick={onClick} disabled={disabled} className={isPrimary ? "btnp" : "btns"} style={{
      padding: "11px 24px", border: "none", borderRadius: 11, fontSize: 14, fontWeight: 700,
      cursor: disabled ? "not-allowed" : "pointer", fontFamily: "'Outfit',sans-serif",
      transition: "transform 0.2s ease, box-shadow 0.2s ease, filter 0.2s ease, background 0.2s ease",
      opacity: disabled ? 0.5 : 1, ...base, ...s,
    }}>{children}</button>
  );
}

function StatCard({ label, amount, accent, gradient, delay = 0 }) {
  const animated = useCountUp(typeof amount === "number" ? amount : 0);
  return (
    <div className="lift rise" style={{
      background: C.card, border: "1px solid " + C.cardBorder, borderRadius: 16,
      padding: "20px 24px", flex: "1 1 180px", minWidth: 155, position: "relative", overflow: "hidden",
      boxShadow: "0 14px 34px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.04)",
      animationDelay: delay + "ms",
    }}>
      <div style={{
        position: "absolute", top: -12, right: -12, width: 72, height: 72, borderRadius: "50%",
        background: accent || C.accentGlow, filter: "blur(22px)",
      }} />
      <div style={{
        fontSize: 11, color: C.textDim, letterSpacing: 1, textTransform: "uppercase",
        marginBottom: 8, fontFamily: "'JetBrains Mono',monospace",
      }}>{label}</div>
      <div style={{
        fontSize: 27, fontWeight: 700, letterSpacing: -0.5, fontFamily: "'Outfit',sans-serif",
        fontVariantNumeric: "tabular-nums",
        ...(gradient ? {
          background: "linear-gradient(120deg, #fff 10%, var(--accent) 70%, var(--accent2))",
          WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent",
        } : {}),
      }}>{fmt(animated)}</div>
    </div>
  );
}

function RevenueTrend({ records, delay = 0 }) {
  const { terms } = useConfig();
  const series = useMemo(() => {
    const byDate = {};
    records.forEach((r) => { byDate[r.date] = (byDate[r.date] || 0) + r.amount; });
    return Object.keys(byDate).sort().slice(-30).map((d) => ({ date: d, value: byDate[d] }));
  }, [records]);

  const lineRef = useRef(null);
  const W = 1000, H = 170, pad = 14;

  const geom = useMemo(() => {
    if (series.length === 0) return null;
    const vals = series.map((s) => s.value);
    const max = Math.max(...vals), min = Math.min(...vals, 0);
    const span = max - min || 1;
    const n = series.length;
    const xs = (i) => (n === 1 ? W / 2 : (i / (n - 1)) * (W - pad * 2) + pad);
    const ys = (v) => H - pad - ((v - min) / span) * (H - pad * 2);
    const pts = series.map((s, i) => [xs(i), ys(s.value)]);
    let d = "M" + pts[0][0] + "," + pts[0][1];
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], cx = (x0 + x1) / 2;
      d += " C" + cx + "," + y0 + " " + cx + "," + y1 + " " + x1 + "," + y1;
    }
    if (pts.length === 1) d += " L" + (pts[0][0] + 0.1) + "," + pts[0][1];
    return { line: d, fill: d + ` L${W - pad},${H} L${pad},${H} Z`, last: pts[pts.length - 1], max, total: vals.reduce((a, b) => a + b, 0) };
  }, [series]);

  useEffect(() => {
    const el = lineRef.current;
    if (!el || !el.getTotalLength) return;
    let len; try { len = el.getTotalLength(); } catch { return; }
    if (!len) return;
    const reduce = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    el.style.strokeDasharray = len; el.style.strokeDashoffset = len;
    el.getBoundingClientRect();
    el.style.transition = "stroke-dashoffset 1.3s cubic-bezier(.2,.8,.2,1)";
    if (typeof requestAnimationFrame !== "undefined") requestAnimationFrame(() => { el.style.strokeDashoffset = 0; });
  }, [geom]);

  return (
    <div className="rise lift" style={{
      background: C.card, border: "1px solid " + C.cardBorder, borderRadius: 18, padding: "20px 22px 8px",
      marginBottom: 28, position: "relative", overflow: "hidden", animationDelay: delay + "ms",
      boxShadow: "0 18px 44px rgba(0,0,0,0.32), inset 0 1px 0 rgba(255,255,255,0.05)",
    }}>
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none",
        background: "radial-gradient(420px 200px at 6% -30%, rgba(var(--accent-rgb),0.12), transparent 70%)" }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", position: "relative", zIndex: 1 }}>
        <div>
          <div style={{ fontSize: 11, color: C.textDim, letterSpacing: 1.4, textTransform: "uppercase", fontFamily: "'JetBrains Mono',monospace" }}>Revenue trend</div>
          <div style={{ fontSize: 13, color: C.textMuted, marginTop: 4 }}>
            {series.length === 0 ? `No ${terms.revenue.many.toLowerCase()} recorded yet` : `Across ${series.length} active ${series.length === 1 ? "day" : "days"}`}
          </div>
        </div>
        {geom && <div style={{ fontSize: 13, fontWeight: 700, color: C.accent, fontFamily: "'JetBrains Mono',monospace" }}>{fmt(geom.total)}</div>}
      </div>

      {geom ? (
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" height={H} style={{ marginTop: 6, display: "block" }} aria-label="Revenue trend line chart">
          <defs>
            <linearGradient id="rtfill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent2)" stopOpacity="0.34" />
              <stop offset="100%" stopColor="var(--accent2)" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="rtstroke" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="var(--accent2)" />
              <stop offset="100%" stopColor="var(--accent)" />
            </linearGradient>
          </defs>
          <path d={geom.fill} fill="url(#rtfill)" />
          <path ref={lineRef} d={geom.line} fill="none" stroke="url(#rtstroke)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx={geom.last[0]} cy={geom.last[1]} r="4.5" fill="var(--accent)" />
          <circle cx={geom.last[0]} cy={geom.last[1]} r="4.5" fill="var(--accent)" opacity="0.4">
            <animate attributeName="r" values="4.5;11;4.5" dur="2.2s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.4;0;0.4" dur="2.2s" repeatCount="indefinite" />
          </circle>
        </svg>
      ) : (
        <div style={{ height: H, display: "flex", alignItems: "center", justifyContent: "center", color: C.textMuted, fontSize: 13 }}>
          {`Your revenue trend will appear here once you log ${terms.revenue.many.toLowerCase()}.`}
        </div>
      )}
    </div>
  );
}

function SplitRing({ total, agency, chatter, delay = 0 }) {
  const creator = Math.max(0, total - agency - chatter);
  const sum = agency + chatter + creator || 1;
  const r = 52, circ = 2 * Math.PI * r;
  const segs = [
    { key: "creator", label: "Creators kept", val: creator, color: "#FBBF24" },
    { key: "chatter", label: "Chatters", val: chatter, color: "#A78BFA" },
    { key: "agency", label: "Agency (you)", val: agency, color: "var(--accent2)" },
  ];
  const [shown, setShown] = useState(false);
  useEffect(() => { const t = setTimeout(() => setShown(true), 120 + delay); return () => clearTimeout(t); }, [delay]);

  let before = 0;
  const arcs = segs.map((s) => {
    const len = (s.val / sum) * circ;
    const arc = { ...s, len, rot: (before / circ) * 360 - 90 };
    before += len;
    return arc;
  });
  const pct = (v) => (sum ? Math.round((v / sum) * 100) : 0);

  return (
    <div className="rise lift" style={{
      background: C.card, border: "1px solid " + C.cardBorder, borderRadius: 18, padding: "20px 22px",
      marginBottom: 28, animationDelay: delay + "ms",
      boxShadow: "0 18px 44px rgba(0,0,0,0.32), inset 0 1px 0 rgba(255,255,255,0.05)",
    }}>
      <div style={{ fontSize: 11, color: C.textDim, letterSpacing: 1.4, textTransform: "uppercase", fontFamily: "'JetBrains Mono',monospace", marginBottom: 2 }}>Where the money goes</div>
      <div style={{ fontSize: 13, color: C.textMuted, marginBottom: 16 }}>Split of {fmt(total)} gross</div>
      <div style={{ display: "flex", alignItems: "center", gap: 26, flexWrap: "wrap" }}>
        <svg width="128" height="128" viewBox="0 0 128 128" style={{ flex: "none" }} aria-label="Revenue split donut">
          <circle cx="64" cy="64" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="15" />
          {arcs.map((a, i) => (
            <circle key={a.key} cx="64" cy="64" r={r} fill="none" stroke={a.color} strokeWidth="15" strokeLinecap="round"
              transform={`rotate(${a.rot} 64 64)`}
              strokeDasharray={`${a.len} ${circ - a.len}`}
              strokeDashoffset={shown ? 0 : a.len}
              style={{ transition: `stroke-dashoffset 0.9s cubic-bezier(.2,.8,.2,1) ${i * 0.12}s` }} />
          ))}
        </svg>
        <div style={{ flex: "1 1 180px", display: "flex", flexDirection: "column", gap: 12 }}>
          {arcs.map((a) => (
            <div key={a.key} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
              <span style={{ width: 9, height: 9, borderRadius: 3, background: a.color, flex: "none" }} />
              <span style={{ color: C.textDim, flex: 1 }}>{a.label}</span>
              <span style={{ fontFamily: "'JetBrains Mono',monospace", color: C.textMuted, fontSize: 12, marginRight: 8 }}>{pct(a.val)}%</span>
              <span style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 600, color: a.color }}>{fmt(a.val)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
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

function EmptyState({ icon, text, sub, action }) {
  return (
    <div style={{
      textAlign: "center", padding: "48px 24px", color: C.textMuted,
      border: "1px dashed " + C.cardBorder, borderRadius: 16,
    }}>
      {icon && <div style={{ fontSize: 36, marginBottom: 12 }}>{icon}</div>}
      <div style={{ fontSize: 15, marginBottom: 6, color: C.textDim }}>{text}</div>
      {sub && <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 14 }}>{sub}</div>}
      {action}
    </div>
  );
}

function Avatar({ name, size }) {
  const s = size || 36;
  const h = ((name || "A").charCodeAt(0) * 7) % 360;
  return (
    <div style={{
      width: s, height: s, borderRadius: s * 0.28, flexShrink: 0,
      background: "linear-gradient(135deg, hsl(" + h + ",50%,42%), hsl(" + (h + 25) + ",40%,32%))",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: s * 0.42, fontWeight: 700, color: "#fff",
    }}>{(name || "?")[0].toUpperCase()}</div>
  );
}

function TabBar({ active, onChange }) {
  const { terms } = useConfig();
  const tabs = [
    { key: "Dashboard", label: "Dashboard" },
    { key: "Add Sales", label: "Add " + terms.revenue.one },
    { key: "Clients", label: terms.client.many },
    { key: "History", label: "History" },
  ];
  return (
    <div className="no-print" style={{
      display: "flex", gap: 10, marginBottom: 28, borderBottom: "1px solid var(--card-border)",
      paddingBottom: 12, overflowX: "auto",
    }}>
      {tabs.map((t) => (
        <button key={t.key} onClick={() => onChange(t.key)} style={{
          background: active === t.key ? "var(--accent-dim)" : "transparent",
          border: "1px solid " + (active === t.key ? "var(--accent-border)" : "transparent"),
          padding: "8px 16px", borderRadius: 10, color: active === t.key ? "var(--accent)" : "var(--text-dim)",
          cursor: "pointer", fontSize: 14, fontWeight: 600, transition: "all 0.2s",
          whiteSpace: "nowrap",
        }}>{t.label}</button>
      ))}
    </div>
  );
}

/* ── Share Card ── */
function ShareCard({ chatters: list, clientNameStr, date, onClose }) {
  const { business, terms } = useConfig();
  const isSingle = list.length === 1;
  const totalCut = sumMoney(list, (c) => c.chatterCut);
  const singlePercent = list[0]?.chatterCutPercent !== undefined ? (list[0].chatterCutPercent * 100).toFixed(1) + "%" : "";
  const uniquePercents = [...new Set(list.map((c) => c.chatterCutPercent))].filter((p) => p !== undefined);
  const displayPercentStr = uniquePercents.length === 1 ? ` (${(uniquePercents[0] * 100).toFixed(1)}%)` : "";

  return (
    <Modal open={true} onClose={onClose} title="Share Earnings">
      <div style={{
        background: "linear-gradient(160deg, var(--surface), var(--surface2))",
        borderRadius: 18, padding: "26px 28px", marginBottom: 18,
        border: "1px solid rgba(var(--accent-rgb),0.12)", position: "relative", overflow: "hidden",
      }}>
        <div style={{
          position: "absolute", top: -30, right: -30, width: 120, height: 120,
          borderRadius: "50%", background: "rgba(var(--accent-rgb),0.06)", filter: "blur(30px)",
        }} />
        <div style={{
          position: "absolute", bottom: -20, left: -20, width: 80, height: 80,
          borderRadius: "50%", background: "rgba(var(--accent-rgb),0.04)", filter: "blur(20px)",
        }} />

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
          {business.logo ? (
            <img src={business.logo} alt={business.name} style={{
              width: 32, height: 32, borderRadius: 9, objectFit: "contain",
              background: "rgba(0,0,0,0.15)",
            }} />
          ) : (
            <div style={{
              width: 32, height: 32, borderRadius: 9, display: "grid", placeItems: "center",
              background: "linear-gradient(145deg, var(--accent), var(--accent2))", color: "#04231b",
              fontWeight: 800, fontSize: 17,
            }}>{(business.name || "?").charAt(0).toUpperCase()}</div>
          )}
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>{business.name}</div>
            <div style={{ fontSize: 10, color: C.textMuted, fontFamily: "'JetBrains Mono',monospace", letterSpacing: 0.8 }}>EARNINGS REPORT</div>
          </div>
          <div style={{ marginLeft: "auto", fontSize: 11, color: C.textMuted, fontFamily: "'JetBrains Mono',monospace" }}>{date}</div>
        </div>

        {isSingle ? (
          <div>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: C.textDim, fontFamily: "'JetBrains Mono',monospace", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 4 }}>{terms.staff.one}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: "#fff" }}>{list[0].name}</div>
              <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>{clientNameStr}</div>
            </div>
            <div style={{
              background: "rgba(251,191,36,0.06)", borderRadius: 12, padding: "16px 18px",
              border: "1px solid rgba(251,191,36,0.08)",
            }}>
              <div style={{ fontSize: 10, color: C.textDim, fontFamily: "'JetBrains Mono',monospace", letterSpacing: 0.5, marginBottom: 4 }}>YOUR EARNINGS{singlePercent ? ` (${singlePercent})` : ""}</div>
              <div style={{ fontSize: 26, fontWeight: 700, color: C.earn }}>{fmt(list[0].chatterCut)}</div>
            </div>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 11, color: C.textDim, fontFamily: "'JetBrains Mono',monospace", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 12 }}>
              {clientNameStr || `All ${terms.client.many}`} — {terms.staff.one} Earnings{displayPercentStr}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
              {list.filter((c) => c.chatterCut > 0).map((c, i) => (
                <div key={i} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "10px 14px", background: "rgba(251,191,36,0.04)", borderRadius: 10,
                  border: "1px solid rgba(251,191,36,0.06)",
                }}>
                  <span style={{ fontWeight: 600, fontSize: 14, color: "#fff" }}>{c.name}</span>
                  <span style={{ fontWeight: 700, fontSize: 16, color: C.earn, fontFamily: "'JetBrains Mono',monospace" }}>{fmt(c.chatterCut)}</span>
                </div>
              ))}
            </div>
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "12px 14px", background: "rgba(var(--accent-rgb),0.05)", borderRadius: 10,
              border: "1px solid " + C.accentBorder,
            }}>
              <span style={{ fontWeight: 600, fontSize: 13, color: C.textDim }}>Total Payouts</span>
              <span style={{ fontWeight: 700, fontSize: 18, color: C.accent, fontFamily: "'JetBrains Mono',monospace" }}>{fmt(totalCut)}</span>
            </div>
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <Btn variant="secondary" onClick={onClose} style={{ flex: 1 }}>Close</Btn>
      </div>
      <p style={{ fontSize: 11, color: C.textMuted, textAlign: "center", marginTop: 10 }}>Take a screenshot to share with your chatters</p>
    </Modal>
  );
}

function InvoiceView({ record, client, onClose, customAmount, isPrinting, onDonePrinting, onOpenSettings }) {
  const { business, locale, invoice } = useConfig();
  if (!record || !client) return null;

  // An invoice needs the agency's own details. If they're missing, prompt to fill them
  // instead of generating a blank/unprofessional document.
  const missing = [];
  if (!business.name || !business.name.trim()) missing.push("business name");
  if (!(business.address && business.address.filter((l) => l && l.trim()).length)) missing.push("business address");
  if (missing.length) {
    return (
      <Modal open={true} onClose={onClose} title="Invoice Preview">
        <div style={{ textAlign: "center", padding: "26px 18px 10px" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🧾</div>
          <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Add your invoice details first</h3>
          <p style={{ fontSize: 13.5, color: C.textDim, lineHeight: 1.5, maxWidth: 380, margin: "0 auto 4px" }}>
            Your invoices are missing your {missing.join(" and ")}. Add them in Settings so the invoices you send look complete and professional.
          </p>
          <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 22 }}>
            <Btn variant="secondary" onClick={onClose}>Not now</Btn>
            <Btn onClick={() => { onClose?.(); onOpenSettings?.(); }}>Add details in Settings →</Btn>
          </div>
        </div>
      </Modal>
    );
  }

  const invNo = invoiceNumber(record, invoice);
  const dateStr = new Date(record.date + "T00:00:00").toLocaleDateString(locale.locale || "en-GB");
  const due = new Date(record.date + "T00:00:00");
  due.setDate(due.getDate() + (invoice.dueDays || 0));
  const dueStr = due.toLocaleDateString(locale.locale || "en-GB");
  const invAmount = money(customAmount ?? (() => { const s = computeShares(client, record.amount, record.hours || 0); return s.agencyShare + s.staffShare; })());
  const taxRate = Number(locale.taxRate) || 0;
  const tax = money(invAmount * taxRate);
  const total = money(invAmount + tax);

  useEffect(() => {
    if (isPrinting) {
      printElement("invoice-printable", "Invoice_" + invNo.replace(/\//g, "_"));
      onDonePrinting?.();
    }
  }, [isPrinting, invNo, onDonePrinting]);

  return (
    <Modal open={true} onClose={onClose} title="Invoice Preview">
      <div id="invoice-printable" style={{
        background: "#fff", color: "#000", padding: "40px", borderRadius: 4,
        fontFamily: "'Inter', sans-serif", width: "100%", maxWidth: "760px", margin: "0 auto",
        boxShadow: "0 0 20px rgba(0,0,0,0.1)", minHeight: "1000px", position: "relative",
        boxSizing: "border-box"
      }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 40 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {business.logo && <img src={business.logo} alt={business.name} style={{ width: 60, height: 60, marginBottom: 10, objectFit: "contain" }} />}
            <div style={{ fontSize: 16, fontWeight: 700 }}>{business.name}</div>
            {(business.address || []).map((line, i) => (
              <div key={i} style={{ fontSize: 13, color: "#444" }}>{line}</div>
            ))}
          </div>
          <div style={{ textAlign: "right", alignSelf: "flex-end" }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{client.name}</div>
            {locale.taxLine && <div style={{ fontSize: 13, color: "#444", marginTop: 8 }}>{locale.taxLine}</div>}
          </div>
        </div>

        {/* Invoice Info */}
        <div style={{ marginBottom: 30 }}>
          <h1 style={{ fontSize: 24, color: "#aaa", fontWeight: 400, marginBottom: 20 }}>{invoice.title} {invNo}</h1>
          <div style={{ display: "flex", gap: 60 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Invoice Date</div>
              <div style={{ fontSize: 13 }}>{dateStr}</div>
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Due Date</div>
              <div style={{ fontSize: 13 }}>{dueStr}</div>
            </div>
          </div>
        </div>

        {/* Table */}
        <div style={{ marginBottom: 30 }}>
          <div style={{ display: "flex", borderBottom: "1px solid #000", paddingBottom: 8, fontSize: 12, fontWeight: 700 }}>
            <div style={{ flex: 2 }}>Description</div>
            <div style={{ flex: 1, textAlign: "right" }}>Quantity</div>
            <div style={{ flex: 1, textAlign: "right" }}>Unit Price</div>
            <div style={{ flex: 1, textAlign: "right" }}>Amount</div>
          </div>
          <div style={{ display: "flex", padding: "12px 0", fontSize: 13, borderBottom: "1px solid #eee" }}>
            <div style={{ flex: 2 }}>
              <div style={{ fontWeight: 600 }}>{invoice.lineItemLabel} - {client.name}</div>
            </div>
            <div style={{ flex: 1, textAlign: "right" }}>1.00</div>
            <div style={{ flex: 1, textAlign: "right" }}>{fmt(invAmount)}</div>
            <div style={{ flex: 1, textAlign: "right" }}>{fmt(invAmount)}</div>
          </div>
        </div>

        {/* Summary */}
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <div style={{ width: "300px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, fontSize: 13 }}>
              <span>Untaxed Amount</span>
              <span>{fmt(invAmount)}</span>
            </div>
            {taxRate > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, fontSize: 13 }}>
                <span>{locale.taxLabel || "Tax"} ({(taxRate * 100).toFixed(taxRate * 100 % 1 ? 1 : 0)}%)</span>
                <span>{fmt(tax)}</span>
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, fontSize: 13, borderTop: "1px solid #000", paddingTop: 8 }}>
              <span>Total</span>
              <span>{fmt(total)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: 14 }}>
              <span>Amount Due</span>
              <span>{fmt(total)}</span>
            </div>
          </div>
        </div>

        {/* Bottom Text */}
        <div style={{ marginTop: 60 }}>
          {locale.amountInWords !== false && (
            <div style={{ fontSize: 12, fontStyle: "italic", marginBottom: 20 }}>
              {toWords(total)}
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
            <div style={{ fontSize: 12, color: "#444" }}>
              {invoice.notes ? "Notes: " + invoice.notes : ""}
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ width: "150px", borderBottom: "1px solid #000", marginBottom: 8 }}></div>
              <div style={{ fontSize: 12, fontWeight: 600 }}>{invoice.signatory}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="no-print" style={{ display: "flex", gap: 8, marginTop: 18 }}>
        <Btn variant="secondary" onClick={onClose} style={{ flex: 1 }}>Close</Btn>
        <Btn onClick={() => printElement("invoice-printable", "Invoice_" + invNo.replace(/\//g, "_"))} style={{ flex: 1 }}>📥 Save as PDF / Print</Btn>
      </div>
    </Modal>
  );
}

/* ═══ MAIN APP ═══ */

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
                <input type="number" value={r.upTo} onChange={(e) => set(i, { upTo: Number(e.target.value) || 0 })}
                  style={{ ...inpStyle, padding: "7px 8px 7px 18px", fontSize: 12 }} />
              </div>}
          <span style={{ color: C.textMuted }}>→</span>
          <div style={{ position: "relative", width: 78 }}>
            <input type="number" step="0.1" value={+((r.rate || 0) * 100).toFixed(4)} onChange={(e) => set(i, { rate: (Number(e.target.value) || 0) / 100 })}
              style={{ ...inpStyle, padding: "7px 18px 7px 8px", fontSize: 12 }} />
            <span style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", color: C.textMuted, fontSize: 11 }}>%</span>
          </div>
          <button type="button" onClick={() => removeRow(i)} aria-label="Remove tier" style={{ background: "none", border: "none", color: "rgba(239,68,68,0.5)", cursor: "pointer", fontSize: 13, padding: 2, visibility: rows.length > 1 ? "visible" : "hidden" }}>✖</button>
        </div>
      ))}
      <button type="button" onClick={addRow} style={{ alignSelf: "flex-start", background: "var(--accent-dim)", border: "1px solid var(--accent-border)", color: "var(--accent)", borderRadius: 7, padding: "5px 10px", cursor: "pointer", fontSize: 11, fontWeight: 600 }}>+ Tier</button>
    </div>
  );
}

function CommissionEditor({ value, onChange, symbol = "$" }) {
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
          <input type="number" step="0.1" style={inpStyle} value={+((v.rate || 0) * 100).toFixed(4)} onChange={(e) => onChange({ model: "percent", rate: (Number(e.target.value) || 0) / 100 })} />
          <span style={{ color: C.textDim, fontSize: 13 }}>%</span>
        </div>
      )}
      {v.model === "flat" && (
        <div style={inline}>
          <span style={{ color: C.textDim, fontSize: 13 }}>{symbol}</span>
          <input type="number" step="1" style={inpStyle} value={v.amount || 0} onChange={(e) => onChange({ model: "flat", amount: Number(e.target.value) || 0 })} />
          <span style={{ color: C.textMuted, fontSize: 12, whiteSpace: "nowrap" }}>per item</span>
        </div>
      )}
      {v.model === "hourly" && (
        <div style={inline}>
          <span style={{ color: C.textDim, fontSize: 13 }}>{symbol}</span>
          <input type="number" step="1" style={inpStyle} value={v.rate || 0} onChange={(e) => onChange({ model: "hourly", rate: Number(e.target.value) || 0 })} />
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
  <div className="rise" style={{ background: C.card, border: "1px solid " + C.cardBorder, borderRadius: 16, padding: "18px 20px", marginBottom: 16 }}>
    <div style={{ fontSize: 12, color: C.accent, fontFamily: "'JetBrains Mono',monospace", letterSpacing: 1, textTransform: "uppercase", marginBottom: 14 }}>{title}</div>
    {children}
  </div>
);
const SettingsRow = ({ children }) => <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>{children}</div>;

function SettingsPanel({ initial, onClose, onSave }) {
  const [d, setD] = useState(() => JSON.parse(JSON.stringify(initial)));
  const setB = (k, v) => setD((s) => ({ ...s, business: { ...s.business, [k]: v } }));
  const setL = (k, v) => setD((s) => ({ ...s, locale: { ...s.locale, [k]: v } }));
  const setBr = (k, v) => setD((s) => ({ ...s, branding: { ...s.branding, [k]: v } }));
  const setInv = (k, v) => setD((s) => ({ ...s, invoice: { ...s.invoice, [k]: v } }));
  const setTerm = (grp, sub, v) => setD((s) => ({ ...s, terms: { ...s.terms, [grp]: { ...s.terms[grp], [sub]: v } } }));
  const setTermFlat = (k, v) => setD((s) => ({ ...s, terms: { ...s.terms, [k]: v } }));

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
    out.invoice.fiscalYearStartMonth = Number(d.invoice.fiscalYearStartMonth) || 1;
    out.invoice.dueDays = Number(d.invoice.dueDays) || 0;
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
          <button onClick={onClose} aria-label="Close settings" style={{ background: "rgba(255,255,255,0.05)", border: "none", color: C.textMuted, width: 34, height: 34, borderRadius: 9, cursor: "pointer", fontSize: 15 }}>✖</button>
        </div>

        <SettingsSection title="Business">
          <Field label="Business name"><input style={inpStyle} value={d.business.name} onChange={(e) => setB("name", e.target.value)} /></Field>
          <Field label="Tagline"><input style={inpStyle} value={d.business.tagline} onChange={(e) => setB("tagline", e.target.value)} /></Field>
          <Field label="Logo URL (blank = use initial letter)"><input style={inpStyle} value={d.business.logo} onChange={(e) => setB("logo", e.target.value)} placeholder="/logo.svg or https://..." /></Field>
          <Field label="Address (one line per row, shown on invoices)">
            <textarea style={{ ...inpStyle, minHeight: 90, resize: "vertical", fontFamily: "'Outfit',sans-serif" }} value={addressStr} onChange={(e) => setB("address", e.target.value)} />
          </Field>
        </SettingsSection>

        <SettingsSection title="Branding">
          <Field label="Accent color">
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <input type="color" value={d.branding.accent} onChange={(e) => setBr("accent", e.target.value)}
                style={{ width: 48, height: 38, padding: 0, border: "1px solid rgba(255,255,255,0.12)", borderRadius: 9, background: "none", cursor: "pointer" }} />
              <input style={{ ...inpStyle, fontFamily: "'JetBrains Mono',monospace", textTransform: "uppercase" }} value={d.branding.accent} onChange={(e) => setBr("accent", e.target.value)} />
            </div>
            <div style={{ fontSize: 11, color: C.textMuted, marginTop: 6 }}>The whole app recolors to match. Lighter/darker shades are derived automatically.</div>
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
            <div style={half}><Field label="Currency code"><input style={inpStyle} value={d.locale.currency} onChange={(e) => setL("currency", e.target.value.toUpperCase())} placeholder="USD" /></Field></div>
            <div style={half}><Field label="Symbol"><input style={inpStyle} value={d.locale.currencySymbol} onChange={(e) => setL("currencySymbol", e.target.value)} placeholder="$" /></Field></div>
            <div style={half}><Field label="Locale"><input style={inpStyle} value={d.locale.locale} onChange={(e) => setL("locale", e.target.value)} placeholder="en-US" /></Field></div>
          </SettingsRow>
          <SettingsRow>
            <div style={half}><Field label="Tax label"><input style={inpStyle} value={d.locale.taxLabel} onChange={(e) => setL("taxLabel", e.target.value)} placeholder="VAT / GST" /></Field></div>
            <div style={half}><Field label="Tax rate (%)"><input type="number" step="0.1" style={inpStyle} value={(Number(d.locale.taxRate) || 0) * 100} onChange={(e) => setL("taxRate", (Number(e.target.value) || 0) / 100)} /></Field></div>
          </SettingsRow>
          <Field label="Tax line on invoice (optional)"><input style={inpStyle} value={d.locale.taxLine} onChange={(e) => setL("taxLine", e.target.value)} /></Field>
          <label style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13, color: C.textDim, cursor: "pointer", marginTop: 4 }}>
            <input type="checkbox" checked={d.locale.amountInWords !== false} onChange={(e) => setL("amountInWords", e.target.checked)} style={{ width: 16, height: 16, accentColor: "var(--accent)" }} />
            Show amount in words on invoices
          </label>
        </SettingsSection>

        <SettingsSection title="Invoice">
          <Field label="Invoice title"><input style={inpStyle} value={d.invoice.title} onChange={(e) => setInv("title", e.target.value)} /></Field>
          <SettingsRow>
            <div style={half}><Field label="Number format"><input style={{ ...inpStyle, fontFamily: "'JetBrains Mono',monospace" }} value={d.invoice.numberFormat} onChange={(e) => setInv("numberFormat", e.target.value)} /></Field></div>
            <div style={half}><Field label="Fiscal year start month"><input type="number" min="1" max="12" style={inpStyle} value={d.invoice.fiscalYearStartMonth} onChange={(e) => setInv("fiscalYearStartMonth", e.target.value)} /></Field></div>
          </SettingsRow>
          <div style={{ fontSize: 11, color: C.textMuted, marginTop: -6, marginBottom: 12 }}>Tokens: {"{FY} {YYYY} {YY} {MM} {SEQ}"}</div>
          <SettingsRow>
            <div style={half}><Field label="Line-item label"><input style={inpStyle} value={d.invoice.lineItemLabel} onChange={(e) => setInv("lineItemLabel", e.target.value)} /></Field></div>
            <div style={half}><Field label="Payment due (days)"><input type="number" min="0" style={inpStyle} value={d.invoice.dueDays} onChange={(e) => setInv("dueDays", e.target.value)} /></Field></div>
          </SettingsRow>
          <Field label="Notes"><input style={inpStyle} value={d.invoice.notes} onChange={(e) => setInv("notes", e.target.value)} /></Field>
          <Field label="Signatory"><input style={inpStyle} value={d.invoice.signatory} onChange={(e) => setInv("signatory", e.target.value)} /></Field>
        </SettingsSection>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 20 }}>
          <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
          <Btn onClick={save}>Save settings</Btn>
        </div>
      </div>
    </div>
  );
}

function Onboarding({ onComplete }) {
  const [step, setStep] = useState(0);
  const [type, setType] = useState("chatting");
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [symbol, setSymbol] = useState("$");
  const [accent, setAccent] = useState("#5EEAD4");
  const [terms, setTerms] = useState(AGENCY_PRESETS.chatting.terms);
  const [agencyDefault, setAgencyDefault] = useState({ model: "percent", rate: AGENCY_PRESETS.chatting.commission.agencyShare });
  const [staffDefault, setStaffDefault] = useState({ model: "percent", rate: AGENCY_PRESETS.chatting.commission.staffShare });
  const preset = AGENCY_PRESETS[type];

  const pickType = (k) => {
    setType(k);
    const p = AGENCY_PRESETS[k];
    setTerms(JSON.parse(JSON.stringify(p.terms)));
    setAgencyDefault({ model: "percent", rate: p.commission.agencyShare });
    setStaffDefault({ model: "percent", rate: p.commission.staffShare });
  };
  const setTerm = (grp, sub, v) => setTerms((s) => ({ ...s, [grp]: { ...s[grp], [sub]: v } }));

  const finish = () => {
    const base = JSON.parse(JSON.stringify(defaultConfig));
    base.business.name = name.trim() || preset.label;
    base.business.tagline = preset.tagline;
    base.business.logo = "";
    base.business.address = [];
    base.locale.currency = (currency.trim().toUpperCase()) || "USD";
    base.locale.currencySymbol = symbol || "$";
    base.branding.accent = accent;
    base.branding.accent2 = darken(accent, 0.12);
    base.branding.accent3 = darken(accent, 0.22);
    base.terms = terms;
    base.commission.defaults = { agency: agencyDefault, staff: staffDefault };
    base.invoice.lineItemLabel = preset.lineItemLabel;
    base.onboarded = true;
    onComplete(base);
  };

  const canNext = step === 0 ? !!type : step === 1 ? name.trim().length > 0 : true;
  const half = { flex: "1 1 150px", minWidth: 130 };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 2200, background: "var(--bg)",
      backgroundImage: "radial-gradient(900px 520px at 50% -10%, rgba(var(--accent-rgb),0.16), transparent 60%), radial-gradient(700px 600px at 50% 120%, rgba(167,139,250,0.10), transparent 55%)",
      overflowY: "auto", animation: "fadeIn 0.25s ease",
    }}>
      <div style={{ maxWidth: 560, margin: "0 auto", padding: "44px 22px 90px", minHeight: "100%" }}>
        {/* brand mark */}
        <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 30 }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, display: "grid", placeItems: "center", background: "linear-gradient(145deg, var(--accent), var(--accent2))", color: "#04231b", fontWeight: 800, fontSize: 20 }}>
            {(name || "A").charAt(0).toUpperCase()}
          </div>
          <div style={{ fontSize: 13, color: C.textDim, fontFamily: "'JetBrains Mono',monospace", letterSpacing: 1 }}>SET UP YOUR WORKSPACE</div>
        </div>

        {/* progress dots */}
        <div style={{ display: "flex", gap: 6, marginBottom: 26 }}>
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ height: 4, flex: 1, borderRadius: 99, background: i <= step ? "var(--accent)" : "rgba(255,255,255,0.08)", transition: "background .3s" }} />
          ))}
        </div>

        {step === 0 && (
          <div className="rise">
            <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 6 }}>What kind of agency do you run?</h2>
            <p style={{ fontSize: 13.5, color: C.textDim, marginBottom: 22 }}>This sets your wording and starting commission — you can change anything later.</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {Object.entries(AGENCY_PRESETS).map(([k, p]) => (
                <button key={k} onClick={() => pickType(k)} style={{
                  textAlign: "left", padding: "18px 18px", borderRadius: 14, cursor: "pointer",
                  background: type === k ? "var(--accent-dim)" : C.card,
                  border: "1px solid " + (type === k ? "var(--accent-border)" : C.cardBorder),
                  transition: "all .2s", color: "#fff",
                }}>
                  <div style={{ fontSize: 26, marginBottom: 8 }}>{p.icon}</div>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>{p.label}</div>
                  <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 3 }}>{p.terms.staff.many} · {p.terms.revenue.many}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="rise">
            <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 6 }}>Tell us about your agency</h2>
            <p style={{ fontSize: 13.5, color: C.textDim, marginBottom: 22 }}>Just the basics to brand your workspace.</p>
            <Field label="Agency name"><input style={inpStyle} value={name} autoFocus onChange={(e) => setName(e.target.value)} placeholder="e.g. Acme Studio" /></Field>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <div style={half}><Field label="Currency code"><input style={inpStyle} value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} placeholder="USD" /></Field></div>
              <div style={half}><Field label="Symbol"><input style={inpStyle} value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="$" /></Field></div>
            </div>
            <Field label="Brand color">
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <input type="color" value={accent} onChange={(e) => setAccent(e.target.value)} style={{ width: 48, height: 38, padding: 0, border: "1px solid rgba(255,255,255,0.12)", borderRadius: 9, background: "none", cursor: "pointer" }} />
                <input style={{ ...inpStyle, fontFamily: "'JetBrains Mono',monospace", textTransform: "uppercase" }} value={accent} onChange={(e) => setAccent(e.target.value)} />
              </div>
            </Field>
          </div>
        )}

        {step === 2 && (
          <div className="rise">
            <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 6 }}>Confirm your wording</h2>
            <p style={{ fontSize: 13.5, color: C.textDim, marginBottom: 22 }}>These labels appear throughout the app. Tweak if you like.</p>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <div style={half}><Field label="You call clients"><input style={inpStyle} value={terms.client.many} onChange={(e) => setTerm("client", "many", e.target.value)} /></Field></div>
              <div style={half}><Field label="You call staff"><input style={inpStyle} value={terms.staff.many} onChange={(e) => setTerm("staff", "many", e.target.value)} /></Field></div>
            </div>
            <Field label="You call revenue items"><input style={inpStyle} value={terms.revenue.many} onChange={(e) => setTerm("revenue", "many", e.target.value)} /></Field>
            <div style={{ height: 1, background: "rgba(255,255,255,0.06)", margin: "8px 0 16px" }} />
            <div style={{ fontSize: 12, color: C.accent, fontFamily: "'JetBrains Mono',monospace", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 10 }}>Default payout</div>
            <p style={{ fontSize: 12.5, color: C.textDim, marginBottom: 16 }}>How you and your {terms.staff.many.toLowerCase()} get paid — percentage, flat fee, tiered, or hourly. This is just the starting point for new {terms.client.many.toLowerCase()}; you can set it per {terms.client.one.toLowerCase()}.</p>
            <Field label={terms.agencyShareLabel}>
              <CommissionEditor value={agencyDefault} onChange={setAgencyDefault} symbol={symbol} />
            </Field>
            <Field label={terms.staffShareLabel}>
              <CommissionEditor value={staffDefault} onChange={setStaffDefault} symbol={symbol} />
            </Field>
            {(() => {
              const ex = 1000;
              const usesHours = agencyDefault.model === "hourly" || staffDefault.model === "hourly";
              const ag = computeShare(agencyDefault, ex, 10);
              const st = computeShare(staffDefault, ex, 10);
              return (
                <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 4, fontFamily: "'JetBrains Mono',monospace" }}>
                  e.g. on {symbol}{ex.toLocaleString()}{usesHours ? " · 10h" : ""}: you {symbol}{ag.toLocaleString()} · {terms.staff.one.toLowerCase()} {symbol}{st.toLocaleString()}
                </div>
              );
            })()}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 30 }}>
          <Btn variant="secondary" onClick={() => setStep((s) => Math.max(0, s - 1))} style={{ visibility: step === 0 ? "hidden" : "visible" }}>← Back</Btn>
          {step < 2
            ? <Btn onClick={() => setStep((s) => s + 1)} disabled={!canNext}>Continue →</Btn>
            : <Btn onClick={finish}>Enter dashboard →</Btn>}
        </div>
      </div>
    </div>
  );
}

function App() {
  const [data, setData] = useState(defaultState);
  const config = data.config || defaultConfig;
  setActiveCurrency(config.locale);
  const t = config.terms;
  const needsOnboarding = !config.onboarded
    && data.clients.length === 0 && data.chatters.length === 0 && data.records.length === 0;

  // Reflect the agency name in the browser tab.
  useEffect(() => {
    if (typeof document !== "undefined") document.title = config.business.name;
  }, [config.business.name]);
  const [tab, setTab] = useState("Dashboard");
  const [loading, setLoading] = useState(true);

  const [salesClientId, setSalesClientId] = useState("");
  const [salesDate, setSalesDate] = useState(today());
  const [bulkAmounts, setBulkAmounts] = useState({});
  const [bulkHours, setBulkHours] = useState({});
  const [savedFlash, setSavedFlash] = useState(false);

  // Modals
  const [addClientOpen, setAddClientOpen] = useState(false);
  const [addChatterOpen, setAddChatterOpen] = useState(false);
  const [chatterClientId, setChatterClientId] = useState("");
  const [editingClient, setEditingClient] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  // When the Add-Client modal opens, seed the commission from the agency's configured defaults.
  useEffect(() => {
    if (addClientOpen) {
      const dp = defaultCommissionParts(config);
      setNewAgencyPart(JSON.parse(JSON.stringify(dp.agency)));
      setNewStaffPart(JSON.parse(JSON.stringify(dp.staff)));
    }
  }, [addClientOpen]);

  // Forms
  const [newClientName, setNewClientName] = useState("");
  const [newAgencyPart, setNewAgencyPart] = useState({ model: "percent", rate: AGENCY_CUT });
  const [newStaffPart, setNewStaffPart] = useState({ model: "percent", rate: CHATTER_CUT });
  const [newChatterName, setNewChatterName] = useState("");
  const [editAgencyPart, setEditAgencyPart] = useState({ model: "percent", rate: AGENCY_CUT });
  const [editStaffPart, setEditStaffPart] = useState({ model: "percent", rate: CHATTER_CUT });

  // Sharing & Invoices
  const [shareCard, setShareCard] = useState(null);
  const [invoiceView, setInvoiceView] = useState(null);

  // Record edit + undo-delete
  const [editRecord, setEditRecord] = useState(null);
  const [editAmount, setEditAmount] = useState("");
  const [editDate, setEditDate] = useState("");
  const [lastDeleted, setLastDeleted] = useState(null);

  // Filters
  const [dashFilterDate, setDashFilterDate] = useState("all");
  const [filterClient, setFilterClient] = useState("all");
  const [filterChatter, setFilterChatter] = useState("all");
  const [filterMonth, setFilterMonth] = useState("all");

  // Smart Paste
  const [smartPasteOpen, setSmartPasteOpen] = useState(false);
  const [pastedText, setPastedText] = useState("");
  const [reviewItems, setReviewItems] = useState(null);

  // Refs & Voice
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef(null);
  const inputRefs = useRef({});
  const importRef = useRef(null);

  useEffect(() => {
    loadData().then((d) => {
      setData((prev) => ({
        clients: d?.clients ?? prev.clients,
        chatters: d?.chatters ?? prev.chatters,
        records: d?.records ?? prev.records,
        config: mergeConfig(d?.config),
      }));
      setLoading(false);
    });
  }, []);

  const persist = (d) => { setData(d); saveData(d); };

  // Populate the edit-commission fields whenever a client is opened for editing.
  useEffect(() => {
    if (editingClient) {
      const comm = clientCommission(editingClient);
      setEditAgencyPart(JSON.parse(JSON.stringify(comm.agency)));
      setEditStaffPart(JSON.parse(JSON.stringify(comm.staff)));
    }
  }, [editingClient]);

  // Populate edit fields when a sale record is opened.
  useEffect(() => {
    if (editRecord) {
      setEditAmount(String(editRecord.amount));
      setEditDate(editRecord.date);
    }
  }, [editRecord]);

  // Auto-dismiss the undo toast after a few seconds.
  useEffect(() => {
    if (!lastDeleted) return;
    const t = setTimeout(() => setLastDeleted(null), 6000);
    return () => clearTimeout(t);
  }, [lastDeleted]);

  const deleteRecord = (r) => {
    setLastDeleted(r);
    persist({ ...data, records: data.records.filter((x) => x.id !== r.id) });
  };

  const undoDelete = () => {
    if (!lastDeleted) return;
    persist({ ...data, records: [...data.records, lastDeleted] });
    setLastDeleted(null);
  };

  const updateRecord = () => {
    if (!editRecord) return;
    const amt = parseFloat(editAmount);
    if (isNaN(amt) || amt <= 0 || !editDate) return;
    // Recompute shares from the client's commission (handles %, flat, tiered, hourly).
    const chatter = data.chatters.find((c) => c.id === editRecord.chatterId);
    const client = data.clients.find((cl) => cl.id === (chatter && chatter.clientId));
    const { agencyShare, staffShare } = computeShares(client, amt, editRecord.hours || 0);
    const records = data.records.map((r) =>
      r.id === editRecord.id
        ? { ...r, amount: money(amt), date: editDate, agencyCut: agencyShare, chatterCut: staffShare }
        : r
    );
    persist({ ...data, records });
    setEditRecord(null);
  };

  // Build the persisted commission shape; keep legacy agencyCut/chatterCut for percent
  // so older percentage-based displays keep working.
  const clientCommFields = (agency, staff) => ({
    commission: { agency, staff },
    agencyCut: agency.model === "percent" ? (Number(agency.rate) || 0) : undefined,
    chatterCut: staff.model === "percent" ? (Number(staff.rate) || 0) : undefined,
  });

  const addClient = () => {
    const c = { id: genId(), name: newClientName, ...clientCommFields(newAgencyPart, newStaffPart) };
    persist({ ...data, clients: [...data.clients, c] });
    setNewClientName(""); setAddClientOpen(false);
  };

  const addChatter = () => {
    const c = { id: genId(), name: newChatterName, clientId: chatterClientId };
    persist({ ...data, chatters: [...data.chatters, c] });
    setNewChatterName(""); setAddChatterOpen(false);
  };

  const updateClientCuts = (id, agency, staff) => {
    const clients = data.clients.map((cl) => (cl.id === id ? { ...cl, ...clientCommFields(agency, staff) } : cl));
    persist({ ...data, clients }); setEditingClient(null);
  };

  const deleteItem = () => {
    if (!deleteConfirm) return;
    const { type, id } = deleteConfirm;
    if (type === "client") {
      persist({
        ...data,
        clients: data.clients.filter((cl) => cl.id !== id),
        chatters: data.chatters.filter((ch) => ch.clientId !== id),
        records: data.records.filter((r) => {
          const chatter = data.chatters.find((ch) => ch.id === r.chatterId);
          return chatter?.clientId !== id;
        })
      });
    } else {
      persist({ ...data, chatters: data.chatters.filter((c) => c.id !== id), records: data.records.filter((r) => r.chatterId !== id) });
    }
    setDeleteConfirm(null);
  };

  const setVal = (chatterId, idx, val) => {
    setBulkAmounts((prev) => {
      const curr = prev[chatterId] || [""];
      const next = [...curr]; next[idx] = val;
      if (idx === next.length - 1 && val !== "") next.push("");
      return { ...prev, [chatterId]: next };
    });
  };

  const removeField = (chatterId, idx) => {
    setBulkAmounts((prev) => {
      const curr = prev[chatterId] || [""];
      if (curr.length <= 1) return { ...prev, [chatterId]: [""] };
      const next = curr.filter((_, i) => i !== idx);
      return { ...prev, [chatterId]: next };
    });
  };

  const getVals = (cid) => bulkAmounts[cid] || [""];
  const chatterSum = (cid, arr) => sumMoney(arr || getVals(cid), (v) => parseFloat(v) || 0);

  const handleKeyDown = (e, cid, idx) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const val = getVals(cid)[idx];
      if (val === "") {
        const nextChatter = salesChatters[salesChatters.findIndex((c) => c.id === cid) + 1];
        if (nextChatter) { inputRefs.current[nextChatter.id + "-0"]?.focus(); }
      } else {
        setTimeout(() => { inputRefs.current[cid + "-" + (idx + 1)]?.focus(); }, 10);
      }
    }
  };

  const handleFormSubmit = (e, cid, idx) => { e.preventDefault(); handleKeyDown({ key: "Enter", preventDefault: () => {} }, cid, idx); };

  const saveBulkSales = () => {
    const newRecs = [];
    Object.entries(bulkAmounts).forEach(([cid, vals]) => {
      vals.forEach((v) => {
        const num = parseFloat(v);
        if (num > 0) {
          const chatter = data.chatters.find((c) => c.id === cid);
          const client = data.clients.find((cl) => cl.id === (chatter?.clientId));
          const hours = Number((bulkHours[cid] || [])[0]) || 0;
          const { agencyShare, staffShare } = computeShares(client, num, hours);
          const rec = { id: genId(), chatterId: cid, amount: money(num), date: salesDate, agencyCut: agencyShare, chatterCut: staffShare };
          if (hours) rec.hours = hours;
          newRecs.push(rec);
        }
      });
    });
    if (newRecs.length) { persist({ ...data, records: [...data.records, ...newRecs] }); setBulkAmounts({}); setBulkHours({}); setSavedFlash(true); setTimeout(() => setSavedFlash(false), 2500); }
  };

  const parseSales = () => {
    const res = {};
    const lines = pastedText.split("\n");
    
    // Regular expressions to filter out non-sales numbers
    const timeReg = /\b\d{1,2}:\d{2}(:\d{2})?(\s?[ap]m)?\b/gi;
    const dateReg1 = /\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/g;
    const dateReg2 = /\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/g;
    const dateReg3 = /\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*(\s+\d{2,4})?\b/gi;
    const dateReg4 = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{2,4}\b/gi;
    
    // Currency matching regexes (with and without prefix/suffix)
    const currencyPrefix = /([$£€¥]|rs\.?\s?|\busd\b|\beur\b|\bgbp\b|\binr\b)\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]+)?|[0-9]+(?:\.[0-9]+)?)/i;
    const currencySuffix = /([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]+)?|[0-9]+(?:\.[0-9]+)?)\s*([$£€¥]|rs\.?\s?|\busd\b|\beur\b|\bgbp\b|\binr\b)/i;
    const plainNumber = /([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]+)?|[0-9]+(?:\.[0-9]+)?)/;

    lines.forEach((l) => {
      // Clean up common dates and times from the line
      let cleaned = l.replace(timeReg, '')
                     .replace(dateReg1, '')
                     .replace(dateReg2, '')
                     .replace(dateReg3, '')
                     .replace(dateReg4, '');

      salesChatters.forEach((ch) => {
        const escapedName = ch.name.trim().replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        const nameReg = new RegExp(escapedName, 'i');
        const match = cleaned.match(nameReg);
        
        if (match) {
          const index = match.index;
          const beforeChar = index > 0 ? cleaned[index - 1] : '';
          const afterChar = index + match[0].length < cleaned.length ? cleaned[index + match[0].length] : '';
          
          const isAlphaNumeric = (char) => /[a-z0-9]/i.test(char);
          if (!isAlphaNumeric(beforeChar) && !isAlphaNumeric(afterChar)) {
            const textBefore = cleaned.slice(0, index);
            const textAfter = cleaned.slice(index + match[0].length);
            
            let parsedVal = null;
            
            const extractNum = (text) => {
              let m = text.match(currencyPrefix);
              if (m) return parseFloat(m[2].replace(/,/g, ''));
              
              m = text.match(currencySuffix);
              if (m) return parseFloat(m[1].replace(/,/g, ''));
              
              m = text.match(plainNumber);
              if (m) return parseFloat(m[1].replace(/,/g, ''));
              
              return null;
            };
            
            parsedVal = extractNum(textAfter);
            if (parsedVal === null) {
              parsedVal = extractNum(textBefore);
            }
            
            if (parsedVal !== null && !isNaN(parsedVal)) {
              if (!res[ch.id]) res[ch.id] = { sum: 0, count: 0 };
              res[ch.id].sum += parsedVal;
              res[ch.id].count += 1;
            }
          }
        }
      });
    });
    const items = Object.entries(res)
      .map(([id, o]) => ({ id, name: chatterNameFn(id), amount: o.sum, count: o.count, included: true }))
      .sort((a, b) => b.amount - a.amount);
    setReviewItems(items);
  };

  const setReviewAmount = (id, val) =>
    setReviewItems((items) => items.map((it) => (it.id === id ? { ...it, amount: val } : it)));
  const toggleReviewItem = (id) =>
    setReviewItems((items) => items.map((it) => (it.id === id ? { ...it, included: !it.included } : it)));

  const applyParsed = () => {
    if (!reviewItems) return;
    const next = { ...bulkAmounts };
    reviewItems.forEach((it) => {
      const num = parseFloat(it.amount);
      if (it.included && !isNaN(num) && num > 0) next[it.id] = [String(num), ""];
    });
    setBulkAmounts(next); setReviewItems(null); setPastedText(""); setSmartPasteOpen(false);
  };

  const toggleVoice = () => {
    if (isListening) { recognitionRef.current?.stop(); setIsListening(false); return; }
    const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Speech) { alert("Voice not supported"); return; }
    const rec = new Speech(); rec.continuous = true; rec.interimResults = false; rec.lang = "en-US";
    rec.onresult = (e) => {
      const last = e.results[e.results.length - 1][0].transcript.toLowerCase();
      salesChatters.forEach((ch) => {
        const escapedName = ch.name.trim().replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        const nameReg = new RegExp(escapedName, 'i');
        const match = last.match(nameReg);
        if (match) {
          const index = match.index;
          const beforeChar = index > 0 ? last[index - 1] : '';
          const afterChar = index + match[0].length < last.length ? last[index + match[0].length] : '';
          
          const isAlphaNumeric = (char) => /[a-z0-9]/i.test(char);
          if (!isAlphaNumeric(beforeChar) && !isAlphaNumeric(afterChar)) {
            const textBefore = last.slice(0, index);
            const textAfter = last.slice(index + match[0].length);
            
            let numMatch = textAfter.match(/([0-9]+)/);
            if (!numMatch) {
              numMatch = textBefore.match(/([0-9]+)/);
            }
            if (numMatch) {
              setVal(ch.id, getVals(ch.id).length - 1, numMatch[1]);
            }
          }
        }
      });
    };
    rec.start(); recognitionRef.current = rec; setIsListening(true);
  };

  const exportCSV = (recs) => {
    const esc = (v) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const headers = [t.staff.one, t.client.one, "Date", "Total Amount", t.agencyShareLabel, t.staffShareLabel];
    const rows = recs.map((r) => [chatterNameFn(r.chatterId), clientNameFn(chatterClientFn(r.chatterId)), r.date, r.amount, r.agencyCut, r.chatterCut]);
    const csv = [headers, ...rows].map((r) => r.map(esc).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `sales_report_${today()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const exportBackup = () => {
    const payload = JSON.stringify({ _app: "agencyx-tracker", _version: 5, _exportedAt: new Date().toISOString(), ...data }, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const slug = (config.business.name || "agencyx").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "agencyx";
    const a = document.createElement("a"); a.href = url; a.download = `${slug}-backup-${today()}.json`; a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const p = JSON.parse(reader.result);
        if (!p || !Array.isArray(p.clients) || !Array.isArray(p.chatters) || !Array.isArray(p.records)) {
          alert("That file isn't a valid backup — it should contain clients, chatters and records."); return;
        }
        const ok = window.confirm(
          `Import ${p.clients.length} clients, ${p.chatters.length} chatters and ${p.records.length} sales?\n\nThis replaces everything currently in the app. Export a backup first if you're unsure.`
        );
        if (!ok) return;
        persist({ clients: p.clients, chatters: p.chatters, records: p.records, config: mergeConfig(p.config) });
      } catch {
        alert("Couldn't read that file — make sure it's a JSON backup exported from this app.");
      } finally {
        e.target.value = "";
      }
    };
    reader.readAsText(file);
  };

  const printReport = () => { printElement("history-printable", "Sales_History_" + today()); };

  const salesChatters = data.chatters.filter((c) => salesClientId === "all" || c.clientId === salesClientId);
  const dashRecs = data.records.filter((r) => dashFilterDate === "all" || r.date === dashFilterDate);
  const totalSales = sumMoney(dashRecs, (r) => r.amount);
  const totalAgency = sumMoney(dashRecs, (r) => r.agencyCut);
  const totalChatterPay = sumMoney(dashRecs, (r) => r.chatterCut);

  const sym = config.locale.currencySymbol || "$";
  const agLabelsSet = [...new Set(data.clients.map((cl) => partLabel(clientCommission(cl).agency, sym)))];
  const chLabelsSet = [...new Set(data.clients.map((cl) => partLabel(clientCommission(cl).staff, sym)))];
  const agencyCutLabel = data.clients.length && agLabelsSet.length === 1 ? `${t.agencyShareLabel} · ${agLabelsSet[0]}` : t.agencyShareLabel;
  const chatterCutLabel = data.clients.length && chLabelsSet.length === 1 ? `${t.staffShareLabel} · ${chLabelsSet[0]}` : t.staffShareLabel;

  const clientStats = data.clients.map((cl) => {
    const recs = data.records.filter((r) => (dashFilterDate === "all" || r.date === dashFilterDate) && data.chatters.find((c) => c.id === r.chatterId)?.clientId === cl.id);
    return { id: cl.id, name: cl.name, agencyCut: cl.agencyCut, chatterCut: cl.chatterCut, total: sumMoney(recs, (r) => r.amount), agency: sumMoney(recs, (r) => r.agencyCut), chatterPay: sumMoney(recs, (r) => r.chatterCut), chatterCount: data.chatters.filter((c) => c.clientId === cl.id).length };
  });

  const chatterStats = data.chatters.map((ch) => {
    const recs = data.records.filter((r) => (dashFilterDate === "all" || r.date === dashFilterDate) && r.chatterId === ch.id);
    return { id: ch.id, name: ch.name, clientId: ch.clientId, total: sumMoney(recs, (r) => r.amount), agency: sumMoney(recs, (r) => r.agencyCut), chatterPay: sumMoney(recs, (r) => r.chatterCut), count: recs.length };
  });

  const clientNameFn = (id) => data.clients.find((c) => c.id === id)?.name || "Unknown";
  const chatterNameFn = (id) => data.chatters.find((c) => c.id === id)?.name || "Unknown";
  const chatterClientFn = (id) => data.chatters.find((c) => c.id === id)?.clientId;

  const bulkTotal = fromCents(Object.entries(bulkAmounts).reduce((acc, [cid, vals]) => acc + toCents(chatterSum(cid, vals)), 0));
  const bulkHas = bulkTotal > 0;

  const bulkAgencyTotal = fromCents(Object.entries(bulkAmounts).reduce((acc, [cid, vals]) => {
    const chatter = data.chatters.find((c) => c.id === cid);
    const client = data.clients.find((cl) => cl.id === chatter?.clientId);
    const hrs = Number((bulkHours[cid] || [])[0]) || 0;
    return acc + toCents(computeShares(client, chatterSum(cid, vals), hrs).agencyShare);
  }, 0));

  const bulkChatterTotal = fromCents(Object.entries(bulkAmounts).reduce((acc, [cid, vals]) => {
    const chatter = data.chatters.find((c) => c.id === cid);
    const client = data.clients.find((cl) => cl.id === chatter?.clientId);
    const hrs = Number((bulkHours[cid] || [])[0]) || 0;
    return acc + toCents(computeShares(client, chatterSum(cid, vals), hrs).staffShare);
  }, 0));

  const batchCuts = salesChatters.filter((c) => chatterSum(c.id) > 0).map((c) => {
    const cl = data.clients.find((x) => x.id === c.clientId);
    const comm = clientCommission(cl);
    return { ag: partLabel(comm.agency, sym), ch: partLabel(comm.staff, sym) };
  });
  const uniqueBatchAgCuts = [...new Set(batchCuts.map((c) => c.ag))];
  const uniqueBatchChCuts = [...new Set(batchCuts.map((c) => c.ch))];

  const batchAgLabel = uniqueBatchAgCuts.length === 1 ? `${t.agencyShareLabel} (${uniqueBatchAgCuts[0]})` : t.agencyShareLabel;
  const batchChLabel = uniqueBatchChCuts.length === 1 ? `${t.staffShareLabel} (${uniqueBatchChCuts[0]})` : t.staffShareLabel;

  const filteredRecords = data.records.filter((r) => {
    const chatter = data.chatters.find((c) => c.id === r.chatterId);
    if (filterClient !== "all" && chatter?.clientId !== filterClient) return false;
    if (filterChatter !== "all" && r.chatterId !== filterChatter) return false;
    if (filterMonth !== "all") {
      const m = new Date(r.date + "T00:00:00").toLocaleString("default", { month: "long", year: "numeric" });
      if (m !== filterMonth) return false;
    }
    return true;
  }).sort((a, b) => b.date.localeCompare(a.date));

  const months = [...new Set(data.records.map((r) => new Date(r.date + "T00:00:00").toLocaleString("default", { month: "long", year: "numeric" })))];

  // Loader: keep the splash up briefly so it reads as intentional, then fade out.
  const [bootDone, setBootDone] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const saveConfig = (c) => { persist({ ...data, config: mergeConfig(c) }); setSettingsOpen(false); };
  const [loaderGone, setLoaderGone] = useState(false);
  useEffect(() => { const t = setTimeout(() => setBootDone(true), 900); return () => clearTimeout(t); }, []);
  const ready = !loading && bootDone;
  useEffect(() => { if (ready) { const t = setTimeout(() => setLoaderGone(true), 520); return () => clearTimeout(t); } }, [ready]);

  return (
    <ConfigContext.Provider value={config}>
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "#fff", fontFamily: "'Outfit',sans-serif" }}>

      <style>
        {`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap');
        :root {
          --accent: ${config.branding.accent};
          --accent2: ${config.branding.accent2};
          --accent3: ${config.branding.accent3};
          --accent-rgb: ${hexToRgb(config.branding.accent)};
          --accent-glow: rgba(${hexToRgb(config.branding.accent)}, 0.14);
          --accent-dim: rgba(${hexToRgb(config.branding.accent)}, 0.08);
          --accent-border: rgba(${hexToRgb(config.branding.accent)}, 0.16);
          --bg: ${THEME.bg};
          --card-bg: ${THEME.card};
          --card-border: ${THEME.cardBorder};
          --text-dim: ${THEME.textDim};
          --text-muted: ${THEME.textMuted};
          --earn: ${THEME.earn};
          --violet: ${THEME.violet};
          --surface: ${THEME.surface};
          --surface2: ${THEME.surface2};
          --blur: ${THEME.blur};
        }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          background: var(--bg);
          background-image:
            radial-gradient(900px 520px at 10% -10%, rgba(52,211,153,0.13), transparent 60%),
            radial-gradient(820px 560px at 105% 12%, rgba(167,139,250,0.10), transparent 55%),
            radial-gradient(760px 700px at 50% 118%, rgba(var(--accent-rgb),0.05), transparent 60%);
          background-attachment: fixed;
          min-height: 100vh; font-family: 'Outfit', sans-serif; color: #fff;
        }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.6; } 100% { opacity: 1; } }
        @keyframes riseIn { from { opacity: 0; transform: translateY(16px) scale(0.985); } to { opacity: 1; transform: translateY(0) scale(1); } }
        @keyframes shimmer { 100% { transform: translateX(100%); } }
        @keyframes auroraSpin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        @keyframes ringGrow { from { stroke-dashoffset: var(--circ); } }
        @keyframes loaderGlow { 0%,100% { box-shadow: 0 10px 40px rgba(52,211,153,0.35), inset 0 1px 0 rgba(255,255,255,0.5); } 50% { box-shadow: 0 14px 60px rgba(var(--accent-rgb),0.6), inset 0 1px 0 rgba(255,255,255,0.6); } }
        @keyframes loaderFloat { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
        @keyframes barSweep { 0% { left: -40%; } 100% { left: 100%; } }
        @keyframes spinIn { from { transform: rotate(-120deg) scale(0.6); opacity: 0; } to { transform: rotate(0) scale(1); opacity: 1; } }
        .rise { opacity: 0; animation: riseIn 0.55s cubic-bezier(.2,.8,.2,1) forwards; }
        .lift { transition: transform .28s cubic-bezier(.2,.8,.2,1), box-shadow .28s ease, border-color .28s ease; }
        .lift:hover { transform: translateY(-3px); box-shadow: 0 22px 46px rgba(0,0,0,0.42), inset 0 1px 0 rgba(255,255,255,0.08); border-color: var(--accent-border); }
        .btnp:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 10px 32px rgba(var(--accent-rgb),0.42), inset 0 1px 0 rgba(255,255,255,0.5); filter: brightness(1.04); }
        .btnp:active:not(:disabled) { transform: translateY(0); }
        .btns:hover:not(:disabled) { background: rgba(255,255,255,0.07); color: rgba(255,255,255,0.85); }
        .chrow { transition: background .2s ease, border-color .2s ease; }
        .chrow:hover { background: rgba(var(--accent-rgb),0.05) !important; border-color: var(--accent-border) !important; }
        .recrow { transition: background .18s ease; }
        .recrow:hover { background: rgba(var(--accent-rgb),0.035) !important; }
        .glass { backdrop-filter: var(--blur); -webkit-backdrop-filter: var(--blur); }
        :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }
        @media (prefers-reduced-motion: reduce) {
          *, *::before, *::after { animation-duration: 0.001ms !important; animation-iteration-count: 1 !important; transition-duration: 0.001ms !important; scroll-behavior: auto !important; }
          .rise { opacity: 1 !important; }
        }
        input[type="number"]::-webkit-inner-spin-button,
        input[type="number"]::-webkit-outer-spin-button { -webkit-appearance: none; }
        input[type="number"] { -moz-appearance: textfield; }

        @media print {
          @page { margin: 0; }
          body { margin: 20mm !important; background: #fff !important; color: #000 !important; font-size: 11pt; }
          .no-print, .no-print-modal-overlay { display: none !important; }
          .print-only { display: block !important; }
          #invoice-printable { 
            display: block !important;
            position: absolute;
            left: 0;
            top: 0;
            width: 100% !important;
            margin: 0 auto !important;
            padding: 40px !important;
            background: #fff !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .card, div:not(#invoice-printable), span, h1, h2, h3, p { background: transparent !important; color: #000 !important; box-shadow: none !important; }
          .card { border: 1px solid #eee !important; break-inside: avoid; }
          img { filter: grayscale(100%); }
        }
        .print-only { display: none; }
        ::-webkit-scrollbar { width: 5px; height: 5px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(var(--accent-rgb),0.1); border-radius: 3px; }

        @media (max-width: 640px) {
          .mobile-stack { flex-direction: column !important; align-items: stretch !important; }
          .mobile-hide { display: none !important; }
          .mobile-grid { grid-template-columns: 1fr !important; }
          .mobile-grid-2 { grid-template-columns: 1fr 1fr !important; }
          .mobile-p-small { padding: 12px 14px !important; }
          .mobile-font-small { font-size: 13px !important; }
          .mobile-mb-none { margin-bottom: 0 !important; }
          .mobile-scroll-x { overflow-x: auto !important; -webkit-overflow-scrolling: touch; }
        }
        `}
      </style>

      {/* Boot loader */}
      {!loaderGone && (
        <div aria-hidden="true" style={{
          position: "fixed", inset: 0, zIndex: 3000, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", gap: 26,
          background: "var(--bg)",
          backgroundImage: "radial-gradient(800px 500px at 50% 30%, rgba(52,211,153,0.14), transparent 60%), radial-gradient(700px 600px at 50% 120%, rgba(167,139,250,0.10), transparent 55%)",
          opacity: ready ? 0 : 1, transform: ready ? "scale(1.04)" : "scale(1)",
          transition: "opacity 0.5s ease, transform 0.5s ease", pointerEvents: ready ? "none" : "auto",
        }}>
          <div style={{
            width: 76, height: 76, borderRadius: 22, display: "grid", placeItems: "center",
            background: "linear-gradient(145deg, var(--accent), var(--accent2))", color: "#04231b",
            fontWeight: 800, fontSize: 40, fontFamily: "'Outfit',sans-serif",
            animation: "spinIn 0.6s cubic-bezier(.2,.8,.2,1), loaderGlow 2.4s ease-in-out 0.6s infinite, loaderFloat 3s ease-in-out 0.6s infinite",
          }}>{(config.business.name || "?").charAt(0).toUpperCase()}</div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 19, fontWeight: 700, letterSpacing: -0.3 }}>{config.business.name}</div>
            <div style={{ fontSize: 10, letterSpacing: 2, color: "var(--text-muted)", fontFamily: "'JetBrains Mono',monospace", textTransform: "uppercase", marginTop: 4 }}>{config.business.tagline}</div>
          </div>
          <div style={{ width: 180, height: 3, borderRadius: 99, background: "rgba(255,255,255,0.06)", overflow: "hidden", position: "relative" }}>
            <div style={{ position: "absolute", top: 0, width: "40%", height: "100%", borderRadius: 99,
              background: "linear-gradient(90deg, transparent, var(--accent), transparent)",
              animation: "barSweep 1.1s ease-in-out infinite" }} />
          </div>
        </div>
      )}

      <div className="no-print" style={{
        borderBottom: "1px solid var(--card-border)", padding: "12px 0",
        background: "rgba(10,13,11,0.9)", backdropFilter: "var(--blur)",
        position: "sticky", top: 0, zIndex: 100,
      }}>
        <div style={{ maxWidth: 1020, margin: "0 auto", padding: "0 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {config.business.logo ? (
              <img src={config.business.logo} alt={config.business.name} style={{
                width: 32, height: 32, borderRadius: 9,
                boxShadow: "0 4px 16px rgba(var(--accent-rgb),0.15)",
                objectFit: "contain", background: "rgba(0,0,0,0.15)",
              }} />
            ) : (
              <div style={{
                width: 32, height: 32, borderRadius: 9, display: "grid", placeItems: "center",
                background: "linear-gradient(145deg, var(--accent), var(--accent2))", color: "#04231b",
                fontWeight: 800, fontSize: 17, fontFamily: "'Outfit',sans-serif",
              }}>{(config.business.name || "?").charAt(0).toUpperCase()}</div>
            )}
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: -0.3 }}>{config.business.name}</div>
              <div className="mobile-hide" style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: "'JetBrains Mono',monospace", letterSpacing: 1 }}>{config.business.tagline}</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div style={{ display: "flex", gap: 5 }}>
              <Badge>{data.clients.length} <span className="mobile-hide">{t.client.many.toLowerCase()}</span></Badge>
              <Badge>{data.chatters.length} <span className="mobile-hide">{t.staff.many.toLowerCase()}</span></Badge>
            </div>
            <button onClick={() => setSettingsOpen(true)} aria-label="Settings" title="Settings" style={{
              background: "rgba(255,255,255,0.05)", border: "1px solid var(--card-border)", color: C.textDim,
              width: 32, height: 32, borderRadius: 9, cursor: "pointer", fontSize: 15, display: "grid", placeItems: "center",
            }}>⚙</button>
          </div>
        </div>
      </div>

      <div className="no-print" style={{ maxWidth: 1020, margin: "0 auto", padding: "28px 20px 60px" }}>
        <TabBar active={tab} onChange={setTab} />

        {/* ═══ DASHBOARD ═══ */}
        {tab === "Dashboard" && (
          <div style={{ animation: "slideUp 0.3s ease" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 10 }}>
              <h2 style={{ fontSize: 21, fontWeight: 700 }}>Analytics</h2>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 13, color: "var(--text-dim)" }}>Filter:</span>
                <input
                  type="date"
                  value={dashFilterDate === "all" ? "" : dashFilterDate}
                  onChange={(e) => setDashFilterDate(e.target.value || "all")} aria-label="Filter dashboard by date"
                  style={{
                    padding: "7px 12px", background: "var(--surface)", border: "1px solid rgba(255,255,255,0.06)",
                    borderRadius: 9, color: "#fff", fontSize: 13, fontFamily: "'Outfit',sans-serif", cursor: "pointer"
                  }}
                />
                <button
                  onClick={() => setDashFilterDate("all")}
                  style={{
                    padding: "7px 12px", background: dashFilterDate === "all" ? "var(--accent-dim)" : "transparent",
                    border: "1px solid " + (dashFilterDate === "all" ? "var(--accent-border)" : "rgba(255,255,255,0.06)"),
                    borderRadius: 9, color: dashFilterDate === "all" ? "var(--accent)" : "var(--text-dim)", fontSize: 13,
                    fontFamily: "'Outfit',sans-serif", cursor: "pointer"
                  }}
                >All Time</button>
              </div>
            </div>

            <div className="mobile-grid" style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 28 }}>
              <StatCard label={`Total ${t.revenue.many}`} amount={totalSales} accent="var(--accent-glow)" gradient delay={0} />
              <StatCard label={agencyCutLabel} amount={totalAgency} accent="rgba(var(--accent-rgb),0.08)" delay={70} />
              <StatCard label={chatterCutLabel} amount={totalChatterPay} accent="rgba(167,139,250,0.10)" delay={140} />
            </div>

            <RevenueTrend records={data.records} delay={180} />

            {totalSales > 0 && <SplitRing total={totalSales} agency={totalAgency} chatter={totalChatterPay} delay={220} />}

            <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--text-dim)", marginBottom: 14, letterSpacing: 0.5 }}>By {t.client.one}</h3>
            {clientStats.length === 0 ? (
              <EmptyState icon="📌" text={`No ${t.client.many.toLowerCase()} yet`} sub={`Add ${t.client.many.toLowerCase()} in the ${t.client.many} tab`} action={<Btn variant="secondary" onClick={() => setTab("Clients")}>Go to {t.client.many} →</Btn>} />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {clientStats.sort((a, b) => b.total - a.total).map((cl) => {
                  const clChatters = chatterStats.filter((ch) => ch.clientId === cl.id).sort((a, b) => b.total - a.total);
                  return (
                    <div key={cl.id} className="mobile-p-small" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)", borderRadius: 13, padding: "14px 18px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <Avatar name={cl.name} size={32} />
                          <div>
                            <span style={{ fontWeight: 600, fontSize: 14 }}>{cl.name}</span>
                            <span style={{ color: "var(--text-muted)", fontSize: 12, marginLeft: 8 }}>{cl.chatterCount} chatters</span>
                          </div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontWeight: 700, fontSize: 16, color: "var(--accent)" }}>{fmt(cl.total)}</span>
                          {cl.total > 0 && (
                            <button onClick={() => setInvoiceView({
                              record: { id: "agg-" + cl.id, amount: cl.total, date: dashFilterDate === "all" ? today() : dashFilterDate },
                              client: cl,
                              customAmount: cl.agency + cl.chatterPay
                            })} style={{
                              background: C.accentDim, border: "none", borderRadius: 6, color: C.accent,
                              fontSize: 10, padding: "4px 8px", cursor: "pointer", fontWeight: 600,
                              fontFamily: "'JetBrains Mono',monospace",
                            }}>📄 Invoice</button>
                          )}
                          {clChatters.some((ch) => ch.chatterPay > 0) && (
                            <button onClick={() => setShareCard({
                              chatters: clChatters.filter((ch) => ch.chatterPay > 0).map((ch) => {
                                return {
                                  name: ch.name,
                                  chatterCut: ch.chatterPay,
                                  chatterCutPercent: (() => { const sp = clientCommission(cl).staff; return sp.model === "percent" ? sp.rate : undefined; })()
                                };
                              }),
                              clientNameStr: cl.name, date: "All Time",
                            })} style={{
                              background: C.accentDim, border: "none", borderRadius: 6, color: C.accent,
                              fontSize: 10, padding: "4px 10px", cursor: "pointer", fontWeight: 600,
                              fontFamily: "'JetBrains Mono',monospace",
                            }}>Share All</button>
                          )}
                        </div>
                      </div>
                      {clChatters.map((ch) => (
                        <div key={ch.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0 7px 42px", fontSize: 13 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ color: "rgba(255,255,255,0.55)" }}>{ch.name}</span>
                            <span style={{ color: C.textMuted, fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>({ch.count})</span>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, color: C.accent }}>{fmt(ch.total)}</span>
                            <span style={{ color: C.textMuted }}>·</span>
                            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: C.accent2 }}>{fmt(ch.agency)}</span>
                            <span style={{ color: C.textMuted }}>·</span>
                            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: C.earn }}>{fmt(ch.chatterPay)}</span>
                            {ch.chatterPay > 0 && (
                              <button onClick={() => setShareCard({
                                chatters: [{
                                  name: ch.name,
                                  chatterCut: ch.chatterPay,
                                  chatterCutPercent: (() => { const sp = clientCommission(data.clients.find((cl) => cl.id === ch.clientId)).staff; return sp.model === "percent" ? sp.rate : undefined; })()
                                }],
                                clientNameStr: clientNameFn(ch.clientId), date: "All Time",
                              })} style={{
                                background: C.accentDim, border: "none", borderRadius: 5, color: C.accent,
                                fontSize: 10, padding: "2px 7px", cursor: "pointer", fontWeight: 600,
                                fontFamily: "'JetBrains Mono',monospace", marginLeft: 4,
                              }}>Share</button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ═══ ADD SALES ═══ */}
        {tab === "Add Sales" && (
          <div style={{ animation: "slideUp 0.3s ease" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24, flexWrap: "wrap", gap: 16 }}>
              <div style={{ flex: "1 1 200px" }}>
                <h2 style={{ fontSize: 21, fontWeight: 700, marginBottom: 3 }}>Record {t.revenue.many}</h2>
                <p style={{ color: C.textDim, fontSize: 13 }}>Type amount → Enter adds more. Enter on empty → next chatter.</p>
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap", flex: "1 1 auto", justifyContent: "flex-end" }} className="mobile-stack">
                <Btn
                  variant={isListening ? "primary" : "secondary"}
                  onClick={toggleVoice}
                  style={{
                    marginBottom: 14, fontSize: 12, padding: "8px 16px",
                    background: isListening ? "rgba(239,68,68,0.2)" : undefined,
                    color: isListening ? "#ef4444" : undefined,
                    border: isListening ? "1px solid rgba(239,68,68,0.3)" : undefined,
                    animation: isListening ? "pulse 1.5s infinite" : undefined,
                  }}
                >
                  {isListening ? "🛑 Stop Voice" : "🎙️ Voice Mode"}
                </Btn>
                <Btn variant="secondary" onClick={() => setSmartPasteOpen(true)} style={{ marginBottom: 14, fontSize: 12, padding: "8px 16px" }}>✨ Smart Paste</Btn>
                <Field label="Client">
                  <select value={salesClientId} aria-label="Select client for sales entry" onChange={(e) => setSalesClientId(e.target.value)} style={{ ...inpStyle, width: 170, cursor: "pointer", background: "var(--surface)" }}>
                    <option value="">Select Client...</option>
                    <option value="all">All {t.client.many}</option>
                    {data.clients.map((cl) => <option key={cl.id} value={cl.id}>{cl.name}</option>)}
                  </select>
                </Field>
                <Field label="Date">
                  <input type="date" value={salesDate} onChange={(e) => setSalesDate(e.target.value)} style={{ ...inpStyle, width: 150, background: "var(--surface)" }} />
                </Field>
              </div>
            </div>

            {salesChatters.length === 0 ? (
              <EmptyState icon="💬" text={!salesClientId ? `Select a ${t.client.one.toLowerCase()} to record ${t.revenue.many.toLowerCase()}` : (salesClientId === "all" ? `No ${t.staff.many.toLowerCase()} yet` : `No ${t.staff.many.toLowerCase()} for this ${t.client.one.toLowerCase()}`)} sub={!salesClientId ? `Choose a ${t.client.one.toLowerCase()} from the dropdown above` : `Add ${t.staff.many.toLowerCase()} in the ${t.client.many} tab`} action={!salesClientId ? null : <Btn variant="secondary" onClick={() => setTab("Clients")}>Go to {t.client.many} →</Btn>} />
            ) : (
              <div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 22 }}>
                  {salesChatters.map((c, chIndex) => {
                    const vals = getVals(c.id);
                    const total = chatterSum(c.id, bulkAmounts[c.id]);
                    const has = total > 0;
                    const client = data.clients.find((cl) => cl.id === c.clientId);
                    const usesHours = clientUsesHours(client);
                    const rowHours = Number((bulkHours[c.id] || [])[0]) || 0;
                    const rowShares = computeShares(client, total, rowHours);
                    const comm = clientCommission(client);
                    return (
                      <div key={c.id} style={{ marginBottom: 8 }}>
                        <form onSubmit={(e) => handleFormSubmit(e, c.id, vals.length - 1)} className="mobile-p-small" style={{
                          padding: "14px 16px",
                          background: has ? "rgba(var(--accent-rgb),0.025)" : "rgba(255,255,255,0.012)",
                          border: "1px solid " + (has ? C.accentBorder : "rgba(255,255,255,0.04)"),
                          borderRadius: 13, transition: "all 0.2s",
                        }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                              <span style={{ fontSize: 10, color: C.accent, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", border: "1px solid " + C.accentBorder, padding: "2px 5px", borderRadius: 4 }}>
                                C{chIndex + 1}
                              </span>
                              <Avatar name={c.name} size={32} />
                              <div>
                                <span style={{ fontWeight: 600, fontSize: 14 }}>{c.name}</span>
                                <span style={{ fontSize: 11, color: C.textMuted, marginLeft: 8, fontFamily: "'JetBrains Mono',monospace" }}>{clientNameFn(c.clientId)}</span>
                              </div>
                            </div>
                          </div>

                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                            {vals.map((v, idx) => {
                              const key = c.id + "-" + idx;
                              return (
                                <div key={idx} style={{ position: "relative" }}>
                                  <input
                                    ref={(el) => { inputRefs.current[key] = el; }}
                                    type="number" placeholder="0" value={v}
                                    data-chatter-id={c.id}
                                    data-input-idx={idx}
                                    id={key}
                                    aria-label={c.name + " sale amount " + (idx + 1)}
                                    enterKeyHint="next"
                                    inputMode="decimal"
                                    onChange={(e) => setVal(c.id, idx, e.target.value)}
                                    onKeyDown={(e) => handleKeyDown(e, c.id, idx)}
                                    style={{
                                      width: 90, boxSizing: "border-box", padding: "8px 10px",
                                      paddingRight: vals.length > 1 ? 24 : 10,
                                      background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)",
                                      borderRadius: 7, color: "#fff", fontSize: 14, outline: "none",
                                      fontFamily: "'JetBrains Mono',monospace", transition: "border-color 0.2s",
                                    }}
                                    onFocus={(e) => { e.target.style.borderColor = "rgba(var(--accent-rgb),0.35)"; }}
                                    onBlur={(e) => { e.target.style.borderColor = "rgba(255,255,255,0.07)"; }}
                                  />
                                  {vals.length > 1 && (
                                    <button type="button" onClick={() => removeField(c.id, idx)} aria-label="Remove amount field" style={{
                                      position: "absolute", right: 3, top: "50%", transform: "translateY(-50%)",
                                      background: "none", border: "none", color: "rgba(255,255,255,0.12)",
                                      cursor: "pointer", fontSize: 11, padding: "2px 3px",
                                    }}>✖</button>
                                  )}
                                </div>
                              );
                            })}
                            {usesHours && (
                              <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 6, marginLeft: 4 }}>
                                <span style={{ fontSize: 11, color: C.textMuted }}>⏱</span>
                                <input
                                  type="number" placeholder="hrs" inputMode="decimal"
                                  value={(bulkHours[c.id] || [])[0] || ""}
                                  aria-label={c.name + " hours"}
                                  onChange={(e) => setBulkHours((s) => ({ ...s, [c.id]: [e.target.value] }))}
                                  style={{
                                    width: 70, boxSizing: "border-box", padding: "8px 10px",
                                    background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)",
                                    borderRadius: 7, color: "#fff", fontSize: 14, outline: "none",
                                    fontFamily: "'JetBrains Mono',monospace",
                                  }} />
                                <span style={{ fontSize: 11, color: C.textMuted }}>hrs</span>
                              </div>
                            )}
                          </div>
                        </form>
                        {has && (
                          <div className="mobile-p-small" style={{
                            display: "flex", alignItems: "center", justifyContent: "space-between",
                            marginTop: 10, padding: "10px 14px",
                            background: "rgba(var(--accent-rgb),0.05)", borderRadius: 10,
                            border: "1px solid " + C.accentBorder,
                          }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                              <div>
                                <div style={{ fontSize: 10, color: C.textDim, fontFamily: "'JetBrains Mono',monospace", letterSpacing: 0.4 }}>TOTAL</div>
                                <div style={{ fontSize: 20, fontWeight: 700, color: C.accent, fontFamily: "'JetBrains Mono',monospace" }}>{fmt(total)}</div>
                              </div>
                              <div style={{ width: 1, height: 28, background: "rgba(255,255,255,0.06)" }} />
                              <div>
                                <div style={{ fontSize: 10, color: C.textDim, fontFamily: "'JetBrains Mono',monospace", letterSpacing: 0.4 }}>YOU ({partLabel(comm.agency, config.locale.currencySymbol)})</div>
                                <div style={{ fontSize: 14, fontWeight: 600, color: C.accent2, fontFamily: "'JetBrains Mono',monospace" }}>{fmt(rowShares.agencyShare)}</div>
                              </div>
                              <div>
                                <div style={{ fontSize: 10, color: C.textDim, fontFamily: "'JetBrains Mono',monospace", letterSpacing: 0.4 }}>THEM ({partLabel(comm.staff, config.locale.currencySymbol)})</div>
                                <div style={{ fontSize: 14, fontWeight: 600, color: C.earn, fontFamily: "'JetBrains Mono',monospace" }}>{fmt(rowShares.staffShare)}</div>
                              </div>
                            </div>
                            <button onClick={() => setShareCard({
                              chatters: [{ name: c.name, chatterCut: rowShares.staffShare, chatterCutPercent: comm.staff.model === "percent" ? comm.staff.rate : undefined }],
                              clientNameStr: clientNameFn(c.clientId), date: shortDate(salesDate),
                            })} style={{
                              background: "linear-gradient(135deg," + C.accent3 + ",#2a9d38)",
                              border: "none", borderRadius: 8, color: "#04231b", padding: "8px 14px",
                              cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "'Outfit',sans-serif",
                              boxShadow: "0 2px 12px rgba(var(--accent-rgb),0.15)",
                            }}>📤 Share</button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>


                {bulkHas && (
                  <div style={{
                    background: C.accentDim, border: "1px solid " + C.accentBorder,
                    borderRadius: 13, padding: "16px 20px", marginBottom: 18,
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                      <div style={{ fontSize: 11, color: C.textDim, fontFamily: "'JetBrains Mono',monospace", letterSpacing: 0.5, textTransform: "uppercase" }}>
                        Batch Summary — {shortDate(salesDate)}
                      </div>
                      <button onClick={() => {
                        const allCh = salesChatters.filter((c) => chatterSum(c.id) > 0).map((c) => {
                          const cl = data.clients.find((x) => x.id === c.clientId);
                          const hrs = Number((bulkHours[c.id] || [])[0]) || 0;
                          const sp = clientCommission(cl).staff;
                          return { name: c.name, chatterCut: computeShares(cl, chatterSum(c.id), hrs).staffShare, chatterCutPercent: sp.model === "percent" ? sp.rate : undefined };
                        });
                        if (allCh.length) setShareCard({ chatters: allCh, clientNameStr: salesClientId === "all" ? `All ${t.client.many}` : clientNameFn(salesClientId), date: shortDate(salesDate) });
                      }} style={{
                        background: "linear-gradient(135deg," + C.accent3 + ",#2a9d38)",
                        border: "none", borderRadius: 7, color: "#04231b", padding: "6px 14px",
                        cursor: "pointer", fontSize: 11, fontWeight: 700, fontFamily: "'Outfit',sans-serif",
                        boxShadow: "0 2px 10px rgba(var(--accent-rgb),0.12)",
                      }}>📤 Share All</button>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                      <span style={{ color: C.textDim, fontSize: 13 }}>Total sales</span>
                      <span style={{ color: C.accent, fontWeight: 700 }}>{fmt(bulkTotal)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                      <span style={{ color: C.textDim, fontSize: 13 }}>{batchAgLabel}</span>
                      <span style={{ color: C.accent2, fontWeight: 600 }}>{fmt(bulkAgencyTotal)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: C.textDim, fontSize: 13 }}>{batchChLabel}</span>
                      <span style={{ color: C.earn, fontWeight: 600 }}>{fmt(bulkChatterTotal)}</span>
                    </div>
                  </div>
                )}

                <Btn onClick={saveBulkSales} disabled={!bulkHas} style={{ width: "100%" }}>
                  {savedFlash ? "✓ Saved!" : `Save All `}
                </Btn>
                {savedFlash && (
                  <div style={{ textAlign: "center", marginTop: 10, color: C.accent, fontSize: 13, fontWeight: 500, animation: "fadeIn 0.3s ease" }}>
                    {t.revenue.many} recorded for {shortDate(salesDate)}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ═══ CLIENTS ═══ */}
        {tab === "Clients" && (
          <div style={{ animation: "slideUp 0.3s ease" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22 }}>
              <div>
                <h2 style={{ fontSize: 21, fontWeight: 700, marginBottom: 3 }}>{t.client.many} & {t.staff.many}</h2>
                <p style={{ color: C.textDim, fontSize: 13 }}>Manage your clients and assign chatters.</p>
              </div>
              <Btn onClick={() => setAddClientOpen(true)}>+ Add {t.client.one}</Btn>
            </div>

            {data.clients.length === 0 ? (
              <EmptyState icon="📌" text={`No ${t.client.many.toLowerCase()} yet`} sub={`Click "Add ${t.client.one}" to get started`} />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {data.clients.map((cl, i) => {
                  const ch = data.chatters.filter((c) => c.clientId === cl.id);
                  return (
                    <div key={cl.id} className="lift rise" style={{ background: C.card, border: "1px solid " + C.cardBorder, borderRadius: 16, padding: "18px 20px", animationDelay: (i * 60) + "ms", boxShadow: "0 12px 30px rgba(0,0,0,0.26), inset 0 1px 0 rgba(255,255,255,0.04)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: ch.length ? 12 : 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
                          <Avatar name={cl.name} size={40} />
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 16 }}>{cl.name}</div>
                            <div style={{ fontSize: 11, color: C.textMuted, fontFamily: "'JetBrains Mono',monospace" }}>{ch.length} chatters</div>
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button onClick={() => setEditingClient(cl)} style={{
                            background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
                            borderRadius: 8, color: C.textDim, padding: "7px 12px", cursor: "pointer",
                            fontSize: 11, fontWeight: 600, fontFamily: "'Outfit',sans-serif",
                          }}>⚙️ Settings</button>
                          <Btn variant="secondary" onClick={() => { setChatterClientId(cl.id); setAddChatterOpen(true); }} style={{ padding: "7px 14px", fontSize: 12 }}>+ {t.staff.one}</Btn>
                          <button onClick={() => setDeleteConfirm({ type: "client", id: cl.id })} style={{
                            background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.12)",
                            borderRadius: 8, color: "#ef4444", padding: "7px 12px", cursor: "pointer",
                            fontSize: 11, fontWeight: 600, fontFamily: "'Outfit',sans-serif",
                          }}>Remove</button>
                        </div>
                      </div>
                      {ch.length > 0 && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginLeft: 51 }}>
                          {ch.map((c) => (
                            <div key={c.id} className="chrow" style={{
                              display: "flex", justifyContent: "space-between", alignItems: "center",
                              padding: "8px 12px", background: "rgba(255,255,255,0.012)", borderRadius: 9,
                              border: "1px solid rgba(255,255,255,0.025)",
                            }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                                <Avatar name={c.name} size={28} />
                                <span style={{ fontSize: 13, fontWeight: 500 }}>{c.name}</span>
                              </div>
                              <button onClick={() => setDeleteConfirm({ type: "chatter", id: c.id })} style={{
                                background: "none", border: "none", color: "rgba(255,255,255,0.12)",
                                cursor: "pointer", fontSize: 13, padding: "2px 6px",
                              }}>✖</button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ═══ HISTORY ═══ */}
        {tab === "History" && (
          <div style={{ animation: "slideUp 0.3s ease" }}>
            <div className="no-print" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 24, flexWrap: "wrap", gap: 14 }}>
              <div className="mobile-mb-none" style={{ marginBottom: 4 }}>
                <h2 style={{ fontSize: 21, fontWeight: 700, marginBottom: 3 }}>Sales History</h2>
                <p style={{ color: C.textDim, fontSize: 13 }}>View and manage past performance</p>
              </div>
              <div style={{ display: "flex", gap: 8, width: "100%", justifyContent: "flex-end", maxWidth: "min-content" }}>
                <Btn variant="secondary" onClick={() => exportCSV(filteredRecords)} style={{ fontSize: 12, padding: "8px 14px", display: "flex", alignItems: "center", gap: 6, flex: 1 }}>
                  📥 Export
                </Btn>
                <Btn variant="secondary" onClick={printReport} style={{ fontSize: 12, padding: "8px 14px", display: "flex", alignItems: "center", gap: 6, flex: 1 }}>
                  🖨️ Print
                </Btn>
              </div>
            </div>

            {/* Local data backup — everything lives in this browser, so keep a copy */}
            <div className="no-print" style={{
              display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12,
              marginBottom: 24, padding: "14px 18px", background: C.card,
              border: "1px solid " + C.cardBorder, borderRadius: 14,
            }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>Backup &amp; restore</div>
                <div style={{ fontSize: 11.5, color: C.textDim, marginTop: 2 }}>
                  Your data is stored only in this browser. Save a backup file regularly so you don't lose it.
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <Btn variant="secondary" onClick={exportBackup} style={{ fontSize: 12, padding: "8px 14px" }}>⬇ Save backup</Btn>
                <Btn variant="secondary" onClick={() => importRef.current && importRef.current.click()} style={{ fontSize: 12, padding: "8px 14px" }}>⬆ Restore</Btn>
                <input ref={importRef} type="file" accept="application/json,.json" onChange={handleImportFile} style={{ display: "none" }} aria-hidden="true" />
              </div>
            </div>

            <div className="no-print" style={{
              display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
              gap: 12, marginBottom: 24, padding: 18, background: C.card,
              border: "1px solid " + C.cardBorder, borderRadius: 16
            }}>
              <Field label="Client">
                <select value={filterClient} aria-label="Filter by client" onChange={(e) => { setFilterClient(e.target.value); setFilterChatter("all"); }} style={{ ...inpStyle, cursor: "pointer", background: "var(--surface)" }}>
                  <option value="all">All {t.client.many}</option>
                  {data.clients.map((cl) => <option key={cl.id} value={cl.id}>{cl.name}</option>)}
                </select>
              </Field>
              <Field label="Chatter">
                <select value={filterChatter} aria-label="Filter by chatter" onChange={(e) => setFilterChatter(e.target.value)} style={{ ...inpStyle, cursor: "pointer", background: "var(--surface)" }}>
                  <option value="all">All Chatters</option>
                  {(filterClient === "all" ? data.chatters : data.chatters.filter((ch) => ch.clientId === filterClient)).map((ch) => (
                    <option key={ch.id} value={ch.id}>{ch.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Month">
                <select value={filterMonth} aria-label="Filter by month" onChange={(e) => setFilterMonth(e.target.value)} style={{ ...inpStyle, cursor: "pointer", background: "var(--surface)" }}>
                  <option value="all">All Months</option>
                  {months.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </Field>
            </div>

            <div id="history-printable">
              {filteredRecords.length > 0 && (
                <div className="mobile-grid" style={{ display: "flex", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
                  <div style={{ background: C.accentDim, borderRadius: 11, padding: "12px 18px", flex: "1 1 130px" }}>
                    <div style={{ fontSize: 10, color: C.textMuted, fontFamily: "'JetBrains Mono',monospace", letterSpacing: 0.4, marginBottom: 3 }}>TOTAL</div>
                    <div style={{ fontSize: 18, fontWeight: 700 }}>{fmt(sumMoney(filteredRecords, (r) => r.amount))}</div>
                  </div>
                  <div style={{ background: "rgba(var(--accent-rgb),0.04)", borderRadius: 11, padding: "12px 18px", flex: "1 1 130px" }}>
                    <div style={{ fontSize: 10, color: C.textMuted, fontFamily: "'JetBrains Mono',monospace", letterSpacing: 0.4, marginBottom: 3 }}>YOUR CUT</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: C.accent2 }}>{fmt(sumMoney(filteredRecords, (r) => r.agencyCut))}</div>
                  </div>
                  <div style={{ background: "rgba(167,139,250,0.06)", borderRadius: 11, padding: "12px 18px", flex: "1 1 130px" }}>
                    <div style={{ fontSize: 10, color: C.textMuted, fontFamily: "'JetBrains Mono',monospace", letterSpacing: 0.4, marginBottom: 3 }}>{t.staffShareLabel.toUpperCase()}</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: C.violet }}>{fmt(sumMoney(filteredRecords, (r) => r.chatterCut))}</div>
                  </div>
                </div>
              )}

              {filteredRecords.length === 0 ? (
                <EmptyState text="No records found" />
              ) : (
                <div className="mobile-scroll-x" style={{ borderRadius: 14, overflow: "hidden", border: "1px solid " + C.cardBorder }}>
                  <div style={{
                    display: "grid", gridTemplateColumns: "1fr 0.8fr 0.7fr 0.9fr 0.7fr 0.7fr 64px",
                    minWidth: 600, padding: "10px 18px", background: "rgba(var(--accent-rgb),0.015)",
                    fontSize: 10, color: C.textMuted, fontFamily: "'JetBrains Mono',monospace",
                    letterSpacing: 0.7, textTransform: "uppercase", gap: 6,
                  }}>
                    <div>{t.staff.one}</div><div>{t.client.one}</div><div>Date</div><div>Amount</div><div>You</div><div>Them</div><div>Actions</div>
                  </div>
                  {filteredRecords.map((r) => (
                    <div key={r.id} className="recrow" style={{
                      display: "grid", gridTemplateColumns: "1fr 0.8fr 0.7fr 0.9fr 0.7fr 0.7fr 64px",
                      minWidth: 600, padding: "12px 18px", borderTop: "1px solid rgba(var(--accent-rgb),0.03)",
                      fontSize: 13, alignItems: "center", gap: 6,
                    }}>
                      <div style={{ fontWeight: 600 }}>{chatterNameFn(r.chatterId)}</div>
                      <div style={{ color: C.textDim, fontSize: 12 }}>{clientNameFn(chatterClientFn(r.chatterId))}</div>
                      <div style={{ color: C.textMuted, fontSize: 11, fontFamily: "'JetBrains Mono',monospace" }}>{shortDate(r.date)}</div>
                      <div style={{ fontWeight: 700, color: C.accent }}>{fmt(r.amount)}</div>
                      <div style={{ color: C.accent2, fontSize: 12 }}>{fmt(r.agencyCut)}</div>
                      <div style={{ color: C.earn, fontSize: 12 }}>{fmt(r.chatterCut)}</div>
                      <div className="no-print" style={{ display: "flex", gap: 2, gridColumn: "7", justifyContent: "flex-end" }}>
                        <button onClick={() => setEditRecord(r)} aria-label="Edit sale" title="Edit" style={{
                          background: "none", border: "none", color: "rgba(255,255,255,0.35)",
                          cursor: "pointer", fontSize: 13, padding: 3, borderRadius: 5,
                        }}>✎</button>
                        <button onClick={() => deleteRecord(r)} aria-label="Delete sale" title="Delete" style={{
                          background: "none", border: "none", color: "rgba(239,68,68,0.45)",
                          cursor: "pointer", fontSize: 14, padding: 3, borderRadius: 5,
                        }}>✖</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── MODALS ── */}
      <Modal open={addClientOpen} onClose={() => setAddClientOpen(false)} title={`Add ${t.client.one}`}>
        <Field label={`${t.client.one} Name`}>
          <input type="text" placeholder={`Enter ${t.client.one.toLowerCase()} name...`} value={newClientName}
            onChange={(e) => setNewClientName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addClient(); }}
            style={inpStyle} />
        </Field>
        <Field label={t.agencyShareLabel}>
          <CommissionEditor value={newAgencyPart} onChange={setNewAgencyPart} symbol={config.locale.currencySymbol} />
        </Field>
        <Field label={t.staffShareLabel}>
          <CommissionEditor value={newStaffPart} onChange={setNewStaffPart} symbol={config.locale.currencySymbol} />
        </Field>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 6 }}>
          <Btn variant="secondary" onClick={() => setAddClientOpen(false)}>Cancel</Btn>
          <Btn onClick={addClient} disabled={!newClientName.trim()}>Add {t.client.one}</Btn>
        </div>
      </Modal>

      <Modal open={addChatterOpen} onClose={() => setAddChatterOpen(false)} title={`Add ${t.staff.one}`}>
        <Field label={t.client.one}>
          <select value={chatterClientId} onChange={(e) => setChatterClientId(e.target.value)}
            style={{ ...inpStyle, cursor: "pointer", background: "#151916" }}>
            <option value="">Select {t.client.one.toLowerCase()}...</option>
            {data.clients.map((cl) => <option key={cl.id} value={cl.id}>{cl.name}</option>)}
          </select>
        </Field>
        <Field label={`${t.staff.one} Name`}>
          <input type="text" placeholder="Enter name..." value={newChatterName}
            onChange={(e) => setNewChatterName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addChatter(); }}
            style={inpStyle} />
        </Field>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 6 }}>
          <Btn variant="secondary" onClick={() => setAddChatterOpen(false)}>Cancel</Btn>
          <Btn onClick={addChatter} disabled={!newChatterName.trim() || !chatterClientId}>Add {t.staff.one}</Btn>
        </div>
      </Modal>

      <Modal open={!!editingClient} onClose={() => setEditingClient(null)} title={`${t.client.one} Settings`}>
        {editingClient && (
          <div>
            <p style={{ fontSize: 13, color: C.textDim, marginBottom: 18 }}>How payouts are calculated for <strong>{editingClient.name}</strong>.</p>
            <Field label={t.agencyShareLabel}>
              <CommissionEditor value={editAgencyPart} onChange={setEditAgencyPart} symbol={config.locale.currencySymbol} />
            </Field>
            <Field label={t.staffShareLabel}>
              <CommissionEditor value={editStaffPart} onChange={setEditStaffPart} symbol={config.locale.currencySymbol} />
            </Field>
            {(() => {
              const example = 1000;
              const ag = computeShare(editAgencyPart, example, 10);
              const st = computeShare(editStaffPart, example, 10);
              return (
                <div style={{ display: "flex", gap: 8, justifyContent: "space-between", alignItems: "center", marginTop: 14 }}>
                  <span style={{ fontSize: 11, color: C.textMuted, fontFamily: "'JetBrains Mono',monospace" }}>
                    On {fmt(example)}{(editAgencyPart.model === "hourly" || editStaffPart.model === "hourly") ? " · 10h" : ""}: you {fmt(ag)} · them {fmt(st)}
                  </span>
                  <div style={{ display: "flex", gap: 8 }}>
                    <Btn variant="secondary" onClick={() => setEditingClient(null)}>Cancel</Btn>
                    <Btn onClick={() => updateClientCuts(editingClient.id, editAgencyPart, editStaffPart)}>Save changes</Btn>
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </Modal>

      <Modal open={!!deleteConfirm} onClose={() => setDeleteConfirm(null)} title={"Remove " + (deleteConfirm ? (deleteConfirm.type === "client" ? "Client" : "Chatter") : "")}>
        <p style={{ color: C.textDim, fontSize: 13, marginBottom: 20, lineHeight: 1.6 }}>
          {deleteConfirm && deleteConfirm.type === "client"
            ? <span>Remove <strong style={{ color: "#fff" }}>{clientNameFn(deleteConfirm.id)}</strong> and all its chatters and records?</span>
            : deleteConfirm
              ? <span>Remove <strong style={{ color: "#fff" }}>{chatterNameFn(deleteConfirm.id)}</strong> and all their records?</span>
              : null
          }
        </p>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Btn variant="secondary" onClick={() => setDeleteConfirm(null)}>Cancel</Btn>
          <button onClick={deleteItem} style={{
            padding: "11px 22px", background: "rgba(239,68,68,0.12)",
            border: "1px solid rgba(239,68,68,0.2)", borderRadius: 11,
            color: "#ef4444", fontSize: 14, fontWeight: 600, cursor: "pointer",
            fontFamily: "'Outfit',sans-serif",
          }}>Remove</button>
        </div>
      </Modal>

      {shareCard && <ShareCard {...shareCard} onClose={() => setShareCard(null)} />}
      {!loading && needsOnboarding && <Onboarding onComplete={saveConfig} />}

      {settingsOpen && <SettingsPanel initial={config} onClose={() => setSettingsOpen(false)} onSave={saveConfig} />}

      {invoiceView && <InvoiceView {...invoiceView} onClose={() => setInvoiceView(null)} onOpenSettings={() => setSettingsOpen(true)} />}

      {/* Edit a single sale record */}
      <Modal open={!!editRecord} onClose={() => setEditRecord(null)} title="Edit sale">
        {editRecord && (
          <div>
            <p style={{ fontSize: 13, color: C.textDim, marginBottom: 16 }}>
              {chatterNameFn(editRecord.chatterId)} · {clientNameFn(chatterClientFn(editRecord.chatterId))}
            </p>
            <div style={{ display: "flex", gap: 12 }}>
              <Field label="Amount">
                <input type="number" step="0.01" min="0" value={editAmount}
                  onChange={(e) => setEditAmount(e.target.value)}
                  aria-label="Sale amount" style={inpStyle} autoFocus />
              </Field>
              <Field label="Date">
                <input type="date" value={editDate}
                  onChange={(e) => setEditDate(e.target.value)}
                  aria-label="Sale date" style={inpStyle} />
              </Field>
            </div>
            {(() => {
              const amt = parseFloat(editAmount);
              const valid = !isNaN(amt) && amt > 0 && editDate;
              const agRate = editRecord.amount ? editRecord.agencyCut / editRecord.amount : AGENCY_CUT;
              const chRate = editRecord.amount ? editRecord.chatterCut / editRecord.amount : CHATTER_CUT;
              return (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14 }}>
                  <span style={{ fontSize: 11, color: C.textMuted, fontFamily: "'JetBrains Mono',monospace" }}>
                    {valid ? `You ${fmt(amt * agRate)} · Them ${fmt(amt * chRate)}` : "Enter an amount and date"}
                  </span>
                  <div style={{ display: "flex", gap: 8 }}>
                    <Btn variant="secondary" onClick={() => setEditRecord(null)}>Cancel</Btn>
                    <Btn disabled={!valid} onClick={updateRecord}>Save changes</Btn>
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </Modal>

      {/* Undo toast for deleted records */}
      {lastDeleted && (
        <div className="no-print" role="status" style={{
          position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
          backgroundColor: "rgba(20,22,20,0.96)",
          border: "1px solid " + C.accentBorder, borderRadius: 12, padding: "12px 16px",
          display: "flex", alignItems: "center", gap: 16, zIndex: 1200,
          boxShadow: "0 12px 40px rgba(0,0,0,0.5)", animation: "slideUp 0.2s ease",
        }}>
          <span style={{ fontSize: 13, color: "rgba(255,255,255,0.8)" }}>
            Sale deleted ({fmt(lastDeleted.amount)})
          </span>
          <button onClick={undoDelete} style={{
            background: C.accentDim, border: "1px solid " + C.accentBorder, color: C.accent,
            borderRadius: 7, padding: "6px 14px", cursor: "pointer", fontSize: 12, fontWeight: 700,
            fontFamily: "'Outfit',sans-serif",
          }}>Undo</button>
        </div>
      )}

      <Modal open={smartPasteOpen} onClose={() => setSmartPasteOpen(false)} title={`✨ Smart Paste `}>
        <p style={{ fontSize: 13, color: C.textDim, marginBottom: 12, lineHeight: 1.5 }}>
          Paste raw reports or chat logs here. We'll automatically find chatter names and their sales.
        </p>
        {!salesClientId && (
          <div style={{
            background: "rgba(251,191,36,0.06)", border: "1px solid rgba(251,191,36,0.15)",
            borderRadius: 12, padding: "10px 14px", marginBottom: 16, color: "#fbbf24", fontSize: 13,
            display: "flex", alignItems: "center", gap: 8
          }}>
            <span>⚠️</span>
            <span>Please select a {t.client.one.toLowerCase()} in the "Record {t.revenue.many}" tab first.</span>
          </div>
        )}
        <textarea
          value={pastedText}
          onChange={(e) => { setPastedText(e.target.value); if (reviewItems) setReviewItems(null); }}
          placeholder="e.g. John: $450.00&#10;Sarah had a great day with 250..."
          style={{
            ...inpStyle, height: 180, resize: "none", fontSize: 13, lineHeight: 1.6,
            background: "rgba(255,255,255,0.02)", marginBottom: 16,
          }}
        />

        {reviewItems && reviewItems.length > 0 && (
          <div style={{
            background: "rgba(var(--accent-rgb),0.05)", border: "1px solid " + C.accentBorder,
            borderRadius: 12, padding: 14, marginBottom: 18
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <span style={{ fontSize: 11, color: C.textDim, fontFamily: "'JetBrains Mono',monospace" }}>REVIEW DETECTED SALES</span>
              <span style={{ fontSize: 11, color: C.textMuted }}>Edit or uncheck before applying</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {reviewItems.map((it) => (
                <div key={it.id} style={{ display: "flex", alignItems: "center", gap: 10, opacity: it.included ? 1 : 0.4 }}>
                  <input type="checkbox" checked={it.included} onChange={() => toggleReviewItem(it.id)}
                    aria-label={"Include " + it.name} style={{ width: 16, height: 16, accentColor: "var(--accent)", cursor: "pointer" }} />
                  <span style={{ fontWeight: 600, fontSize: 13, flex: 1 }}>{it.name}</span>
                  {it.count > 1 && (
                    <span title={it.count + " numbers were added together — check this is right"}
                      style={{ fontSize: 10, color: C.earn, fontFamily: "'JetBrains Mono',monospace", border: "1px solid rgba(251,191,36,0.3)", borderRadius: 5, padding: "1px 5px" }}>
                      {it.count} summed
                    </span>
                  )}
                  <div style={{ position: "relative" }}>
                    <span style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", color: C.textMuted, fontSize: 12 }}>{config.locale.currencySymbol}</span>
                    <input type="number" step="0.01" min="0" value={it.amount}
                      onChange={(e) => setReviewAmount(it.id, e.target.value)}
                      disabled={!it.included}
                      aria-label={it.name + " detected amount"}
                      style={{ width: 110, padding: "6px 8px 6px 18px", background: "rgba(255,255,255,0.04)",
                        border: "1px solid rgba(255,255,255,0.08)", borderRadius: 7, color: C.accent, fontSize: 13,
                        fontFamily: "'JetBrains Mono',monospace", outline: "none", textAlign: "right" }} />
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
              <span style={{ fontSize: 12, color: C.textDim }}>Total to add</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: C.accent, fontFamily: "'JetBrains Mono',monospace" }}>
                {fmt(reviewItems.reduce((s, it) => s + (it.included ? (parseFloat(it.amount) || 0) : 0), 0))}
              </span>
            </div>
          </div>
        )}

        {reviewItems && reviewItems.length === 0 && (
          <div style={{ textAlign: "center", padding: 12, color: "#ff7f7f", fontSize: 13, marginBottom: 16 }}>
            No sales or chatter names detected. Check the names match your chatters, then try again.
          </div>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Btn variant="secondary" onClick={() => { setSmartPasteOpen(false); setReviewItems(null); }}>Cancel</Btn>
          {!reviewItems ? (
            <Btn onClick={parseSales} disabled={!pastedText.trim() || !salesClientId}>Scan text</Btn>
          ) : (
            <Btn onClick={applyParsed} disabled={!reviewItems.some((it) => it.included && parseFloat(it.amount) > 0)}>Apply to inputs</Btn>
          )}
        </div>
      </Modal>
    </div >
    </ConfigContext.Provider>
  );
}

export default App;
