import React, { useState, useEffect, useCallback, useRef, useMemo, createContext, useContext } from "react";
import AccountMenu from "./src/auth/AccountMenu.jsx";
import DeleteAccountSection from "./src/auth/DeleteAccountSection.jsx";
import ResetDataSection from "./src/auth/ResetDataSection.jsx";

const STORAGE_KEY = "fanlink-tracker-v4";
const THEME_KEY = "agencyx-theme"; // "light" | "dark"; falls back to OS preference
const defaultState = { clients: [], chatters: [], records: [], brands: [], entries: [], invoices: [] };

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

// ── Multi-currency ──────────────────────────────────────────────────
// The workspace has one BASE (reporting) currency (config.locale). Additional currencies
// live in config.currencies as { code, symbol, rate, locale } where rate = value of 1 unit
// of that currency in the base currency. Each client/record can be in any enabled currency.
let currencyReg = { base: "USD", map: { USD: { symbol: "$", locale: "en-US", rate: 1, words: { major: "Dollars", minor: "Cents" } } } };
const setCurrencyContext = (config) => {
  const loc = (config && config.locale) || {};
  const base = (loc.currency || "USD").toUpperCase();
  const map = {};
  map[base] = { symbol: loc.currencySymbol || "$", locale: loc.locale || "en-US", rate: 1, words: loc.currencyWords || { major: "Dollars", minor: "Cents" } };
  ((config && config.currencies) || []).forEach((c) => {
    if (!c || !c.code) return;
    const code = String(c.code).toUpperCase();
    if (code === base) return; // base is fixed at rate 1
    map[code] = { symbol: c.symbol || code, locale: c.locale || loc.locale || "en-US", rate: Number(c.rate) || 0, words: c.words || { major: code, minor: "" } };
  });
  currencyReg = { base, map };
};
const baseCode = () => currencyReg.base;
const curInfo = (code) => currencyReg.map[String(code || currencyReg.base).toUpperCase()] || currencyReg.map[currencyReg.base];
const isMultiCurrency = () => Object.keys(currencyReg.map).length > 1;
// Format a value in a specific currency code (defaults to base).
const fmtIn = (n, code) => {
  const v = Number(n) || 0;
  const cc = String(code || currencyReg.base).toUpperCase();
  const info = curInfo(cc);
  try { return new Intl.NumberFormat(info.locale, { style: "currency", currency: cc }).format(v); }
  catch { return info.symbol + v.toFixed(2); }
};
// Convert an amount in `code` to the base currency (rounded to cents).
const toBase = (amount, code) => money((Number(amount) || 0) * (curInfo(code).rate || 0));
// A client's currency code (defaults to base).
const clientCur = (client) => String((client && client.currency) || currencyReg.base).toUpperCase();

// ── Numeric input hygiene ───────────────────────────────────────────
// Sanitize a decimal string as the user types: digits and a single dot only,
// and no leading zeros ("05" → "5", "0.5" stays "0.5"). Amounts here are never
// negative, so "-" is stripped too.
const numClean = (s, { integer = false } = {}) => {
  let v = String(s ?? "").replace(/[^\d.]/g, "");
  if (integer) v = v.replace(/\./g, "");
  const i = v.indexOf(".");
  if (i !== -1) v = v.slice(0, i + 1) + v.slice(i + 1).replace(/\./g, "");
  return v.replace(/^0+(?=\d)/, "");
};

// Controlled numeric input that never shows a stale leading zero. React skips
// syncing a focused type="number" input when Number(domValue) equals the state
// value, so "05" would stay on screen; this keeps a sanitized string draft while
// focused instead, and reports the sanitized string via onChange (parents that
// store numbers call Number() on it).
function NumInput({ value, onChange, integer = false, ...rest }) {
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
// Common currencies for the pickers: symbol, display locale, and unit words
// (words feed "amount in words" on invoices). Exchange rates come live from
// the API below, never from this table.
const CURRENCY_CATALOG = [
  ["USD", "US Dollar", "$", "en-US", "Dollars", "Cents"],
  ["EUR", "Euro", "€", "de-DE", "Euros", "Cents"],
  ["GBP", "British Pound", "£", "en-GB", "Pounds", "Pence"],
  ["INR", "Indian Rupee", "₹", "en-IN", "Rupees", "Paise"],
  ["AUD", "Australian Dollar", "A$", "en-AU", "Dollars", "Cents"],
  ["CAD", "Canadian Dollar", "C$", "en-CA", "Dollars", "Cents"],
  ["SGD", "Singapore Dollar", "S$", "en-SG", "Dollars", "Cents"],
  ["AED", "UAE Dirham", "AED", "ar-AE", "Dirhams", "Fils"],
  ["JPY", "Japanese Yen", "¥", "ja-JP", "Yen", "Sen"],
  ["CNY", "Chinese Yuan", "¥", "zh-CN", "Yuan", "Fen"],
  ["CHF", "Swiss Franc", "CHF", "de-CH", "Francs", "Rappen"],
  ["NZD", "New Zealand Dollar", "NZ$", "en-NZ", "Dollars", "Cents"],
  ["HKD", "Hong Kong Dollar", "HK$", "zh-HK", "Dollars", "Cents"],
  ["KRW", "South Korean Won", "₩", "ko-KR", "Won", "Jeon"],
  ["SEK", "Swedish Krona", "kr", "sv-SE", "Kronor", "Öre"],
  ["NOK", "Norwegian Krone", "kr", "nb-NO", "Kroner", "Øre"],
  ["DKK", "Danish Krone", "kr", "da-DK", "Kroner", "Øre"],
  ["PLN", "Polish Złoty", "zł", "pl-PL", "Złoty", "Groszy"],
  ["TRY", "Turkish Lira", "₺", "tr-TR", "Lira", "Kuruş"],
  ["RUB", "Russian Ruble", "₽", "ru-RU", "Rubles", "Kopecks"],
  ["BRL", "Brazilian Real", "R$", "pt-BR", "Reais", "Centavos"],
  ["MXN", "Mexican Peso", "MX$", "es-MX", "Pesos", "Centavos"],
  ["ZAR", "South African Rand", "R", "en-ZA", "Rand", "Cents"],
  ["IDR", "Indonesian Rupiah", "Rp", "id-ID", "Rupiah", "Sen"],
  ["MYR", "Malaysian Ringgit", "RM", "ms-MY", "Ringgit", "Sen"],
  ["THB", "Thai Baht", "฿", "th-TH", "Baht", "Satang"],
  ["PHP", "Philippine Peso", "₱", "en-PH", "Pesos", "Centavos"],
  ["VND", "Vietnamese Dong", "₫", "vi-VN", "Dong", "Hao"],
  ["BDT", "Bangladeshi Taka", "৳", "bn-BD", "Taka", "Poisha"],
  ["PKR", "Pakistani Rupee", "Rs", "en-PK", "Rupees", "Paise"],
  ["LKR", "Sri Lankan Rupee", "Rs", "en-LK", "Rupees", "Cents"],
  ["NPR", "Nepalese Rupee", "Rs", "en-NP", "Rupees", "Paise"],
  ["SAR", "Saudi Riyal", "SAR", "ar-SA", "Riyals", "Halalas"],
  ["QAR", "Qatari Riyal", "QAR", "ar-QA", "Riyals", "Dirhams"],
  ["KWD", "Kuwaiti Dinar", "KWD", "ar-KW", "Dinars", "Fils"],
  ["EGP", "Egyptian Pound", "E£", "ar-EG", "Pounds", "Piastres"],
  ["NGN", "Nigerian Naira", "₦", "en-NG", "Naira", "Kobo"],
  ["KES", "Kenyan Shilling", "KSh", "en-KE", "Shillings", "Cents"],
  ["GHS", "Ghanaian Cedi", "GH₵", "en-GH", "Cedis", "Pesewas"],
  ["ILS", "Israeli Shekel", "₪", "he-IL", "Shekels", "Agorot"],
].map(([code, name, symbol, locale, major, minor]) => ({ code, name, symbol, locale, words: { major, minor } }));
const curCatalog = (code) => CURRENCY_CATALOG.find((c) => c.code === String(code || "").toUpperCase()) || null;

// Live FX rates from open.er-api.com (free, keyless). Returns units of each
// currency per 1 `base`; the app stores rate = value of 1 unit in base, i.e.
// 1 / rates[code].
const fetchLiveRates = async (base) => {
  const res = await fetch("https://open.er-api.com/v6/latest/" + encodeURIComponent(String(base || "USD").toUpperCase()));
  if (!res.ok) throw new Error("Rate service unavailable");
  const j = await res.json();
  if (!j || j.result !== "success" || !j.rates) throw new Error("Rate service unavailable");
  return j.rates;
};

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
// Monday-anchored week key (YYYY-MM-DD of that week's Monday) for weekly aggregation.
const weekKey = (d) => {
  const dt = new Date(d + "T00:00:00");
  const off = (dt.getDay() + 6) % 7;
  dt.setDate(dt.getDate() - off);
  return dt.toISOString().slice(0, 10);
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
    currencyWords: { major: "Dollars", minor: "Cents" },    taxRate: 0,
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
    accent: "#111111",
    accent2: "#5C5C5C",
    accent3: "#2E2E2E",
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
  currencies: [], // additional non-base currencies: { code, symbol, rate, locale }
  agencyType: "service", // "service" (Type 1) | "management" (Type 2)
  expenseCategories: [], // Type 2 — user-defined expense categories: { id, label, color }
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

// Extra payout roles for a client (beyond the agency cut and the primary staff/chatter cut).
// Each role: { id, name, rate } where rate is a percent fraction (0.08 = 8%).
const clientRoles = (client) => (client && Array.isArray(client.roles) ? client.roles : []);
// The cut a given extra role takes on an amount.
const roleCut = (role, amount) => money((Number(amount) || 0) * (Number(role && role.rate) || 0));

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
// Two agency business models (see Agency_Models_Document.pdf).
//   service    (Type 1) — markup model: invoice = team cost + agency fee.
//   management (Type 2) — profit model: profit = client payment − expenses.
const AGENCY_PRESETS = {
  service: {
    type: "service", label: "Service Agency", icon: "briefcase", tagline: "Service Agency",
    desc: "You provide a service and bill clients. Your team — chatters, designers, marketers, developers — generates sales or work value. Each client invoice = team cost + your agency fee.",
    terms: { client: { one: "Client", many: "Clients" }, staff: { one: "Team Member", many: "Team Members" }, revenue: { one: "Sale", many: "Sales" }, agencyShareLabel: "Agency Fee", staffShareLabel: "Team Pay" },
    commission: { agencyShare: 0.10, staffShare: 0.10 }, lineItemLabel: "Services",
  },
  management: {
    type: "management", label: "Management Agency", icon: "pie", tagline: "Management Agency",
    desc: "You manage a person, creator, or brand. They pay you; you cover the operating costs (chatting, design, marketing, and more). Your profit is what's left — client payment minus expenses.",
    terms: { client: { one: "Brand", many: "Brands" }, staff: { one: "Team Member", many: "Team Members" }, revenue: { one: "Entry", many: "Entries" }, agencyShareLabel: "Agency Fee", staffShareLabel: "Team Pay" },
    commission: { agencyShare: 0.10, staffShare: 0.10 }, lineItemLabel: "Management Fees",
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
  name: "Daylight",
  bg: "#FAFAFA",
  card: "#FFFFFF",
  cardBorder: "rgba(var(--ink-rgb),0.09)",
  accent: "#111111",
  accent2: "#5C5C5C",
  accent3: "#2E2E2E",
  accentRgb: "17, 17, 17",
  accentFg: "#FFFFFF", // text/icons that sit on an accent or ink surface
  accentGlow: "rgba(var(--accent-rgb),0.12)",
  accentDim: "rgba(var(--accent-rgb),0.10)",
  accentBorder: "rgba(var(--accent-rgb),0.22)",
  textDim: "rgba(var(--ink-rgb),0.80)",
  textMuted: "rgba(var(--ink-rgb),0.66)",
  ink: "#15171a", // primary text color
  inkRgb: "17, 24, 28", // ink as rgb — tints borders/fills/overlays; flips in dark
  inkSoft: "rgba(var(--ink-rgb),0.60)",
  earn: "#52525B",
  violet: "#3F3F46",
  surface: "#FFFFFF",
  surface2: "#F1F3F4",
  headerBg: "rgba(255,255,255,0.82)",
  fieldBg: "rgba(var(--ink-rgb),0.03)",
  fieldBorder: "rgba(var(--ink-rgb),0.08)",
  scrim: "rgba(var(--ink-rgb),0.22)", // modal backdrop — stays dark in both modes
  blur: "blur(16px)",
};

// Dark counterpart. Same keys as THEME so the CSS-variable block can swap wholesale.
const DARK = {
  name: "Midnight",
  bg: "#0E1011",
  card: "#17191B",
  cardBorder: "rgba(255,255,255,0.10)",
  accent: "#ECEDEE",
  accent2: "#9BA0A6",
  accent3: "#C9CDD2",
  accentRgb: "236, 237, 238",
  accentFg: "#15171a",
  accentGlow: "rgba(var(--accent-rgb),0.10)",
  accentDim: "rgba(var(--accent-rgb),0.08)",
  accentBorder: "rgba(var(--accent-rgb),0.20)",
  textDim: "rgba(236,237,238,0.80)",
  textMuted: "rgba(236,237,238,0.55)",
  ink: "#ECEDEE",
  inkRgb: "236, 237, 238",
  inkSoft: "rgba(236,237,238,0.62)",
  earn: "#A1A1AA",
  violet: "#C4B5FD",
  surface: "#1C1F21",
  surface2: "#26292C",
  headerBg: "rgba(18,20,21,0.82)",
  fieldBg: "rgba(255,255,255,0.04)",
  fieldBorder: "rgba(255,255,255,0.13)",
  scrim: "rgba(0,0,0,0.55)",
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

const escHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const printElement = (elId, title) => {
  const el = document.getElementById(elId);
  if (!el) return;

  const css = `
    @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #fff; color: #111; font-family: 'Plus Jakarta Sans', sans-serif; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; letter-spacing: -0.01em; }
    body { padding: 16px; }
    #invoice-printable { width: 100% !important; max-width: 760px !important; min-height: 0 !important; margin: 0 auto !important; box-shadow: none !important; padding: 24px !important; }
    #history-printable, #history-printable * { color: #111 !important; background: transparent !important; border-color: #ddd !important; }
    .no-print, .no-print-modal-overlay { display: none !important; }
    @media print { @page { margin: 14mm; size: auto; } body { padding: 0; } }
  `;

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escHtml(title || "Print")}</title><style>${css}</style></head><body>${el.outerHTML}<script>
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

const inpStyle = {
  width: "100%", boxSizing: "border-box", padding: "11px 14px",
  background: "var(--field-bg)", border: "1px solid var(--field-border)",
  borderRadius: 8, color: "var(--ink)", fontSize: 14, outline: "none",
  fontFamily: "'Space Grotesk',sans-serif", transition: "border-color 0.2s",
};

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{
        display: "block", fontSize: 12.5, color: C.textDim, marginBottom: 5, fontWeight: 600,
      }}>{label}</label>
      {children}
    </div>
  );
}

function Btn({ children, onClick, disabled, variant, style: s }) {
  const isPrimary = variant !== "secondary";
  const base = isPrimary
    ? {
      background: disabled ? "rgba(var(--pop-rgb),0.35)" : "var(--pop)",
      color: "#fff",
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
};
function Icon({ name, size = 18, stroke = 1.7, style }) {
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
function ThemeToggle({ dark, onToggle }) {
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

function StatCard({ label, amount, delta = null, pop = false, currency = null }) {
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
function BrutalCheck({ checked, onChange, size = 17, ariaLabel }) {
  return (
    <span className="brutal-check" style={{ fontSize: size }}>
      <input type="checkbox" checked={checked} onChange={onChange} aria-label={ariaLabel} />
      <span className="bmk" />
    </span>
  );
}

function RevenueTrend({ records, delay = 0, profitOf = null, currency = null }) {
  const { terms } = useConfig();
  const [gran, setGran] = useState("daily");
  const [metric, setMetric] = useState("revenue");
  const [hover, setHover] = useState(null);
  const isProfit = metric === "profit" && !!profitOf;
  // Values aggregate in base currency; `currency` re-denominates for display.
  const dispRate = currency ? (curInfo(currency).rate || 1) : 1;
  const cfmt = (v) => (currency ? fmtIn(v, currency) : fmt(v));

  const series = useMemo(() => {
    const bucket = {};
    records.forEach((r) => {
      let key, label;
      if (gran === "yearly") { key = r.date.slice(0, 4); label = key; }
      else if (gran === "weekly") { key = weekKey(r.date); label = "Week of " + shortDate(key); }
      else { key = r.date; label = shortDate(r.date); }
      if (!bucket[key]) bucket[key] = { value: 0, label };
      bucket[key].value += isProfit ? (Number(profitOf(r)) || 0) : toBase(r.amount, r.currency);
    });
    const keys = Object.keys(bucket).sort();
    const sliced = gran === "yearly" ? keys.slice(-10) : gran === "weekly" ? keys.slice(-26) : keys.slice(-30);
    return sliced.map((k) => ({ key: k, value: money(bucket[k].value / dispRate), label: bucket[k].label }));
  }, [records, gran, isProfit, dispRate]);

  const lineRef = useRef(null);
  const W = 1000, H = 170, pad = 14;
  const unitLabel = gran === "yearly" ? "year" : gran === "weekly" ? "week" : "day";

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
    return { line: d, fill: d + ` L${W - pad},${H} L${pad},${H} Z`, last: pts[pts.length - 1], pts, max, total: vals.reduce((a, b) => a + b, 0) };
  }, [series]);

  useEffect(() => { setHover(null); }, [gran]);

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

  const onMove = (e) => {
    if (!geom) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = (e.clientX - rect.left) / rect.width;
    const n = series.length;
    let i = n <= 1 ? 0 : Math.round(((relX * W - pad) / (W - pad * 2)) * (n - 1));
    i = Math.max(0, Math.min(n - 1, i));
    const pt = geom.pts[i];
    setHover({ i, x: pt[0], y: pt[1], value: series[i].value, label: series[i].label });
  };

  const grans = [{ k: "daily", l: "Daily" }, { k: "weekly", l: "Weekly" }, { k: "yearly", l: "Yearly" }];
  const metrics = [{ k: "revenue", l: "Revenue" }, { k: "profit", l: "Profit" }];
  // Profit line is green; revenue keeps the brand "pop" orange.
  const lineC = isProfit ? "#22C55E" : "var(--pop)";
  const lineC2 = isProfit ? "#16A34A" : "var(--pop2)";
  // Shared segmented-control button style (used by both toggles so they align identically).
  const segBtn = (active, activeColor) => ({
    padding: "5px 12px", borderRadius: 7, border: "none", cursor: "pointer",
    fontSize: 12, fontWeight: 600, fontFamily: "'Space Grotesk',sans-serif",
    background: active ? "var(--card)" : "transparent",
    color: active ? activeColor : "var(--text-dim)",
    boxShadow: active ? "0 1px 4px rgba(var(--ink-rgb),0.12)" : "none",
    transition: "all 0.18s",
  });
  const segWrap = { display: "inline-flex", background: "rgba(var(--ink-rgb),0.05)", borderRadius: 8, padding: 3, gap: 2 };

  return (
    <div className="lift" style={{
      background: C.card, border: "1px solid " + C.cardBorder, borderRadius: 12, padding: "20px 22px 8px",
      marginBottom: 28, position: "relative", overflow: "hidden",      boxShadow: "0 18px 44px rgba(var(--ink-rgb),0.08), inset 0 1px 0 rgba(var(--ink-rgb),0.05)",
    }}>
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none",
        background: "radial-gradient(420px 200px at 6% -30%, rgba(var(--accent-rgb),0.12), transparent 70%)" }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", position: "relative", zIndex: 1, gap: 14, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: -0.2, fontFamily: "'Space Grotesk',sans-serif" }}>{isProfit ? "Profit trend" : "Revenue trend"}</div>
          {geom && (
            <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: -0.6, lineHeight: 1.05, marginTop: 6, fontFamily: "'Space Grotesk',sans-serif", fontVariantNumeric: "tabular-nums", color: isProfit ? "#22C55E" : "var(--ink)" }}>{cfmt(geom.total)}</div>
          )}
          <div style={{ fontSize: 12.5, color: C.textMuted, marginTop: geom ? 5 : 4 }}>
            {series.length === 0 ? `No ${terms.revenue.many.toLowerCase()} recorded yet` : `Across ${series.length} active ${series.length === 1 ? unitLabel : unitLabel + "s"}`}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end", alignItems: "center" }}>
          {profitOf && (
            <div style={segWrap}>
              {metrics.map((m) => (
                <button key={m.k} onClick={() => setMetric(m.k)} style={segBtn(metric === m.k, m.k === "profit" ? "#22C55E" : "var(--pop)")}>{m.l}</button>
              ))}
            </div>
          )}
          <div style={segWrap}>
            {grans.map((g) => (
              <button key={g.k} onClick={() => setGran(g.k)} style={segBtn(gran === g.k, "var(--pop)")}>{g.l}</button>
            ))}
          </div>
        </div>
      </div>

      {geom ? (
        <div style={{ position: "relative", marginTop: 6 }} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" height={H} style={{ display: "block", cursor: "crosshair" }} aria-label="Revenue trend line chart">
            <defs>
              <linearGradient id="rtfill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={lineC} stopOpacity="0.28" />
                <stop offset="100%" stopColor={lineC} stopOpacity="0" />
              </linearGradient>
              <linearGradient id="rtstroke" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor={lineC2} />
                <stop offset="100%" stopColor={lineC} />
              </linearGradient>
            </defs>
            <path d={geom.fill} fill="url(#rtfill)" />
            <path ref={lineRef} d={geom.line} fill="none" stroke="url(#rtstroke)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            {hover ? (
              <>
                <line x1={hover.x} y1={pad} x2={hover.x} y2={H} stroke={lineC} strokeWidth="1" strokeDasharray="4 4" opacity="0.5" />
                <circle cx={hover.x} cy={hover.y} r="5.5" fill={lineC} stroke="#fff" strokeWidth="2.5" />
              </>
            ) : (
              <>
                <circle cx={geom.last[0]} cy={geom.last[1]} r="4.5" fill={lineC} />
                <circle cx={geom.last[0]} cy={geom.last[1]} r="4.5" fill={lineC} opacity="0.4">
                  <animate attributeName="r" values="4.5;11;4.5" dur="2.2s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.4;0;0.4" dur="2.2s" repeatCount="indefinite" />
                </circle>
              </>
            )}
          </svg>
          {hover && (
            <div style={{
              position: "absolute", left: `${(hover.x / W) * 100}%`, top: hover.y,
              transform: `translate(${hover.x > W * 0.7 ? "-105%" : hover.x < W * 0.3 ? "5%" : "-50%"}, -130%)`,
              background: "var(--ink)", color: "var(--accent-fg)", padding: "7px 11px", borderRadius: 8,
              pointerEvents: "none", whiteSpace: "nowrap", zIndex: 2,
              boxShadow: "0 8px 24px rgba(var(--ink-rgb),0.28)",
            }}>
              <div style={{ fontSize: 14, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace" }}>{cfmt(hover.value)}</div>
              <div style={{ fontSize: 10.5, opacity: 0.7, marginTop: 1 }}>{hover.label}</div>
            </div>
          )}
        </div>
      ) : (
        <div style={{ height: H, display: "flex", alignItems: "center", justifyContent: "center", color: C.textMuted, fontSize: 13 }}>
          {`Your revenue trend will appear here once you log ${terms.revenue.many.toLowerCase()}.`}
        </div>
      )}
    </div>
  );
}

const ROLE_SEG_COLORS = ["#2563EB", "#0D9488", "#7C3AED", "#CA8A04", "#DB2777", "#0891B2"];
function SplitRing({ total, agency, chatter, extras = [], chatterLabel = "Chatters", segments = null, subtitle = null, delay = 0, currency = null }) {
  const r = 52, circ = 2 * Math.PI * r;
  const cfmt = (v) => (currency ? fmtIn(v, currency) : fmt(v));
  let segs;
  if (segments) {
    segs = segments.filter(Boolean).map((s, i) => ({ key: s.key || ("seg-" + i), label: s.label, val: Math.max(0, s.val || 0), color: s.color }));
  } else {
    const extrasSum = extras.reduce((a, e) => a + (e.amount || 0), 0);
    const creator = Math.max(0, total - agency - chatter - extrasSum);
    segs = [
      { key: "creator", label: "Creators kept", val: creator, color: "#D8D8DC" },
      ...extras.map((e, i) => ({ key: "role-" + i, label: e.name, val: e.amount || 0, color: ROLE_SEG_COLORS[i % ROLE_SEG_COLORS.length] })),
      { key: "chatter", label: chatterLabel, val: chatter, color: "#F9A78C" },
      { key: "agency", label: "Agency (you)", val: agency, color: "var(--pop)" },
    ];
  }
  const sum = segs.reduce((a, s) => a + s.val, 0) || 1;
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
    <div className="lift" style={{
      background: C.card, border: "1px solid " + C.cardBorder, borderRadius: 12, padding: "20px 22px",
      marginBottom: 28, animationDelay: delay + "ms", display: "flex", flexDirection: "column",
      boxShadow: "0 18px 44px rgba(var(--ink-rgb),0.08), inset 0 1px 0 rgba(var(--ink-rgb),0.05)",
    }}>
      <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: -0.2, fontFamily: "'Space Grotesk',sans-serif", marginBottom: 2 }}>Where the money goes</div>
      <div style={{ fontSize: 13, color: C.textMuted, marginBottom: 16 }}>{subtitle || `Split of ${cfmt(total)} gross`}</div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 26, flexWrap: "wrap", flex: 1 }}>
        <svg width="128" height="128" viewBox="0 0 128 128" style={{ flex: "none" }} aria-label="Revenue split donut">
          <circle cx="64" cy="64" r={r} fill="none" stroke="rgba(var(--ink-rgb),0.06)" strokeWidth="15" />
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
              <span style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 600, color: "var(--ink)" }}>{cfmt(a.val)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ActivityHeatmap({ records, weeks = 18, delay = 0, currency = null }) {
  const { terms } = useConfig();
  // Values aggregate in base currency; `currency` re-denominates for display.
  const dispRate = currency ? (curInfo(currency).rate || 1) : 1;
  const cfmt = (v) => (currency ? fmtIn(v, currency) : fmt(v));
  const { cols, max, activeDays, total, monthMarks } = useMemo(() => {
    const byDate = {};
    records.forEach((r) => { byDate[r.date] = (byDate[r.date] || 0) + toBase(r.amount, r.currency) / dispRate; });
    const end = new Date(); end.setHours(0, 0, 0, 0);
    const lastSat = new Date(end); lastSat.setDate(end.getDate() + (6 - end.getDay()));
    const totalDays = weeks * 7;
    const start = new Date(lastSat); start.setDate(lastSat.getDate() - (totalDays - 1));
    const keyOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    let max = 0, active = 0, total = 0;
    const cells = [];
    for (let i = 0; i < totalDays; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      const v = byDate[keyOf(d)] || 0;
      if (v > 0) { active++; total += v; }
      if (v > max) max = v;
      cells.push({ d, value: v, future: d > end });
    }
    const cols = [], monthMarks = [];
    let lastMonth = -1;
    for (let c = 0; c < weeks; c++) {
      cols.push(cells.slice(c * 7, c * 7 + 7));
      const m = cells[c * 7].d.getMonth();
      if (m !== lastMonth) {
        if (monthMarks.length === 0 || c - monthMarks[monthMarks.length - 1].col >= 3)
          monthMarks.push({ col: c, label: cells[c * 7].d.toLocaleString("default", { month: "short" }) });
        lastMonth = m;
      }
    }
    return { cols, max, activeDays: active, total, monthMarks };
  }, [records, weeks, dispRate]);

  const levels = [0, 0.22, 0.42, 0.66, 1];
  const level = (v) => (v <= 0 ? 0 : (() => { const r = v / (max || 1); return r > 0.66 ? 4 : r > 0.33 ? 3 : r > 0.12 ? 2 : 1; })());
  const cellColor = (lv) => (lv === 0 ? "rgba(var(--ink-rgb),0.045)" : `rgba(var(--pop-rgb), ${levels[lv]})`);
  const CELL = 13, GAP = 3, ROW = CELL + GAP;

  return (
    <div className="lift" style={{
      background: C.card, border: "1px solid " + C.cardBorder, borderRadius: 12, padding: "20px 22px",
      marginBottom: 28, position: "relative", overflow: "hidden",      boxShadow: "0 18px 44px rgba(var(--ink-rgb),0.08), inset 0 1px 0 rgba(var(--ink-rgb),0.05)",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: -0.2, fontFamily: "'Space Grotesk',sans-serif" }}>Activity</div>
          <div style={{ fontSize: 13, color: C.textMuted, marginTop: 4 }}>
            {activeDays === 0 ? `No ${terms.revenue.many.toLowerCase()} in the last ${weeks} weeks` : `${activeDays} active ${activeDays === 1 ? "day" : "days"} · last ${weeks} weeks`}
          </div>
        </div>
        {total > 0 && <div style={{ fontSize: 13, fontWeight: 700, color: C.accent, fontFamily: "'JetBrains Mono',monospace" }}>{cfmt(total)}</div>}
      </div>

      <div className="mobile-scroll-x" style={{ overflowX: "auto", paddingBottom: 4 }}>
        <div style={{ display: "inline-block", minWidth: "min-content" }}>
          <div style={{ display: "flex", gap: GAP, marginLeft: 26, height: 16, position: "relative" }}>
            {monthMarks.map((m) => (
              <span key={m.col} style={{ position: "absolute", left: 26 + m.col * ROW - 26, fontSize: 10, color: C.textMuted, fontFamily: "'JetBrains Mono',monospace" }}>{m.label}</span>
            ))}
          </div>
          <div style={{ display: "flex", gap: GAP }}>
            <div style={{ display: "flex", flexDirection: "column", gap: GAP, marginRight: 6, width: 20 }}>
              {["", "M", "", "W", "", "F", ""].map((lbl, i) => (
                <span key={i} style={{ height: CELL, fontSize: 9, lineHeight: CELL + "px", color: C.textMuted, fontFamily: "'JetBrains Mono',monospace" }}>{lbl}</span>
              ))}
            </div>
            {cols.map((week, ci) => (
              <div key={ci} style={{ display: "flex", flexDirection: "column", gap: GAP }}>
                {week.map((cell, ri) => {
                  const lv = level(cell.value);
                  return (
                    <div
                      key={ri}
                      title={cell.future ? "" : `${cell.d.toLocaleDateString("en-GB")} · ${cell.value > 0 ? cfmt(cell.value) : "no " + terms.revenue.many.toLowerCase()}`}
                      style={{
                        width: CELL, height: CELL, borderRadius: 3,
                        background: cell.future ? "transparent" : cellColor(lv),
                        boxShadow: lv >= 3 ? "0 0 8px rgba(var(--pop-rgb),0.40)" : "none",
                        opacity: cell.future ? 0 : 1,
                        animation: "fadeIn .4s ease backwards",
                                              }}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6, marginTop: 12, fontSize: 10, color: C.textMuted, fontFamily: "'JetBrains Mono',monospace" }}>
        <span>Less</span>
        {[0, 1, 2, 3, 4].map((lv) => (
          <span key={lv} style={{ width: 11, height: 11, borderRadius: 3, background: cellColor(lv) }} />
        ))}
        <span>More</span>
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

const CLIENT_COLORS = [
  "#F35627", "#2563EB", "#16A34A", "#7C3AED", "#0891B2",
  "#DB2777", "#CA8A04", "#475569", "#DC2626", "#0D9488",
];

// A client's avatar color: explicit choice if set, else a stable color derived from its name.
const clientColor = (cl) => {
  if (!cl) return CLIENT_COLORS[0];
  if (cl.color) return cl.color;
  const n = cl.name || "A";
  let h = 0;
  for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0;
  return CLIENT_COLORS[h % CLIENT_COLORS.length];
};

function Avatar({ name, size, color }) {
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

// Shared nav for both agency modes. Desktop: horizontal tab row. Mobile (≤640px):
// compact bar with the active tab's name and a hamburger opening NavDrawer.
function TabBar({ tabs: tabsProp, active, onChange, onSettings }) {
  const { terms } = useConfig();
  const [menuOpen, setMenuOpen] = useState(false);
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

/* ── Share Card ── */
function ShareCard({ chatters: list, clientNameStr, date, onClose, currency }) {
  const { business, terms } = useConfig();
  const isSingle = list.length === 1;
  const totalCut = sumMoney(list, (c) => c.chatterCut);
  const singlePercent = list[0]?.chatterCutPercent !== undefined ? (list[0].chatterCutPercent * 100).toFixed(1) + "%" : "";
  const uniquePercents = [...new Set(list.map((c) => c.chatterCutPercent))].filter((p) => p !== undefined);
  const displayPercentStr = uniquePercents.length === 1 ? ` (${(uniquePercents[0] * 100).toFixed(1)}%)` : "";

  return (
    <Modal open={true} onClose={onClose} title="Share Earnings">
      <div style={{
        background: "var(--surface)",
        borderRadius: 12, padding: "26px 28px", marginBottom: 18,
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
              width: 32, height: 32, borderRadius: 8, objectFit: "contain",
              background: "rgba(0,0,0,0.15)",
            }} />
          ) : (
            <div style={{
              width: 32, height: 32, borderRadius: 8, display: "grid", placeItems: "center",
              background: "var(--accent)", color: "var(--accent-fg)",
              fontWeight: 800, fontSize: 17,
            }}>{(business.name || "?").charAt(0).toUpperCase()}</div>
          )}
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--ink)" }}>{business.name}</div>
            <div style={{ fontSize: 10, color: C.textMuted, fontFamily: "'JetBrains Mono',monospace", letterSpacing: 0.8 }}>EARNINGS REPORT</div>
          </div>
          <div style={{ marginLeft: "auto", fontSize: 11, color: C.textMuted, fontFamily: "'JetBrains Mono',monospace" }}>{date}</div>
        </div>

        {isSingle ? (
          <div>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: C.textDim, fontFamily: "'JetBrains Mono',monospace", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 4 }}>{terms.staff.one}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: "var(--ink)" }}>{list[0].name}</div>
              <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>{clientNameStr}</div>
            </div>
            <div style={{
              background: "rgba(251,191,36,0.06)", borderRadius: 12, padding: "16px 18px",
              border: "1px solid rgba(251,191,36,0.08)",
            }}>
              <div style={{ fontSize: 10, color: C.textDim, fontFamily: "'JetBrains Mono',monospace", letterSpacing: 0.5, marginBottom: 4 }}>YOUR EARNINGS{singlePercent ? ` (${singlePercent})` : ""}</div>
              <div style={{ fontSize: 26, fontWeight: 700, color: C.earn }}>{fmtIn(list[0].chatterCut, currency)}</div>
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
                  padding: "10px 14px", background: "rgba(251,191,36,0.04)", borderRadius: 8,
                  border: "1px solid rgba(251,191,36,0.06)",
                }}>
                  <span style={{ fontWeight: 600, fontSize: 14, color: "var(--ink)" }}>{c.name}</span>
                  <span style={{ fontWeight: 700, fontSize: 16, color: C.earn, fontFamily: "'JetBrains Mono',monospace" }}>{fmtIn(c.chatterCut, currency)}</span>
                </div>
              ))}
            </div>
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "12px 14px", background: "rgba(var(--accent-rgb),0.05)", borderRadius: 8,
              border: "1px solid " + C.accentBorder,
            }}>
              <span style={{ fontWeight: 600, fontSize: 13, color: C.textDim }}>Total Payouts</span>
              <span style={{ fontWeight: 700, fontSize: 18, color: C.accent, fontFamily: "'JetBrains Mono',monospace" }}>{fmtIn(totalCut, currency)}</span>
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

function InvoiceView({ record, client, onClose, customAmount, isPrinting, onDonePrinting, onOpenSettings, invoices = [], onUpsertInvoice }) {
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
          <div style={{ width: 56, height: 56, borderRadius: 15, margin: "0 auto 14px", display: "grid", placeItems: "center", background: "rgba(var(--ink-rgb),0.04)", border: "1px solid " + C.cardBorder, color: C.textDim }}><Icon name="file-text" size={26} stroke={1.6} /></div>
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
  const invCur = (record.currency || baseCode());
  const taxRate = Number(locale.taxRate) || 0;
  const tax = money(invAmount * taxRate);
  const total = money(invAmount + tax);

  useEffect(() => {
    if (isPrinting) {
      printElement("invoice-printable", "Invoice_" + invNo.replace(/\//g, "_"));
      onDonePrinting?.();
    }
  }, [isPrinting, invNo, onDonePrinting]);

  // Email-this-invoice flow: opens a pre-filled draft in the user's own mail app (no backend).
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailTo, setEmailTo] = useState("");
  const openEmailDraft = () => {
    if (!emailTo.trim()) return;
    const subject = `Invoice ${invNo} from ${business.name}`;
    const body = [
      "Hi,",
      "",
      `Here is invoice ${invNo} for ${fmtIn(total, invCur)}, dated ${dateStr}${invoice.dueDays ? ` (due ${dueStr})` : ""}.`,
      "",
      "Thanks,",
      business.name,
    ].join("\n");
    const url = `mailto:${encodeURIComponent(emailTo.trim())}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    if (typeof window !== "undefined") window.location.href = url;
    // Opening the draft marks the invoice Sent (you can change it back in the Invoices tab).
    onUpsertInvoice?.({ number: invNo, clientName: client.name, amount: total, currency: invCur, issueDate: record.date, dueDate: due.toISOString().slice(0, 10), status: "sent" });
  };

  return (
    <Modal open={true} onClose={onClose} title="Invoice Preview">
      <div id="invoice-printable" style={{
        background: "#fff", color: "#000", padding: "40px", borderRadius: 4,
        fontFamily: "'Plus Jakarta Sans', sans-serif", width: "100%", maxWidth: "760px", margin: "0 auto",
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
            <div style={{ flex: 1, textAlign: "right" }}>{fmtIn(invAmount, invCur)}</div>
            <div style={{ flex: 1, textAlign: "right" }}>{fmtIn(invAmount, invCur)}</div>
          </div>
        </div>

        {/* Summary */}
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <div style={{ width: "300px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, fontSize: 13 }}>
              <span>Untaxed Amount</span>
              <span>{fmtIn(invAmount, invCur)}</span>
            </div>
            {taxRate > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, fontSize: 13 }}>
                <span>{locale.taxLabel || "Tax"} ({(taxRate * 100).toFixed(taxRate * 100 % 1 ? 1 : 0)}%)</span>
                <span>{fmtIn(tax, invCur)}</span>
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, fontSize: 13, borderTop: "1px solid #000", paddingTop: 8 }}>
              <span>Total</span>
              <span>{fmtIn(total, invCur)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: 14 }}>
              <span>Amount Due</span>
              <span>{fmtIn(total, invCur)}</span>
            </div>
          </div>
        </div>

        {/* Bottom Text */}
        <div style={{ marginTop: 60 }}>
          {locale.amountInWords !== false && invCur === baseCode() && (
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

      {onUpsertInvoice && (() => {
        const stored = invoices.find((i) => i.number === invNo);
        const cur = stored ? stored.status : null;
        const setStatus = (status) => onUpsertInvoice({
          number: invNo, clientName: client.name, amount: total, currency: invCur,
          issueDate: record.date, dueDate: due.toISOString().slice(0, 10), status,
        });
        const opts = [{ k: "draft", l: "Draft", c: "#64748B" }, { k: "sent", l: "Sent", c: "#2563EB" }, { k: "paid", l: "Paid", c: "#16A34A" }];
        return (
          <div className="no-print" style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, color: C.textDim, fontWeight: 600 }}>Status</span>
            {opts.map((o) => (
              <button key={o.k} onClick={() => setStatus(o.k)} style={{
                padding: "6px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12.5, fontWeight: 700,
                border: "1px solid " + (cur === o.k ? o.c : "rgba(var(--ink-rgb),0.1)"),
                background: cur === o.k ? o.c : "transparent", color: cur === o.k ? "#fff" : C.textDim,
              }}>{o.l}</button>
            ))}
            {!cur && <span style={{ fontSize: 11.5, color: C.textMuted }}>Pick a status to start tracking this invoice</span>}
          </div>
        );
      })()}

      <div className="no-print" style={{ marginTop: 14 }}>
        {emailOpen ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Field label="Send invoice to">
              <input type="email" placeholder="client@email.com" value={emailTo} autoFocus
                onChange={(e) => setEmailTo(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") openEmailDraft(); }}
                style={inpStyle} />
            </Field>
            <div style={{ fontSize: 11.5, color: C.textMuted, lineHeight: 1.5 }}>Opens a draft in your email app. Save the PDF first (if you want to attach it), then send.</div>
            <div style={{ display: "flex", gap: 8 }}>
              <Btn variant="secondary" onClick={() => setEmailOpen(false)} style={{ flex: 1 }}>Back</Btn>
              <Btn onClick={openEmailDraft} disabled={!emailTo.trim()} style={{ flex: 1 }}>Open email draft</Btn>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 8 }}>
            <Btn variant="secondary" onClick={onClose} style={{ flex: 1 }}>Close</Btn>
            <Btn variant="secondary" onClick={() => setEmailOpen(true)} style={{ flex: 1 }}><Icon name="share" size={14} style={{ marginRight: 6 }} />Email</Btn>
            <Btn onClick={() => printElement("invoice-printable", "Invoice_" + invNo.replace(/\//g, "_"))} style={{ flex: 1 }}><Icon name="download" size={14} style={{ marginRight: 6 }} />PDF</Btn>
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ═══ MAIN APP ═══ */

function CurrencySelect({ value, onChange }) {
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
function CurrencyPicker({ value, onChange, style }) {
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

function SettingsPanel({ initial, onClose, onSave, onResetData }) {
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
                <div style={{ width: 46, height: 46, borderRadius: 8, flex: "none", display: "grid", placeItems: "center", background: "var(--pop)", color: "#fff", fontWeight: 800, fontSize: 20, fontFamily: "'Space Grotesk',sans-serif" }}>{(d.business.name || "?").charAt(0).toUpperCase()}</div>
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
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
              <select value={c.code || ""} onChange={(e) => pickRowCurrency(i, e.target.value)}
                style={{ ...inpStyle, width: 150, cursor: "pointer", background: "var(--surface)", fontFamily: "'JetBrains Mono',monospace" }}>
                <option value="">Pick…</option>
                {c.code && !curCatalog(c.code) && <option value={c.code}>{c.code}</option>}
                {CURRENCY_CATALOG.filter((cc) => cc.code !== (d.locale.currency || "USD").toUpperCase())
                  .map((cc) => <option key={cc.code} value={cc.code}>{cc.code} ({cc.symbol})</option>)}
              </select>
              <input placeholder="€" value={c.symbol || ""} onChange={(e) => setD((s) => ({ ...s, currencies: s.currencies.map((x, idx) => idx === i ? { ...x, symbol: e.target.value } : x) }))}
                style={{ ...inpStyle, width: 52, textAlign: "center" }} />
              <div style={{ position: "relative", flex: 1 }}>
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

function Onboarding({ onComplete }) {
  const [step, setStep] = useState(0);
  const [type, setType] = useState("service");
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [symbol, setSymbol] = useState("$");
  const [accent] = useState("#111111");
  const [terms, setTerms] = useState(AGENCY_PRESETS.service.terms);
  const [agencyDefault, setAgencyDefault] = useState({ model: "percent", rate: AGENCY_PRESETS.service.commission.agencyShare });
  const [staffDefault, setStaffDefault] = useState({ model: "percent", rate: AGENCY_PRESETS.service.commission.staffShare });
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
    const cat = curCatalog(base.locale.currency);
    base.locale.currencySymbol = symbol || (cat ? cat.symbol : "$");
    if (cat) { base.locale.locale = cat.locale; base.locale.currencyWords = cat.words; }
    base.branding.accent = "#111111";
    base.branding.accent2 = "#5C5C5C";
    base.branding.accent3 = "#2E2E2E";
    base.terms = terms;
    base.commission.defaults = { agency: agencyDefault, staff: staffDefault };
    base.invoice.lineItemLabel = preset.lineItemLabel;
    base.agencyType = type;
    base.onboarded = true;
    onComplete(base);
  };

  const canNext = step === 0 ? !!type : step === 1 ? name.trim().length > 0 : true;
  const half = { flex: "1 1 150px", minWidth: 130 };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 2200, background: "var(--bg)",
      backgroundImage: "radial-gradient(900px 520px at 50% -10%, rgba(var(--accent-rgb),0.08), transparent 60%), radial-gradient(700px 600px at 50% 120%, rgba(17,17,17,0.03), transparent 55%)",
      overflowY: "auto", animation: "fadeIn 0.25s ease",
    }}>
      <div style={{ maxWidth: 560, margin: "0 auto", padding: "44px 22px 90px", minHeight: "100%" }}>
        {/* brand mark */}
        <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 30 }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, display: "grid", placeItems: "center", background: "var(--accent)", color: "#fff", fontWeight: 800, fontSize: 20 }}>
            {(name || "A").charAt(0).toUpperCase()}
          </div>
          <div style={{ fontSize: 13, color: C.textDim, fontFamily: "'JetBrains Mono',monospace", letterSpacing: 1 }}>SET UP YOUR WORKSPACE</div>
        </div>

        {/* progress dots */}
        <div style={{ display: "flex", gap: 6, marginBottom: 26 }}>
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ height: 4, flex: 1, borderRadius: 99, background: i <= step ? "var(--accent)" : "rgba(var(--ink-rgb),0.08)", transition: "background .3s" }} />
          ))}
        </div>

        {step === 0 && (
          <div>
            <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 6 }}>What kind of agency do you run?</h2>
            <p style={{ fontSize: 13.5, color: C.textDim, marginBottom: 22 }}>Pick the model that fits how you make money — you can change wording later.</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
              {Object.entries(AGENCY_PRESETS).map(([k, p]) => (
                <button key={k} onClick={() => pickType(k)} style={{
                  textAlign: "left", padding: "20px 20px", borderRadius: 12, cursor: "pointer",
                  background: type === k ? "var(--accent-dim)" : C.card,
                  border: "1px solid " + (type === k ? "var(--accent-border)" : C.cardBorder),
                  transition: "all .2s", color: "var(--ink)", display: "flex", gap: 16, alignItems: "flex-start",
                }}>
                  <div style={{
                    width: 46, height: 46, borderRadius: 12, flex: "none", display: "grid", placeItems: "center",
                    background: type === k ? "var(--accent)" : "rgba(var(--ink-rgb),0.05)",
                    color: type === k ? "#fff" : C.textDim, transition: "all .2s",
                  }}>
                    <Icon name={p.icon} size={22} />
                  </div>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 700 }}>{p.label}</div>
                    <div style={{ fontSize: 12.5, color: C.textMuted, marginTop: 5, lineHeight: 1.55 }}>{p.desc}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 1 && (
          <div>
            <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 6 }}>Tell us about your agency</h2>
            <p style={{ fontSize: 13.5, color: C.textDim, marginBottom: 22 }}>Just the basics to brand your workspace.</p>
            <Field label="Agency name"><input style={inpStyle} value={name} autoFocus onChange={(e) => setName(e.target.value)} placeholder="e.g. Acme Studio" /></Field>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <div style={half}><Field label="Currency"><CurrencyPicker value={currency} onChange={(code) => { setCurrency(code); const cat = curCatalog(code); if (cat) setSymbol(cat.symbol); }} /></Field></div>
              <div style={half}><Field label="Symbol"><input style={inpStyle} value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="$" /></Field></div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 6 }}>Confirm your wording</h2>
            <p style={{ fontSize: 13.5, color: C.textDim, marginBottom: 22 }}>These labels appear throughout the app. Tweak if you like.</p>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <div style={half}><Field label="You call clients"><input style={inpStyle} value={terms.client.many} onChange={(e) => setTerm("client", "many", e.target.value)} /></Field></div>
              <div style={half}><Field label="You call staff"><input style={inpStyle} value={terms.staff.many} onChange={(e) => setTerm("staff", "many", e.target.value)} /></Field></div>
            </div>
            <Field label="You call revenue items"><input style={inpStyle} value={terms.revenue.many} onChange={(e) => setTerm("revenue", "many", e.target.value)} /></Field>
            <div style={{ height: 1, background: "rgba(var(--ink-rgb),0.06)", margin: "8px 0 16px" }} />
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

// ═══════════════════════════════════════════════════════════════════════
// TYPE 2 — MANAGEMENT AGENCY
// You manage a brand/creator. They pay you (client payment in); you incur
// operating expenses across categories. Profit = client payment − expenses.
// ═══════════════════════════════════════════════════════════════════════
// Palette for user-defined expense categories (assigned as new ones are added).
const EXP_CAT_COLORS = ["#F9A78C", "#A78BFA", "#5EEAD4", "#94A3B8", "#FBBF24", "#60A5FA", "#F472B6", "#34D399"];
// Sum an entry's expenses. New entries store { expenses: { [catId]: amount } }; older
// ones used flat keys (chatting/designing/...) — support both so nothing breaks.
const entryExpenses = (e) => {
  if (e && e.expenses && typeof e.expenses === "object") return sumMoney(Object.values(e.expenses), (v) => Number(v) || 0);
  return sumMoney(["chatting", "designing", "marketing", "other"], (k) => Number(e[k]) || 0);
};
const entryProfit = (e) => money((Number(e.payment) || 0) - entryExpenses(e));
const mMonthKey = (d) => (d || "").slice(0, 7);
const mMonthLabel = (m) => {
  if (!m) return "";
  const [y, mo] = m.split("-");
  try { return new Date(Number(y), Number(mo) - 1, 1).toLocaleString(undefined, { month: "short", year: "numeric" }); }
  catch { return m; }
};
const mDate = (s) => {
  try { return new Date(s + "T00:00:00").toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "2-digit" }); }
  catch { return s; }
};

// Shared "Insights" strip: auto-generated callout cards. Used by both agency modes.
function InsightsPanel({ highlights = [], delay = 0 }) {
  const items = highlights.filter(Boolean);
  if (!items.length) return null;
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: -0.2, fontFamily: "'Space Grotesk',sans-serif", marginBottom: 12 }}>Insights</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 12 }}>
        {items.map((it, i) => (
          <div key={i} className="lift" style={{
            background: C.card, border: "1px solid " + C.cardBorder, borderRadius: 14,
            padding: "14px 16px", display: "flex", alignItems: "center", gap: 12,
          }}>
            <div style={{
              width: 38, height: 38, borderRadius: 8, flex: "none", display: "grid", placeItems: "center",
              background: it.tone === "good" ? "rgba(22,163,74,0.1)" : it.tone === "bad" ? "rgba(239,68,68,0.1)" : "rgba(var(--ink-rgb),0.05)",
              color: it.tone === "good" ? "#16A34A" : it.tone === "bad" ? "#ef4444" : C.textDim,
            }}>
              <Icon name={it.icon} size={18} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 10.5, color: C.textMuted, marginBottom: 3, letterSpacing: 0.3, textTransform: "uppercase", fontFamily: "'JetBrains Mono',monospace" }}>{it.label}</div>
              <div title={String(it.value)} style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.3, overflowWrap: "anywhere",
                color: it.tone === "good" ? C.earn : it.tone === "bad" ? "#ef4444" : "var(--ink)" }}>{it.value}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Shared invoice-status tracker (Draft / Sent / Paid / Overdue). Reads/writes data.invoices.
function InvoicesPanel({ invoices = [], onUpsert, delay = 0 }) {
  const list = Array.isArray(invoices) ? invoices : [];
  const isOverdue = (inv) => inv.status === "sent" && inv.dueDate && inv.dueDate < today();
  const effStatus = (inv) => (inv.status === "paid" ? "paid" : isOverdue(inv) ? "overdue" : (inv.status || "draft"));
  const META = {
    draft: { label: "Draft", color: "#64748B", bg: "rgba(100,116,139,0.14)" },
    sent: { label: "Sent", color: "#2563EB", bg: "rgba(37,99,235,0.12)" },
    paid: { label: "Paid", color: "#16A34A", bg: "rgba(22,163,74,0.12)" },
    overdue: { label: "Overdue", color: "#ef4444", bg: "rgba(239,68,68,0.12)" },
  };
  const nextStatus = { draft: "sent", sent: "paid", paid: "draft", overdue: "paid" };
  const sumBy = (pred) => list.filter(pred).reduce((a, x) => a + (Number(x.amount) || 0), 0);
  const outstanding = sumBy((i) => i.status === "sent");
  const overdueAmt = sumBy((i) => isOverdue(i));
  const paidAmt = sumBy((i) => i.status === "paid");
  const sorted = [...list].sort((a, b) => ((a.issueDate || "") < (b.issueDate || "") ? 1 : -1));

  if (!list.length) {
    return <EmptyState icon="file-text" text="No invoices tracked yet" sub="Open an invoice and pick a status to start tracking it here" />;
  }
  const cols = "1.1fr 1fr 0.9fr 0.8fr 0.8fr 92px";
  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 22 }}>
        <StatCard label="Outstanding" amount={outstanding} />
        <StatCard label="Overdue" amount={overdueAmt} />
        <StatCard label="Paid" amount={paidAmt} />
      </div>
      <div className="mobile-scroll-x" style={{ borderRadius: 14, overflow: "hidden", border: "1px solid " + C.cardBorder }}>
        <div style={{ display: "grid", gridTemplateColumns: cols, minWidth: 640, padding: "10px 18px", background: "rgba(var(--accent-rgb),0.015)", fontSize: 10, color: C.textMuted, fontFamily: "'JetBrains Mono',monospace", letterSpacing: 0.7, textTransform: "uppercase", gap: 6 }}>
          <div>Invoice</div><div>Client</div><div>Amount</div><div>Issued</div><div>Due</div><div>Status</div>
        </div>
        {sorted.map((inv) => {
          const st = effStatus(inv); const m = META[st];
          return (
            <div key={inv.number} className="recrow" style={{ display: "grid", gridTemplateColumns: cols, minWidth: 640, padding: "12px 18px", borderTop: "1px solid rgba(var(--accent-rgb),0.03)", fontSize: 13, alignItems: "center", gap: 6 }}>
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11.5, color: C.textDim, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{inv.number}</div>
              <div style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{inv.clientName}</div>
              <div style={{ fontWeight: 700, color: C.accent }}>{fmtIn(inv.amount, inv.currency)}</div>
              <div style={{ color: C.textMuted, fontSize: 11, fontFamily: "'JetBrains Mono',monospace" }}>{inv.issueDate ? shortDate(inv.issueDate) : "—"}</div>
              <div style={{ color: isOverdue(inv) ? "#ef4444" : C.textMuted, fontSize: 11, fontFamily: "'JetBrains Mono',monospace" }}>{inv.dueDate ? shortDate(inv.dueDate) : "—"}</div>
              <div>
                <button onClick={() => onUpsert({ ...inv, status: nextStatus[st] })} title="Click to change status" style={{
                  padding: "4px 11px", borderRadius: 99, border: "none", cursor: "pointer", fontSize: 11, fontWeight: 700, background: m.bg, color: m.color,
                }}>{m.label}</button>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 11, color: C.textMuted, marginTop: 10 }}>Tip: click a status pill to cycle Draft → Sent → Paid. Overdue is flagged automatically once the due date passes.</div>
    </div>
  );
}

function ManagementApp({ data, persist, config, onSettings, onInvoice, onExport, onImport }) {
  const brands = Array.isArray(data.brands) ? data.brands : [];
  const entries = Array.isArray(data.entries) ? data.entries : [];
  const cats = Array.isArray(config.expenseCategories) ? config.expenseCategories : [];
  const [tab, setTab] = useState("Dashboard");
  const importRef = useRef(null);

  // Add-entry form
  const [entryBrandId, setEntryBrandId] = useState("");
  const [entryDate, setEntryDate] = useState(today());
  const [payment, setPayment] = useState(""); // manual OVERRIDE for the client payment; blank = use the brand's calculated amount
  const [brandRevenue, setBrandRevenue] = useState(""); // brand's revenue for the period (only for %-of-revenue brands)
  const [entryHours, setEntryHours] = useState(""); // hours for any hourly-rate categories or brand payment
  const [exp, setExp] = useState({}); // per-category manual OVERRIDE; blank = use the calculated amount
  const [savedFlash, setSavedFlash] = useState(false);

  // Category management modal: null | "new" | categoryObject (editing)
  const [catModal, setCatModal] = useState(null);
  const [catName, setCatName] = useState("");
  const [catColor, setCatColor] = useState(EXP_CAT_COLORS[0]);
  const [catCost, setCatCost] = useState({ model: "percent", rate: 0.1 }); // how this spend is calculated
  const curSymbol = (config.locale && config.locale.currencySymbol) || "$";
  // Human summary of a category's cost model, e.g. "10% of payment", "$200 fixed", "$50 / hr".
  const costDesc = (cost) => {
    if (!cost) return "manual";
    if (cost.model === "percent") return (+(Number(cost.rate || 0) * 100).toFixed(2)) + "% of payment";
    if (cost.model === "flat") return fmt(cost.amount || 0) + " fixed";
    if (cost.model === "hourly") return fmt(cost.rate || 0) + " / hr";
    if (cost.model === "tiered") return "tiered %";
    return "manual";
  };
  // Human summary of a brand's payment model (how the client pays us).
  const payDesc = (p) => {
    if (!p) return "manual payment";
    if (p.model === "percent") return (+(Number(p.rate || 0) * 100).toFixed(2)) + "% of revenue";
    if (p.model === "flat") return fmt(p.amount || 0) + " retainer";
    if (p.model === "hourly") return fmt(p.rate || 0) + " / hr";
    if (p.model === "tiered") return "tiered % of revenue";
    return "manual payment";
  };

  // Brand modal: null | "new" | brandObject (editing)
  const [brandModal, setBrandModal] = useState(null);
  const [brandName, setBrandName] = useState("");
  const [brandColor, setBrandColor] = useState(CLIENT_COLORS[0]);
  const [brandPay, setBrandPay] = useState({ model: "flat", amount: 0 }); // payment structure
  const [brandPayAuto, setBrandPayAuto] = useState(false); // false = type payment manually
  const [confirmDel, setConfirmDel] = useState(null); // brand pending deletion
  const [quickMsg, setQuickMsg] = useState(null); // retainer quick-log toast

  const [monthFilter, setMonthFilter] = useState("all");

  const brandLabel = (id) => (brands.find((b) => b.id === id) || {}).name || "—";
  const brandOf = (id) => brands.find((b) => b.id === id) || null;

  // The selected brand's payment structure drives the client payment (mirrors how categories
  // drive expenses). % models bill a share of the brand's revenue; flat = retainer; hourly = rate × hours.
  const selBrand = brandOf(entryBrandId);
  const payModel = selBrand && selBrand.payment ? selBrand.payment : null;
  const payIsPercent = !!payModel && (payModel.model === "percent" || payModel.model === "tiered");
  const usesHours = cats.some((c) => c.cost && c.cost.model === "hourly") || (!!payModel && payModel.model === "hourly");
  const computedPayment = payModel ? computeShare(payModel, payIsPercent ? (Number(brandRevenue) || 0) : 0, Number(entryHours) || 0) : null;
  // A typed value overrides the calculated one for this entry.
  const effPayment = (payment !== "" && payment !== undefined) ? money(Number(payment) || 0) : money(computedPayment || 0);
  // Each spend is derived from its cost model applied to the (effective) payment and hours.
  const computedFor = (c) => computeShare(c.cost, effPayment, Number(entryHours) || 0);
  const effExp = (c) => (exp[c.id] !== undefined && exp[c.id] !== "" ? money(Number(exp[c.id]) || 0) : computedFor(c));
  const liveExpenses = sumMoney(cats, (c) => effExp(c));
  const liveProfit = money(effPayment - liveExpenses);

  const saveEntry = () => {
    if (!entryBrandId) return;
    const expenses = {};
    cats.forEach((c) => { const v = effExp(c); if (v) expenses[c.id] = v; });
    const e = {
      id: genId(), brandId: entryBrandId, date: entryDate,
      payment: effPayment, expenses,
    };
    if (usesHours && (Number(entryHours) || 0)) e.hours = Number(entryHours) || 0;
    if (payIsPercent && (Number(brandRevenue) || 0)) e.revenue = money(Number(brandRevenue) || 0);
    persist({ ...data, entries: [e, ...entries] });
    setPayment(""); setBrandRevenue(""); setEntryHours(""); setExp({});
    setSavedFlash(true); setTimeout(() => setSavedFlash(false), 1800);
  };
  const deleteEntry = (e) => persist({ ...data, entries: entries.filter((x) => x.id !== e.id) });

  // Invoice the managed brand for the client payment (the management fee they owe us).
  const invoiceEntry = (e) => onInvoice?.({
    record: { id: e.id, date: e.date, amount: e.payment, hours: 0, currency: baseCode() },
    client: { name: brandLabel(e.brandId) },
    customAmount: e.payment,
  });
  // Invoice a brand for their total payments in the current period (dashboard aggregate).
  const invoiceBrand = (b) => onInvoice?.({
    record: { id: "agg-" + b.id, date: monthFilter === "all" ? today() : monthFilter + "-01", amount: b.pay, hours: 0, currency: baseCode() },
    client: { name: b.name },
    customAmount: b.pay,
  });

  // Expense categories live in config — persist them through the whole data object.
  const saveCats = (next) => persist({ ...data, config: { ...config, expenseCategories: next } });
  const openNewCat = () => { setCatName(""); setCatColor(EXP_CAT_COLORS[cats.length % EXP_CAT_COLORS.length]); setCatCost({ model: "percent", rate: 0.1 }); setCatModal("new"); };
  const openEditCat = (c) => { setCatName(c.label); setCatColor(c.color || EXP_CAT_COLORS[0]); setCatCost(c.cost ? JSON.parse(JSON.stringify(c.cost)) : { model: "percent", rate: 0.1 }); setCatModal(c); };
  const saveCat = () => {
    const label = catName.trim();
    if (!label) return;
    if (catModal === "new") saveCats([...cats, { id: genId(), label, color: catColor, cost: catCost }]);
    else saveCats(cats.map((c) => (c.id === catModal.id ? { ...c, label, color: catColor, cost: catCost } : c)));
    setCatModal(null);
  };
  const deleteCat = (c) => saveCats(cats.filter((x) => x.id !== c.id));

  const openNewBrand = () => { setBrandName(""); setBrandColor(CLIENT_COLORS[brands.length % CLIENT_COLORS.length]); setBrandPay({ model: "flat", amount: 0 }); setBrandPayAuto(false); setBrandModal("new"); };
  const openEditBrand = (b) => { setBrandName(b.name); setBrandColor(b.color || CLIENT_COLORS[0]); setBrandPayAuto(!!b.payment); setBrandPay(b.payment ? JSON.parse(JSON.stringify(b.payment)) : { model: "flat", amount: 0 }); setBrandModal(b); };
  const saveBrand = () => {
    const name = brandName.trim();
    if (!name) return;
    const payment = brandPayAuto ? brandPay : null;
    if (brandModal === "new") {
      persist({ ...data, brands: [...brands, { id: genId(), name, color: brandColor, payment }] });
    } else {
      persist({ ...data, brands: brands.map((b) => (b.id === brandModal.id ? { ...b, name, color: brandColor, payment } : b)) });
    }
    setBrandModal(null);
  };
  const deleteBrand = (b) => {
    persist({ ...data, brands: brands.filter((x) => x.id !== b.id), entries: entries.filter((e) => e.brandId !== b.id) });
    setConfirmDel(null);
  };

  // ── Retainer quick-log ──
  const thisMonthKey = today().slice(0, 7);
  const loggedThisMonth = (brandId) => entries.some((e) => e.brandId === brandId && mMonthKey(e.date) === thisMonthKey);
  // A flat-retainer brand with no hourly inputs can be logged in one click; everything else
  // (percent/hourly payment, or hourly expense categories) needs the form to capture revenue/hours.
  const canQuickLog = (b) => b.payment && b.payment.model === "flat" && !cats.some((c) => c.cost && c.cost.model === "hourly");
  const quickLog = (b) => {
    if (!canQuickLog(b)) {
      // Open the entry form pre-filled with this brand and this month.
      setEntryBrandId(b.id); setEntryDate(today()); setPayment(""); setBrandRevenue(""); setEntryHours(""); setExp({}); setTab("Add Entry");
      return;
    }
    const pay = money(computeShare(b.payment, 0, 0));
    const expenses = {};
    cats.forEach((c) => { const v = money(computeShare(c.cost, pay, 0)); if (v) expenses[c.id] = v; });
    persist({ ...data, entries: [{ id: genId(), brandId: b.id, date: today(), payment: pay, expenses }, ...entries] });
    setQuickMsg(b.name + " · " + fmt(pay) + " logged for " + mMonthLabel(thisMonthKey));
    setTimeout(() => setQuickMsg(null), 2800);
  };

  // Dashboard aggregates (respecting the month filter).
  const months = [...new Set(entries.map((e) => mMonthKey(e.date)).filter(Boolean))].sort().reverse();
  const shown = monthFilter === "all" ? entries : entries.filter((e) => mMonthKey(e.date) === monthFilter);
  const totalPay = sumMoney(shown, (e) => e.payment);
  const totalExp = sumMoney(shown, entryExpenses);
  const profit = money(totalPay - totalExp);
  const margin = totalPay > 0 ? (profit / totalPay) * 100 : 0;
  const catTotals = cats.map((c) => ({ ...c, amount: sumMoney(shown, (e) => Number((e.expenses || {})[c.id]) || 0) }));
  const perBrand = brands.map((b) => {
    const es = shown.filter((e) => e.brandId === b.id);
    const pay = sumMoney(es, (e) => e.payment);
    const ex = sumMoney(es, entryExpenses);
    return { ...b, pay, ex, profit: money(pay - ex), count: es.length };
  }).sort((a, b) => b.profit - a.profit);
  const sortedEntries = [...shown].sort((a, b) => (a.date < b.date ? 1 : -1));
  // Map entries to the record shape the shared charts expect (amount = client payment).
  const mgmtRecords = entries.map((e) => {
    const expSum = e.expenses ? Object.values(e.expenses).reduce((a, v) => a + (Number(v) || 0), 0) : 0;
    return { date: e.date, amount: e.payment, currency: baseCode(), profit: money(e.payment - expSum) };
  });

  // ── Analytics & insights ──
  // Month-over-month deltas: latest month with data vs the one before it.
  const monthsAsc = [...months].reverse();
  const curM = monthsAsc[monthsAsc.length - 1], prevM = monthsAsc[monthsAsc.length - 2];
  const deltaFor = (valFn) => {
    if (!curM || !prevM) return null;
    const cur = valFn(entries.filter((e) => mMonthKey(e.date) === curM));
    const prev = valFn(entries.filter((e) => mMonthKey(e.date) === prevM));
    if (prev <= 0 || cur <= 0) return null; // no activity this month yet → don't show a false -100%
    return Math.round(((cur - prev) / prev) * 100);
  };
  const showDelta = monthFilter === "all"; // deltas only make sense on the all-time view
  const payDelta = showDelta ? deltaFor((es) => sumMoney(es, (e) => e.payment)) : null;
  const expDelta = showDelta ? deltaFor((es) => sumMoney(es, entryExpenses)) : null;
  const profitDelta = showDelta ? deltaFor((es) => money(sumMoney(es, (e) => e.payment) - sumMoney(es, entryExpenses))) : null;
  // Auto-generated callouts for the current period.
  const dayPay = {};
  shown.forEach((e) => { dayPay[e.date] = (dayPay[e.date] || 0) + (Number(e.payment) || 0); });
  const bestDay = Object.entries(dayPay).sort((a, b) => b[1] - a[1])[0];
  const topBrand = perBrand.find((b) => b.count > 0);
  const lowBrand = perBrand.filter((b) => b.pay > 0).map((b) => ({ ...b, margin: (b.profit / b.pay) * 100 })).sort((a, b) => a.margin - b.margin)[0];
  const avgProfit = shown.length ? money(profit / shown.length) : 0;
  const mgmtHighlights = [
    payDelta != null && { icon: payDelta >= 0 ? "trending-up" : "trending-down", label: "Payments vs last month", value: (payDelta >= 0 ? "+" : "") + payDelta + "%", tone: payDelta >= 0 ? "good" : "bad" },
    profitDelta != null && { icon: profitDelta >= 0 ? "trending-up" : "trending-down", label: "Profit vs last month", value: (profitDelta >= 0 ? "+" : "") + profitDelta + "%", tone: profitDelta >= 0 ? "good" : "bad" },
    topBrand && { icon: "award", label: "Most profitable", value: topBrand.name + " · " + fmt(topBrand.profit), tone: "good" },
    lowBrand && { icon: lowBrand.margin < 20 ? "alert" : "pie", label: "Lowest margin", value: lowBrand.name + " · " + lowBrand.margin.toFixed(0) + "%", tone: lowBrand.margin < 20 ? "bad" : "neutral" },
    bestDay && { icon: "flame", label: "Best day", value: mDate(bestDay[0]) + " · " + fmt(bestDay[1]) },
    shown.length > 0 && { icon: "file-text", label: "Avg profit / entry", value: fmt(avgProfit) },
  ];

  const NAV = ["Dashboard", "Add Entry", "Brands", "Categories", "Invoices", "History"];
  const upsertInvoice = (inv) => {
    const ilist = Array.isArray(data.invoices) ? data.invoices : [];
    const idx = ilist.findIndex((x) => x.number === inv.number);
    const next = idx >= 0 ? ilist.map((x, i) => (i === idx ? { ...x, ...inv } : x)) : [...ilist, { id: genId(), ...inv }];
    persist({ ...data, invoices: next });
  };

  return (
    <div>
      {/* Nav */}
      <TabBar tabs={NAV.map((k) => ({ key: k, label: k }))} active={tab} onChange={setTab} onSettings={onSettings} />

      {/* ═══ DASHBOARD ═══ */}
      {tab === "Dashboard" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 10 }}>
            <h2 style={{ fontSize: 21, fontWeight: 700 }}>Profit overview</h2>
            <select value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)}
              style={{ ...inpStyle, width: "auto", cursor: "pointer", background: "var(--surface)" }}>
              <option value="all">All time</option>
              {months.map((m) => <option key={m} value={m}>{mMonthLabel(m)}</option>)}
            </select>
          </div>

          {entries.length === 0 ? (
            <EmptyState icon="pie" text="No entries yet"
              sub="Add a client payment and your expenses to see profit"
              action={<Btn onClick={() => setTab(brands.length ? "Add Entry" : "Brands")}>{brands.length ? "Add an entry →" : "Add a brand first →"}</Btn>} />
          ) : (
            <>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 22 }}>
                <StatCard label="Client Payments" amount={totalPay} delta={payDelta} />
                <StatCard label="Total Expenses" amount={totalExp} delta={expDelta} />
                <StatCard label="Net Profit" amount={profit} pop delta={profitDelta} />
                <div className="lift" style={{
                  background: C.card, border: "1px solid " + C.cardBorder, borderRadius: 12,
                  padding: "20px 24px", flex: "1 1 180px", minWidth: 155,
                }}>
                  <div style={{ fontSize: 11, color: C.textDim, letterSpacing: 0.6, textTransform: "uppercase", fontFamily: "'JetBrains Mono',monospace", marginBottom: 8 }}>Profit Margin</div>
                  <div style={{ fontSize: 26, fontWeight: 800, color: profit >= 0 ? C.earn : "#ef4444" }}>{margin.toFixed(1)}%</div>
                </div>
              </div>

              <InsightsPanel highlights={mgmtHighlights} delay={160} />

              {/* Revenue trend + split donut */}
              {totalPay > 0 ? (
                <div className="dash-bento">
                  <RevenueTrend records={mgmtRecords} delay={180} profitOf={(r) => r.profit} />
                  <SplitRing total={totalPay} delay={220}
                    subtitle={`Split of ${fmt(totalPay)} received`}
                    segments={[
                      { key: "profit", label: "Profit (you keep)", val: profit, color: "var(--pop)" },
                      ...catTotals.map((c) => ({ key: c.id, label: c.label, val: c.amount, color: c.color })),
                    ]} />
                </div>
              ) : (
                <RevenueTrend records={mgmtRecords} delay={180} profitOf={(r) => r.profit} />
              )}

              {/* Activity heatmap */}
              <ActivityHeatmap records={mgmtRecords} delay={260} />

              {/* Per-brand */}
              <div style={{ background: C.card, border: "1px solid " + C.cardBorder, borderRadius: 12, padding: "20px 24px" }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 16 }}>By brand</div>
                {perBrand.filter((b) => b.count > 0).length === 0 ? (
                  <div style={{ fontSize: 12.5, color: C.textMuted }}>No entries in this period.</div>
                ) : perBrand.filter((b) => b.count > 0).map((b) => (
                  <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderTop: "1px solid rgba(var(--ink-rgb),0.05)" }}>
                    <Avatar name={b.name} size={34} color={b.color} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{b.name}</div>
                      <div style={{ fontSize: 11, color: C.textMuted, fontFamily: "'JetBrains Mono',monospace" }}>{fmt(b.pay)} in · {fmt(b.ex)} spent</div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ textAlign: "right", fontWeight: 700, color: b.profit >= 0 ? C.earn : "#ef4444" }}>{fmt(b.profit)}</div>
                      {b.pay > 0 && (
                        <button onClick={() => invoiceBrand(b)} title="Invoice this brand" style={{ background: "var(--accent-dim)", border: "none", borderRadius: 6, color: "var(--accent)", fontSize: 10, padding: "5px 9px", cursor: "pointer", fontWeight: 600, fontFamily: "'JetBrains Mono',monospace", whiteSpace: "nowrap" }}><Icon name="file-text" size={12} style={{ marginRight: 5 }} />Invoice</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* ═══ ADD ENTRY ═══ */}
      {tab === "Add Entry" && (
        <div>
          <h2 style={{ fontSize: 21, fontWeight: 700, marginBottom: 6 }}>Add an entry</h2>
          <p style={{ fontSize: 13, color: C.textDim, marginBottom: 22 }}>Record what a brand paid you and what you spent. Profit is calculated for you.</p>
          {brands.length === 0 ? (
            <EmptyState icon="briefcase" text="Add a brand first" sub="You manage brands — create one to log entries"
              action={<Btn onClick={() => setTab("Brands")}>Go to Brands →</Btn>} />
          ) : (
            <div style={{ maxWidth: 520 }}>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <div style={{ flex: "1 1 220px" }}>
                  <Field label="Brand">
                    <select value={entryBrandId} onChange={(e) => { setEntryBrandId(e.target.value); setPayment(""); setBrandRevenue(""); setExp({}); }}
                      style={{ ...inpStyle, cursor: "pointer", background: "var(--surface)" }}>
                      <option value="">Select brand...</option>
                      {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                  </Field>
                </div>
                <div style={{ flex: "1 1 140px" }}>
                  <Field label="Date"><input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} style={inpStyle} /></Field>
                </div>
              </div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                {payIsPercent && (
                  <div style={{ flex: "1 1 150px" }}>
                    <Field label="Brand revenue">
                      <input type="number" min="0" step="0.01" placeholder="0.00" value={brandRevenue}
                        onChange={(e) => setBrandRevenue(numClean(e.target.value))} style={inpStyle} />
                    </Field>
                  </div>
                )}
                <div style={{ flex: "1 1 200px" }}>
                  <Field label={"Client payment" + (payModel ? " · " + payDesc(payModel) : " (received)")}>
                    <input type="number" min="0" step="0.01" placeholder="0.00"
                      value={payment !== "" ? payment : (computedPayment != null ? +computedPayment.toFixed(2) : "")}
                      onChange={(e) => setPayment(numClean(e.target.value))} style={inpStyle} />
                  </Field>
                </div>
                {usesHours && (
                  <div style={{ flex: "1 1 110px" }}>
                    <Field label="Hours">
                      <input type="number" min="0" step="0.5" placeholder="0" value={entryHours}
                        onChange={(e) => setEntryHours(numClean(e.target.value))} style={inpStyle} />
                    </Field>
                  </div>
                )}
              </div>
              <div style={{ fontSize: 11, color: C.accent, fontFamily: "'JetBrains Mono',monospace", letterSpacing: 0.8, textTransform: "uppercase", margin: "10px 0 10px" }}>Expenses</div>
              {cats.length === 0 ? (
                <div style={{ fontSize: 12.5, color: C.textMuted, marginBottom: 16, lineHeight: 1.6 }}>
                  No expense categories yet — you can still log a payment-only entry.{" "}
                  <button type="button" onClick={() => setTab("Categories")} style={{ background: "none", border: "none", color: "var(--pop)", cursor: "pointer", fontWeight: 600, padding: 0, fontSize: 12.5, textDecoration: "underline" }}>Add categories</button> to track spend.
                </div>
              ) : (
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  {cats.map((c) => {
                    const auto = computedFor(c);
                    const val = exp[c.id] !== undefined ? exp[c.id] : (auto ? +auto.toFixed(2) : "");
                    return (
                      <div key={c.id} style={{ flex: "1 1 150px" }}>
                        <Field label={`${c.label} · ${costDesc(c.cost)}`}>
                          <input type="number" min="0" step="0.01" placeholder="0.00" value={val}
                            onChange={(e) => setExp((s) => ({ ...s, [c.id]: numClean(e.target.value) }))} style={inpStyle} />
                        </Field>
                      </div>
                    );
                  })}
                </div>
              )}
              <div style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                background: "var(--pop-dim)", border: "1px solid var(--pop-border)", borderRadius: 12,
                padding: "14px 18px", margin: "6px 0 18px",
              }}>
                <span style={{ fontSize: 12.5, color: C.textDim }}>Profit on this entry</span>
                <span style={{ fontSize: 20, fontWeight: 800, color: liveProfit >= 0 ? C.earn : "#ef4444" }}>{fmt(liveProfit)}</span>
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <Btn onClick={saveEntry} disabled={!entryBrandId}>Save entry</Btn>
                {savedFlash && <span style={{ fontSize: 13, color: C.earn, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4 }}><Icon name="check" size={14} />Saved</span>}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══ BRANDS ═══ */}
      {tab === "Brands" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 10 }}>
            <h2 style={{ fontSize: 21, fontWeight: 700 }}>Brands you manage</h2>
            <Btn onClick={openNewBrand}>+ Add brand</Btn>
          </div>
          {brands.length === 0 ? (
            <EmptyState icon="briefcase" text="No brands yet" sub="Add the people, creators, or brands you manage" />
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
              {brands.map((b) => {
                const count = entries.filter((e) => e.brandId === b.id).length;
                return (
                  <div key={b.id} style={{ background: C.card, border: "1px solid " + C.cardBorder, borderRadius: 14, padding: "16px 18px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <Avatar name={b.name} size={40} color={b.color} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 15 }}>{b.name}</div>
                        <div style={{ fontSize: 11, color: C.textMuted, fontFamily: "'JetBrains Mono',monospace" }}>{count} {count === 1 ? "entry" : "entries"}</div>
                      </div>
                    </div>
                    <div style={{ fontSize: 11, color: C.textDim, marginTop: 10, fontFamily: "'JetBrains Mono',monospace" }}>Pays: {payDesc(b.payment)}</div>
                    <button onClick={() => quickLog(b)} style={{
                      width: "100%", marginTop: 12, padding: "9px 12px", borderRadius: 8, cursor: "pointer",
                      fontSize: 12.5, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
                      background: "var(--pop-dim)", border: "1px solid var(--pop-border)", color: "var(--pop)",
                    }}><Icon name={canQuickLog(b) ? "check" : "file-text"} size={14} />{canQuickLog(b) ? "Log this month" : "New entry"}</button>
                    {loggedThisMonth(b.id) && (
                      <div style={{ fontSize: 11, color: C.earn, marginTop: 8, display: "flex", alignItems: "center", gap: 5 }}>
                        <Icon name="check" size={12} />Already logged this month
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
                      <button onClick={() => openEditBrand(b)} style={{ background: "rgba(var(--ink-rgb),0.04)", border: "1px solid rgba(var(--ink-rgb),0.08)", color: C.textDim, padding: "6px 12px", borderRadius: 8, cursor: "pointer", fontSize: 12.5, fontWeight: 600 }}>Edit</button>
                      <button onClick={() => setConfirmDel(b)} style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.18)", color: "#ef4444", padding: "6px 12px", borderRadius: 8, cursor: "pointer", fontSize: 12.5, fontWeight: 600 }}>Remove</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ═══ CATEGORIES ═══ */}
      {tab === "Categories" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 10 }}>
            <h2 style={{ fontSize: 21, fontWeight: 700 }}>Expense categories</h2>
            <Btn onClick={openNewCat}>+ Add category</Btn>
          </div>
          <p style={{ fontSize: 13, color: C.textDim, marginBottom: 22, maxWidth: 560 }}>
            Define the costs your agency actually tracks (e.g. ads, tools, talent fees). These become the expense fields on every entry and the slices of your profit donut.
          </p>
          {cats.length === 0 ? (
            <EmptyState icon="tag" text="No categories yet" sub="Add the expense types you want to track per entry"
              action={<Btn onClick={openNewCat}>+ Add category</Btn>} />
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
              {cats.map((c) => (
                <div key={c.id} style={{ background: C.card, border: "1px solid " + C.cardBorder, borderRadius: 14, padding: "16px 18px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ width: 16, height: 16, borderRadius: 5, background: c.color, flex: "none" }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 15 }}>{c.label}</div>
                      <div style={{ fontSize: 11, color: C.textMuted, fontFamily: "'JetBrains Mono',monospace", marginTop: 2 }}>{costDesc(c.cost)}</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 14, justifyContent: "flex-end" }}>
                    <button onClick={() => openEditCat(c)} style={{ background: "rgba(var(--ink-rgb),0.04)", border: "1px solid rgba(var(--ink-rgb),0.08)", color: C.textDim, padding: "6px 12px", borderRadius: 8, cursor: "pointer", fontSize: 12.5, fontWeight: 600 }}>Edit</button>
                    <button onClick={() => deleteCat(c)} style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.18)", color: "#ef4444", padding: "6px 12px", borderRadius: 8, cursor: "pointer", fontSize: 12.5, fontWeight: 600 }}>Remove</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══ INVOICES ═══ */}
      {tab === "Invoices" && (
        <div>
          <h2 style={{ fontSize: 21, fontWeight: 700, marginBottom: 20 }}>Invoices</h2>
          <InvoicesPanel invoices={data.invoices || []} onUpsert={upsertInvoice} />
        </div>
      )}

      {/* ═══ HISTORY ═══ */}
      {tab === "History" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 10 }}>
            <h2 style={{ fontSize: 21, fontWeight: 700 }}>Entry history</h2>
            <select value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)}
              style={{ ...inpStyle, width: "auto", cursor: "pointer", background: "var(--surface)" }}>
              <option value="all">All time</option>
              {months.map((m) => <option key={m} value={m}>{mMonthLabel(m)}</option>)}
            </select>
          </div>

          {/* Local data backup — everything lives in this browser, so keep a copy */}
          <div className="no-print" style={{
            display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12,
            marginBottom: 20, padding: "14px 18px", background: C.card,
            border: "1px solid " + C.cardBorder, borderRadius: 14,
          }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Backup &amp; restore</div>
              <div style={{ fontSize: 11.5, color: C.textDim, marginTop: 2 }}>
                Your data is stored only in this browser. Save a backup file regularly so you don't lose it.
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <Btn variant="secondary" onClick={onExport} style={{ fontSize: 12, padding: "8px 14px" }}><Icon name="download" size={13} style={{ marginRight: 5 }} />Save backup</Btn>
              <Btn variant="secondary" onClick={() => importRef.current && importRef.current.click()} style={{ fontSize: 12, padding: "8px 14px" }}><Icon name="upload" size={13} style={{ marginRight: 5 }} />Restore</Btn>
              <input ref={importRef} type="file" accept="application/json,.json" onChange={onImport} style={{ display: "none" }} aria-hidden="true" />
            </div>
          </div>

          {sortedEntries.length === 0 ? (
            <EmptyState icon="file-text" text="No entries yet" sub="Logged entries will appear here" />
          ) : (
            <div className="mobile-scroll-x" style={{ borderRadius: 14, overflow: "hidden", border: "1px solid " + C.cardBorder }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 0.7fr 0.8fr 0.8fr 0.8fr 76px", minWidth: 580, padding: "10px 18px", background: "rgba(var(--accent-rgb),0.015)", fontSize: 10, color: C.textMuted, fontFamily: "'JetBrains Mono',monospace", letterSpacing: 0.7, textTransform: "uppercase", gap: 6 }}>
                <div>Brand</div><div>Date</div><div>Payment</div><div>Expenses</div><div>Profit</div><div></div>
              </div>
              {sortedEntries.map((e) => {
                const ex = entryExpenses(e), pr = entryProfit(e);
                return (
                  <div key={e.id} className="recrow" style={{ display: "grid", gridTemplateColumns: "1fr 0.7fr 0.8fr 0.8fr 0.8fr 76px", minWidth: 580, padding: "12px 18px", borderTop: "1px solid rgba(var(--accent-rgb),0.03)", fontSize: 13, alignItems: "center", gap: 6 }}>
                    <div style={{ fontWeight: 600 }}>{brandLabel(e.brandId)}</div>
                    <div style={{ color: C.textMuted, fontSize: 11, fontFamily: "'JetBrains Mono',monospace" }}>{mDate(e.date)}</div>
                    <div style={{ fontWeight: 700, color: C.accent }}>{fmt(e.payment)}</div>
                    <div style={{ color: C.textDim, fontSize: 12 }}>{fmt(ex)}</div>
                    <div style={{ fontWeight: 700, color: pr >= 0 ? C.earn : "#ef4444" }}>{fmt(pr)}</div>
                    <div className="no-print" style={{ display: "flex", gap: 2, justifyContent: "flex-end" }}>
                      <button onClick={() => invoiceEntry(e)} aria-label="Invoice brand" title="Invoice" style={{ background: "none", border: "none", color: "rgba(var(--ink-rgb),0.4)", cursor: "pointer", fontSize: 13, padding: 3, display: "inline-flex" }}><Icon name="file-text" size={14} /></button>
                      <button onClick={() => deleteEntry(e)} aria-label="Delete entry" title="Delete" style={{ background: "none", border: "none", color: "rgba(239,68,68,0.45)", cursor: "pointer", fontSize: 14, padding: 3 }}><Icon name="x" size={14} /></button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Brand add/edit modal */}
      <Modal open={!!brandModal} onClose={() => setBrandModal(null)} title={brandModal === "new" ? "Add brand" : "Edit brand"}>
        <Field label="Brand name">
          <input type="text" placeholder="Enter brand name..." value={brandName} autoFocus
            onChange={(e) => setBrandName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") saveBrand(); }} style={inpStyle} />
        </Field>
        <Field label="Avatar color">
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <Avatar name={brandName || "?"} size={36} color={brandColor} />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {CLIENT_COLORS.map((col) => (
                <button key={col} type="button" onClick={() => setBrandColor(col)} aria-label={"Use color " + col} style={{
                  width: 26, height: 26, borderRadius: 8, background: col, cursor: "pointer", padding: 0,
                  border: brandColor === col ? "2px solid var(--ink)" : "2px solid transparent",
                  boxShadow: brandColor === col ? "inset 0 0 0 2px #fff" : "0 1px 3px rgba(var(--ink-rgb),0.18)",
                }} />
              ))}
            </div>
          </div>
        </Field>
        <Field label="Client payment">
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: C.textDim, cursor: "pointer", marginBottom: brandPayAuto ? 10 : 0 }}>
            <input type="checkbox" checked={brandPayAuto} onChange={(e) => setBrandPayAuto(e.target.checked)} />
            Auto-calculate from a payment structure
          </label>
          {brandPayAuto && <CommissionEditor value={brandPay} onChange={setBrandPay} symbol={curSymbol} />}
          <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 6 }}>
            Flat = a fixed retainer per entry; percentage = a share of the brand's revenue (you'll enter revenue per entry); hourly = rate × hours. Leave off to type the payment manually each time.
          </div>
        </Field>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 6 }}>
          <Btn variant="secondary" onClick={() => setBrandModal(null)}>Cancel</Btn>
          <Btn onClick={saveBrand} disabled={!brandName.trim()}>{brandModal === "new" ? "Add brand" : "Save"}</Btn>
        </div>
      </Modal>

      {/* Category add/edit modal */}
      <Modal open={!!catModal} onClose={() => setCatModal(null)} title={catModal === "new" ? "Add category" : "Edit category"}>
        <Field label="Category name">
          <input type="text" placeholder="e.g. Ads, Tools, Talent..." value={catName} autoFocus
            onChange={(e) => setCatName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") saveCat(); }} style={inpStyle} />
        </Field>
        <Field label="Color">
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {EXP_CAT_COLORS.map((col) => (
              <button key={col} type="button" onClick={() => setCatColor(col)} aria-label={"Use color " + col} style={{
                width: 26, height: 26, borderRadius: 8, background: col, cursor: "pointer", padding: 0,
                border: catColor === col ? "2px solid var(--ink)" : "2px solid transparent",
                boxShadow: catColor === col ? "inset 0 0 0 2px #fff" : "0 1px 3px rgba(var(--ink-rgb),0.18)",
              }} />
            ))}
          </div>
        </Field>
        <Field label="How this cost is calculated">
          <CommissionEditor value={catCost} onChange={setCatCost} symbol={curSymbol} />
          <div style={{ fontSize: 11.5, color: C.textMuted, marginTop: 6 }}>
            Percentage applies to each client payment; flat is a fixed amount per entry; hourly multiplies by hours logged. You can still override the amount on any single entry.
          </div>
        </Field>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 6 }}>
          <Btn variant="secondary" onClick={() => setCatModal(null)}>Cancel</Btn>
          <Btn onClick={saveCat} disabled={!catName.trim()}>{catModal === "new" ? "Add category" : "Save"}</Btn>
        </div>
      </Modal>

      {/* Confirm brand delete */}
      <Modal open={!!confirmDel} onClose={() => setConfirmDel(null)} title="Remove brand">
        <p style={{ color: C.textDim, fontSize: 13, marginBottom: 20, lineHeight: 1.6 }}>
          {confirmDel && <span>Remove <strong style={{ color: "var(--ink)" }}>{confirmDel.name}</strong> and all its entries?</span>}
        </p>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Btn variant="secondary" onClick={() => setConfirmDel(null)}>Cancel</Btn>
          <button onClick={() => deleteBrand(confirmDel)} style={{ padding: "11px 22px", background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 8, color: "#ef4444", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "'Space Grotesk',sans-serif" }}>Remove</button>
        </div>
      </Modal>

      {quickMsg && (
        <div style={{
          position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 2000,
          background: "rgba(20,22,20,0.96)", color: "#fff", padding: "12px 18px", borderRadius: 12,
          fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 8,
          boxShadow: "0 12px 32px rgba(0,0,0,0.32)",
        }}><Icon name="check" size={15} style={{ color: "#7CFC9B" }} />{quickMsg}</div>
      )}
    </div>
  );
}

function App() {
  const [data, setData] = useState(defaultState);
  const config = data.config || defaultConfig;
  setActiveCurrency(config.locale);
  setCurrencyContext(config);
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
  const [batchRoleStaff, setBatchRoleStaff] = useState({}); // { roleId: staffId } credited for this batch
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
      setNewClientCurrency(config.locale.currency || "USD");
    }
  }, [addClientOpen]);

  // Forms
  const [newClientName, setNewClientName] = useState("");
  const [newAgencyPart, setNewAgencyPart] = useState({ model: "percent", rate: AGENCY_CUT });
  const [newStaffPart, setNewStaffPart] = useState({ model: "percent", rate: CHATTER_CUT });
  const [newClientCurrency, setNewClientCurrency] = useState(config.locale.currency || "USD");
  const [newChatterName, setNewChatterName] = useState("");
const [editAgencyPart, setEditAgencyPart] = useState({ model: "percent", rate: AGENCY_CUT });
  const [editStaffPart, setEditStaffPart] = useState({ model: "percent", rate: CHATTER_CUT });
  const [editClientCurrency, setEditClientCurrency] = useState(config.locale.currency || "USD");
  const [editClientColor, setEditClientColor] = useState(CLIENT_COLORS[0]);
  const [editRoles, setEditRoles] = useState([]); // extra payout roles for the client being edited

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

  const inputRefs = useRef({});
  const importRef = useRef(null);

  useEffect(() => {
    loadData().then((d) => {
      setData((prev) => ({
        clients: (d?.clients ?? prev.clients).map((cl, i) => ({
          ...cl,
          color: cl.color || CLIENT_COLORS[i % CLIENT_COLORS.length],
          roles: Array.isArray(cl.roles) ? cl.roles : [],
        })),
        chatters: d?.chatters ?? prev.chatters,
        records: d?.records ?? prev.records,
        brands: d?.brands ?? prev.brands,
        entries: d?.entries ?? prev.entries,
        invoices: d?.invoices ?? prev.invoices,
        config: mergeConfig(d?.config),
      }));
      setLoading(false);
    });
  }, []);

  const persist = (d) => { setData(d); saveData(d); };

  // Keep saved FX rates tracking the market: once per app load, re-fetch the
  // live rate for every added currency and persist the refreshed values.
  const fxRefreshed = useRef(false);
  useEffect(() => {
    if (loading || fxRefreshed.current) return;
    if (!((data.config && data.config.currencies) || []).some((c) => c.code)) return;
    fxRefreshed.current = true;
    fetchLiveRates((data.config.locale && data.config.locale.currency) || "USD")
      .then((rates) => setData((s) => {
        const cur = ((s.config && s.config.currencies) || []).map((c) => {
          const r = c.code && rates[String(c.code).toUpperCase()];
          return r ? { ...c, rate: +(1 / r).toFixed(6) } : c;
        });
        if (JSON.stringify(cur) === JSON.stringify(s.config.currencies)) return s;
        const next = { ...s, config: { ...s.config, currencies: cur } };
        saveData(next);
        return next;
      }))
      .catch(() => {}); // offline → keep the saved rates
  }, [loading, data.config]);

  // Theme: remembers the user's choice; defaults to the OS preference on first load.
  const [dark, setDark] = useState(false);
  useEffect(() => {
    let on = true;
    window.storage.get(THEME_KEY).then((r) => {
      if (!on) return;
      if (r && r.value != null) setDark(r.value === "dark");
      else if (typeof matchMedia !== "undefined") setDark(matchMedia("(prefers-color-scheme: dark)").matches);
    }).catch(() => {});
    return () => { on = false; };
  }, []);
  const toggleTheme = () => {
    setDark((d) => {
      const next = !d;
      window.storage.set(THEME_KEY, next ? "dark" : "light").catch(() => {});
      return next;
    });
  };
  const TH = dark ? DARK : THEME;

  // Live cross-device sync: userStorage pushes a "agencyx:remote" event when this
  // user's data changes on another device. Apply it to the running app.
  useEffect(() => {
    const onRemote = (e) => {
      const { key, value } = e.detail || {};
      if (value == null) return;
      if (key === STORAGE_KEY) {
        try {
          const d = JSON.parse(value);
          setData((prev) => ({
            clients: (d?.clients ?? prev.clients).map((cl, i) => ({
              ...cl,
              color: cl.color || CLIENT_COLORS[i % CLIENT_COLORS.length],
              roles: Array.isArray(cl.roles) ? cl.roles : [],
            })),
            chatters: d?.chatters ?? prev.chatters,
            records: d?.records ?? prev.records,
            brands: d?.brands ?? prev.brands,
            entries: d?.entries ?? prev.entries,
            invoices: d?.invoices ?? prev.invoices,
            config: mergeConfig(d?.config),
          }));
        } catch { /* ignore malformed remote payload */ }
      } else if (key === THEME_KEY) {
        setDark(value === "dark");
      }
    };
    window.addEventListener("agencyx:remote", onRemote);
    return () => window.removeEventListener("agencyx:remote", onRemote);
  }, []);

  // Upsert a tracked invoice by its number (shared by service + management invoice views).
  const upsertInvoice = (inv) => {
    const list = Array.isArray(data.invoices) ? data.invoices : [];
    const idx = list.findIndex((x) => x.number === inv.number);
    const next = idx >= 0 ? list.map((x, i) => (i === idx ? { ...x, ...inv } : x)) : [...list, { id: genId(), ...inv }];
    persist({ ...data, invoices: next });
  };

  // Populate the edit-commission fields whenever a client is opened for editing.
  useEffect(() => {
    if (editingClient) {
      const comm = clientCommission(editingClient);
      setEditAgencyPart(JSON.parse(JSON.stringify(comm.agency)));
      setEditStaffPart(JSON.parse(JSON.stringify(comm.staff)));
      setEditClientCurrency(editingClient.currency || config.locale.currency || "USD");
      setEditClientColor(clientColor(editingClient));
      setEditRoles(clientRoles(editingClient).map((r) => ({ ...r })));
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
        ? { ...r, amount: money(amt), date: editDate, agencyCut: agencyShare, chatterCut: staffShare, currency: clientCur(client) }
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
    const c = { id: genId(), name: newClientName, color: CLIENT_COLORS[data.clients.length % CLIENT_COLORS.length], currency: (newClientCurrency || config.locale.currency || "USD").toUpperCase(), ...clientCommFields(newAgencyPart, newStaffPart) };
    persist({ ...data, clients: [...data.clients, c] });
    setNewClientName(""); setAddClientOpen(false);
  };

  const addChatter = () => {
    const c = { id: genId(), name: newChatterName, clientId: chatterClientId };
    persist({ ...data, chatters: [...data.chatters, c] });
    setNewChatterName(""); setAddChatterOpen(false);
  };
  // The role label for a team member: their extra role name, or the primary staff term.
  const memberRoleName = (ch) => {
    if (!ch || !ch.roleId) return null;
    const cl = data.clients.find((c) => c.id === ch.clientId);
    return (clientRoles(cl).find((r) => r.id === ch.roleId) || {}).name || null;
  };

  const updateClientCuts = (id, agency, staff) => {
    const roles = editRoles
      .filter((r) => (r.name || "").trim())
      .map((r) => ({ id: r.id || genId(), name: r.name.trim(), rate: Number(r.rate) || 0 }));
    const clients = data.clients.map((cl) => (cl.id === id ? { ...cl, color: editClientColor, currency: (editClientCurrency || config.locale.currency || "USD").toUpperCase(), roles, ...clientCommFields(agency, staff) } : cl));
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
          const rec = { id: genId(), chatterId: cid, amount: money(num), date: salesDate, agencyCut: agencyShare, chatterCut: staffShare, currency: clientCur(client) };
          if (hours) rec.hours = hours;
          // Credit any extra roles selected for this batch.
          const extras = clientRoles(client)
            .map((role) => {
              const staffId = batchRoleStaff[role.id];
              if (!staffId) return null;
              const m = data.chatters.find((x) => x.id === staffId);
              return { roleId: role.id, name: role.name, staffId, staffName: m ? m.name : "", cut: roleCut(role, num) };
            })
            .filter(Boolean);
          if (extras.length) rec.extras = extras;
          newRecs.push(rec);
        }
      });
    });
    if (newRecs.length) { persist({ ...data, records: [...data.records, ...newRecs] }); setBulkAmounts({}); setBulkHours({}); setBatchRoleStaff({}); setSavedFlash(true); setTimeout(() => setSavedFlash(false), 2500); }
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

  const exportCSV = (recs) => {
    const esc = (v) => {
      let s = String(v ?? "");
      // Neutralize spreadsheet formula injection (=, +, -, @, tab, CR triggers).
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
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
    if (file.size > 10 * 1024 * 1024) {
      alert("That file is too large to be a backup from this app (over 10 MB).");
      e.target.value = ""; return;
    }
    const isPlainObject = (o) => o != null && typeof o === "object" && !Array.isArray(o);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const p = JSON.parse(reader.result);
        if (!p || !Array.isArray(p.clients) || !Array.isArray(p.chatters) || !Array.isArray(p.records)) {
          alert("That file isn't a valid backup — it should contain clients, chatters and records."); return;
        }
        const arr = (x) => (Array.isArray(x) ? x : []);
        const brands = arr(p.brands), entries = arr(p.entries), invoices = arr(p.invoices);
        // Every stored item must be a plain object; reject malformed/injected structures.
        if (![...p.clients, ...p.chatters, ...p.records, ...brands, ...entries, ...invoices].every(isPlainObject)) {
          alert("That backup contains malformed entries and can't be imported safely."); return;
        }
        // Summarise whatever the backup actually holds (service vs management data).
        const parts = [];
        if (p.clients.length) parts.push(`${p.clients.length} clients`);
        if (p.chatters.length) parts.push(`${p.chatters.length} chatters`);
        if (p.records.length) parts.push(`${p.records.length} sales`);
        if (brands.length) parts.push(`${brands.length} brands`);
        if (entries.length) parts.push(`${entries.length} entries`);
        const summary = parts.length ? parts.join(", ") : "this backup";
        const ok = window.confirm(
          `Import ${summary}?\n\nThis replaces everything currently in the app. Export a backup first if you're unsure.`
        );
        if (!ok) return;
        persist({ clients: p.clients, chatters: p.chatters, records: p.records, brands, entries, invoices, config: mergeConfig(p.config) });
      } catch {
        alert("Couldn't read that file — make sure it's a JSON backup exported from this app.");
      } finally {
        e.target.value = "";
      }
    };
    reader.readAsText(file);
  };

  const printReport = () => { printElement("history-printable", "Sales_History_" + today()); };

  // Only primary-role members get amount inputs in the grid; extra-role people are credited per batch.
  const salesChatters = data.chatters.filter((c) => (salesClientId === "all" || c.clientId === salesClientId) && !c.roleId);
  const dashRecs = data.records.filter((r) => dashFilterDate === "all" || r.date === dashFilterDate);
  // Dashboard display currency: totals & charts are re-denominated into this
  // (defaults to base; remembered per device). Falls back to base if the saved
  // pick is no longer an enabled currency.
  const [dashCurRaw, setDashCurRaw] = useState(() => { try { return localStorage.getItem("agencyx_dash_currency") || ""; } catch { return ""; } });
  const dispCode = currencyReg.map[dashCurRaw.toUpperCase()] ? dashCurRaw.toUpperCase() : baseCode();
  const setDashCur = (c) => { setDashCurRaw(c); try { localStorage.setItem("agencyx_dash_currency", c); } catch {} };
  const dispRate = curInfo(dispCode).rate || 1;
  const inDisp = (v) => money(v / dispRate); // base → display currency
  const totalSales = sumMoney(dashRecs, (r) => toBase(r.amount, r.currency));
  const totalAgency = sumMoney(dashRecs, (r) => toBase(r.agencyCut, r.currency));
  const totalChatterPay = sumMoney(dashRecs, (r) => toBase(r.chatterCut, r.currency));
  // Month-over-month momentum (only shown on the all-time view, where the comparison is meaningful).
  const salesDelta = (() => {
    if (dashFilterDate !== "all") return null;
    const now = new Date();
    const thisKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastKey = `${lm.getFullYear()}-${String(lm.getMonth() + 1).padStart(2, "0")}`;
    const sumMo = (k) => sumMoney(data.records.filter((r) => (r.date || "").slice(0, 7) === k), (r) => toBase(r.amount, r.currency));
    const thisMo = sumMo(thisKey), lastMo = sumMo(lastKey);
    if (lastMo <= 0 || thisMo <= 0) return null; // no sales yet this month → not a -100% crash, just early
    return Math.round(((thisMo - lastMo) / lastMo) * 100);
  })();
  // Month-over-month deltas for the agency-cut and staff-pay cards (same all-time gating).
  const moDelta = (field) => {
    if (dashFilterDate !== "all") return null;
    const now = new Date();
    const thisKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastKey = `${lm.getFullYear()}-${String(lm.getMonth() + 1).padStart(2, "0")}`;
    const sumMo = (k) => sumMoney(data.records.filter((r) => (r.date || "").slice(0, 7) === k), (r) => toBase(r[field], r.currency));
    const t1 = sumMo(thisKey), l1 = sumMo(lastKey);
    if (l1 <= 0 || t1 <= 0) return null; // hide month-over-month until this month has activity
    return Math.round(((t1 - l1) / l1) * 100);
  };
  const agencyDelta = moDelta("agencyCut");
  const chatterDelta = moDelta("chatterCut");
  // Per-currency breakdown of sales (for the multi-currency note).
  const salesByCurrency = (() => {
    const m = {};
    dashRecs.forEach((r) => { const c = (r.currency || baseCode()).toUpperCase(); m[c] = fromCents(toCents(m[c] || 0) + toCents(r.amount)); });
    return m;
  })();
  const usedCurrencies = Object.keys(salesByCurrency);

  const sym = config.locale.currencySymbol || "$";
  const agLabelsSet = [...new Set(data.clients.map((cl) => partLabel(clientCommission(cl).agency, sym)))];
  const chLabelsSet = [...new Set(data.clients.map((cl) => partLabel(clientCommission(cl).staff, sym)))];
  const agencyCutLabel = data.clients.length && agLabelsSet.length === 1 ? `${t.agencyShareLabel} · ${agLabelsSet[0]}` : t.agencyShareLabel;
  const chatterCutLabel = data.clients.length && chLabelsSet.length === 1 ? `${t.staffShareLabel} · ${chLabelsSet[0]}` : t.staffShareLabel;

  const clientStats = data.clients.map((cl) => {
    const recs = data.records.filter((r) => (dashFilterDate === "all" || r.date === dashFilterDate) && data.chatters.find((c) => c.id === r.chatterId)?.clientId === cl.id);
    return { id: cl.id, name: cl.name, color: cl.color, currency: clientCur(cl), agencyCut: cl.agencyCut, chatterCut: cl.chatterCut, total: sumMoney(recs, (r) => r.amount), agency: sumMoney(recs, (r) => r.agencyCut), chatterPay: sumMoney(recs, (r) => r.chatterCut), chatterCount: data.chatters.filter((c) => c.clientId === cl.id).length };
  });

  // Primary-role members: earnings from records they logged.
  const chatterStats = data.chatters.filter((ch) => !ch.roleId).map((ch) => {
    const recs = data.records.filter((r) => (dashFilterDate === "all" || r.date === dashFilterDate) && r.chatterId === ch.id);
    const cl = data.clients.find((c) => c.id === ch.clientId);
    return { id: ch.id, name: ch.name, clientId: ch.clientId, currency: clientCur(cl), total: sumMoney(recs, (r) => r.amount), agency: sumMoney(recs, (r) => r.agencyCut), chatterPay: sumMoney(recs, (r) => r.chatterCut), count: recs.length };
  });

  // Extra-role members: pay comes from record extras attributed to them.
  const roleMemberStats = data.chatters.filter((ch) => ch.roleId).map((ch) => {
    const cl = data.clients.find((c) => c.id === ch.clientId);
    const recs = data.records.filter((r) => (dashFilterDate === "all" || r.date === dashFilterDate) && Array.isArray(r.extras) && r.extras.some((e) => e.staffId === ch.id));
    const pay = sumMoney(recs, (r) => (r.extras.find((e) => e.staffId === ch.id) || {}).cut || 0);
    return { id: ch.id, name: ch.name, clientId: ch.clientId, roleName: memberRoleName(ch), currency: clientCur(cl), pay, count: recs.length };
  });

  // Per extra-role payout totals across the filtered records (for the dashboard split + cards).
  const roleTotals = (() => {
    const m = {};
    dashRecs.forEach((r) => {
      (Array.isArray(r.extras) ? r.extras : []).forEach((e) => {
        const key = e.name || "Role";
        m[key] = (m[key] || 0) + toBase(e.cut, r.currency);
      });
    });
    return Object.entries(m).map(([name, amount]) => ({ name, amount: money(amount) }));
  })();

  // Auto-generated insight callouts for the dashboard.
  const dayTotals = {};
  dashRecs.forEach((r) => { dayTotals[r.date] = (dayTotals[r.date] || 0) + toBase(r.amount, r.currency); });
  const bestSalesDay = Object.entries(dayTotals).sort((a, b) => b[1] - a[1])[0];
  const topClient = [...clientStats].sort((a, b) => b.total - a.total)[0];
  const topEarner = [...chatterStats].sort((a, b) => b.total - a.total)[0];
  const avgSale = dashRecs.length ? money(totalSales / dashRecs.length) : 0;
  const serviceHighlights = [
    salesDelta != null && { icon: salesDelta >= 0 ? "trending-up" : "trending-down", label: t.revenue.many + " vs last month", value: (salesDelta >= 0 ? "+" : "") + salesDelta + "%", tone: salesDelta >= 0 ? "good" : "bad" },
    topClient && topClient.total > 0 && { icon: "award", label: "Top " + t.client.one.toLowerCase(), value: topClient.name + " · " + fmtIn(topClient.total, topClient.currency), tone: "good" },
    topEarner && topEarner.total > 0 && { icon: "star", label: "Top " + t.staff.one.toLowerCase(), value: topEarner.name + " · " + fmtIn(topEarner.total, topEarner.currency) },
    bestSalesDay && { icon: "flame", label: "Best day", value: shortDate(bestSalesDay[0]) + " · " + fmtIn(inDisp(bestSalesDay[1]), dispCode) },
    dashRecs.length > 0 && { icon: "file-text", label: "Avg " + t.revenue.one.toLowerCase(), value: fmtIn(inDisp(avgSale), dispCode) },
  ];

  const clientNameFn = (id) => data.clients.find((c) => c.id === id)?.name || "Unknown";
  const chatterNameFn = (id) => data.chatters.find((c) => c.id === id)?.name || "Unknown";
  const chatterClientFn = (id) => data.chatters.find((c) => c.id === id)?.clientId;

  const bulkTotal = fromCents(Object.entries(bulkAmounts).reduce((acc, [cid, vals]) => {
    const chatter = data.chatters.find((c) => c.id === cid);
    const client = data.clients.find((cl) => cl.id === chatter?.clientId);
    return acc + toCents(toBase(chatterSum(cid, vals), clientCur(client)));
  }, 0));
  const bulkHas = bulkTotal > 0;

  const bulkAgencyTotal = fromCents(Object.entries(bulkAmounts).reduce((acc, [cid, vals]) => {
    const chatter = data.chatters.find((c) => c.id === cid);
    const client = data.clients.find((cl) => cl.id === chatter?.clientId);
    const hrs = Number((bulkHours[cid] || [])[0]) || 0;
    return acc + toCents(toBase(computeShares(client, chatterSum(cid, vals), hrs).agencyShare, clientCur(client)));
  }, 0));

  const bulkChatterTotal = fromCents(Object.entries(bulkAmounts).reduce((acc, [cid, vals]) => {
    const chatter = data.chatters.find((c) => c.id === cid);
    const client = data.clients.find((cl) => cl.id === chatter?.clientId);
    const hrs = Number((bulkHours[cid] || [])[0]) || 0;
    return acc + toCents(toBase(computeShares(client, chatterSum(cid, vals), hrs).staffShare, clientCur(client)));
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
  // Wipe all workspace rows for this account, keeping the login and current settings.
  const resetWorkspaceData = () => {
    persist({ ...JSON.parse(JSON.stringify(defaultState)), config: data.config });
    setSettingsOpen(false);
  };
  const [loaderGone, setLoaderGone] = useState(false);
  useEffect(() => { const t = setTimeout(() => setBootDone(true), 900); return () => clearTimeout(t); }, []);
  const ready = !loading && bootDone;
  useEffect(() => { if (ready) { const t = setTimeout(() => setLoaderGone(true), 520); return () => clearTimeout(t); } }, [ready]);

  return (
    <ConfigContext.Provider value={config}>
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--ink)", fontFamily: "'Space Grotesk',sans-serif" }}>

      <style>
        {`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');
        :root {
          --accent: ${TH.accent};
          --accent2: ${TH.accent2};
          --accent3: ${TH.accent3};
          --accent-rgb: ${TH.accentRgb};
          --accent-fg: ${TH.accentFg};
          --accent-glow: rgba(var(--accent-rgb), 0.10);
          --accent-dim: rgba(var(--accent-rgb), 0.06);
          --accent-border: rgba(var(--accent-rgb), 0.14);
          --pop: #F35627;
          --pop2: #D63E1A;
          --pop-rgb: 243, 86, 39;
          --pop-dim: rgba(243, 86, 39, 0.10);
          --pop-border: rgba(243, 86, 39, 0.32);
          --ink: ${TH.ink};
          --ink-rgb: ${TH.inkRgb};
          --ink-soft: ${TH.inkSoft};
          --scrim: ${TH.scrim};
          --bg: ${TH.bg};
          --card-bg: ${TH.card};
          --card-border: ${TH.cardBorder};
          --text-dim: ${TH.textDim};
          --text-muted: ${TH.textMuted};
          --earn: ${TH.earn};
          --violet: ${TH.violet};
          --surface: ${TH.surface};
          --surface2: ${TH.surface2};
          --header-bg: ${TH.headerBg};
          --field-bg: ${TH.fieldBg};
          --field-border: ${TH.fieldBorder};
          --blur: ${TH.blur};
        }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          background: var(--bg);
          background-image:
            radial-gradient(900px 520px at 10% -10%, rgba(17,17,17,0.02), transparent 60%),
            radial-gradient(820px 560px at 105% 12%, rgba(17,17,17,0.015), transparent 55%);
          background-attachment: fixed;
          min-height: 100vh; font-family: 'Plus Jakarta Sans', sans-serif; color: var(--ink); -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; letter-spacing: -0.01em;
        }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.6; } 100% { opacity: 1; } }
        @keyframes ringGrow { from { stroke-dashoffset: var(--circ); } }
        @keyframes loaderGlow { 0%,100% { box-shadow: 0 10px 40px rgba(17,17,17,0.18), inset 0 1px 0 rgba(var(--ink-rgb),0.5); } 50% { box-shadow: 0 14px 60px rgba(var(--accent-rgb),0.6), inset 0 1px 0 rgba(var(--ink-rgb),0.6); } }
        @keyframes loaderFloat { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
        @keyframes barSweep { 0% { left: -40%; } 100% { left: 100%; } }
        .lift { transition: border-color .2s ease; }
        .lift:hover { border-color: var(--accent-border); }
        .btnp:hover:not(:disabled) { transform: translate(-1px,-1px); box-shadow: 4px 4px 0 var(--ink); }
        .btnp:active:not(:disabled) { transform: translate(3px,3px); box-shadow: 0 0 0 var(--ink); }
        .btns:hover:not(:disabled) { transform: translate(-1px,-1px); box-shadow: 4px 4px 0 rgba(var(--ink-rgb),0.2); color: var(--ink); }
        .btns:active:not(:disabled) { transform: translate(3px,3px); box-shadow: 0 0 0 rgba(var(--ink-rgb),0.2); }
        .chrow { transition: background .2s ease, border-color .2s ease; }
        .chrow:hover { background: rgba(var(--accent-rgb),0.05) !important; border-color: var(--accent-border) !important; }
        .recrow { transition: background .18s ease; }
        .recrow:hover { background: rgba(var(--accent-rgb),0.035) !important; }
        .dash-bento { display: grid; grid-template-columns: minmax(0,1.5fr) minmax(0,1fr); gap: 14px; align-items: stretch; }
        @media (max-width: 760px) { .dash-bento { grid-template-columns: 1fr; } }
        .delta-pill { display: inline-flex; align-items: center; gap: 3px; padding: 2px 7px; border-radius: 999px; font-size: 11px; font-weight: 600; font-family: 'JetBrains Mono',monospace; }
        .glass { backdrop-filter: var(--blur); -webkit-backdrop-filter: var(--blur); }
        :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }
        @media (prefers-reduced-motion: reduce) {
          *, *::before, *::after { animation-duration: 0.001ms !important; animation-iteration-count: 1 !important; transition-duration: 0.001ms !important; scroll-behavior: auto !important; }
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

        .mobile-nav { display: none; }
        @keyframes drawerIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
        @media (max-width: 640px) {
          .desktop-nav { display: none !important; }
          .mobile-nav { display: flex !important; }
          .mobile-stack { flex-direction: column !important; align-items: stretch !important; }
          .mobile-hide { display: none !important; }
          .mobile-grid { grid-template-columns: 1fr !important; }
          .mobile-grid-2 { grid-template-columns: 1fr 1fr !important; }
          .mobile-p-small { padding: 12px 14px !important; }
          .mobile-font-small { font-size: 13px !important; }
          .mobile-mb-none { margin-bottom: 0 !important; }
          .mobile-scroll-x { overflow-x: auto !important; -webkit-overflow-scrolling: touch; }
        }
        .brutal-amt { border: 2.5px solid #111 !important; border-radius: 0 !important; background: #fff !important; color: #111 !important; font-weight: 700 !important; box-shadow: 3px 3px 0 #111; transition: box-shadow .2s ease, border-color .2s ease, transform .15s ease; }
        .brutal-amt::placeholder { color: #9a9a9a; transition: color .2s ease; }
        .brutal-amt:focus::placeholder { color: transparent; }
        .brutal-amt:focus { border-color: var(--pop) !important; box-shadow: 3px 3px 0 #111, 6px 6px 0 var(--pop); animation: brutalPulse 1.8s ease-in-out infinite; }
        @keyframes brutalPulse { 0%,100%{border-color:#111 !important} 50%{border-color:var(--pop) !important} }
        .brutal-check { position: relative; display: inline-block; cursor: pointer; width: 1.5em; height: 1.5em; flex: none; line-height: 0; }
        .brutal-check input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
        .brutal-check .bmk { position: absolute; inset: 0; background: #fff; border: 0.16em solid #111; border-radius: 8% 92% 12% 88% / 87% 11% 89% 13%; box-shadow: 0.22em 0.22em 0 #111; transition: transform .2s cubic-bezier(0.175,0.885,0.32,1.275), box-shadow .2s ease, background .2s ease, border-radius .2s ease; }
        .brutal-check:hover .bmk { transform: scale(1.05) rotate(2deg); }
        .brutal-check input:checked ~ .bmk { background: var(--pop); border-radius: 92% 8% 88% 12% / 11% 87% 13% 89%; transform: scale(1.1) rotate(-2deg); }
        .brutal-check .bmk::after { content: ""; position: absolute; display: none; left: 50%; top: 45%; width: 0.28em; height: 0.6em; border: solid #111; border-width: 0 0.22em 0.22em 0; transform: translate(-50%,-50%) rotate(45deg); }
        .brutal-check input:checked ~ .bmk::after { display: block; animation: brutalSplash .3s forwards; }
        .brutal-check:active .bmk { transform: scale(0.9) translateY(0.18em); box-shadow: 0 0 0 #111; }
        @keyframes brutalSplash { 0%{transform:translate(-50%,-50%) scale(0) rotate(45deg);opacity:0} 70%{transform:translate(-50%,-50%) scale(1.2) rotate(45deg)} 100%{transform:translate(-50%,-50%) scale(1) rotate(45deg);opacity:1} }
        .coin-loader { height: 110px; aspect-ratio: 1; position: relative; }
        .coin-loader::before, .coin-loader::after { content: ""; position: absolute; inset: 0; border-radius: 50%; transform-origin: bottom; }
        .coin-loader::after { background: radial-gradient(at 75% 15%,#fffb,#0000 35%), radial-gradient(at 80% 40%,#0000,#0008), radial-gradient(circle 5px,#fff 94%,#0000), radial-gradient(circle 10px,#000 94%,#0000), linear-gradient(var(--pop) 0 0) top/100% calc(50% - 5px), linear-gradient(#fff 0 0) bottom/100% calc(50% - 5px) #000; background-repeat: no-repeat; animation: coinFlip 1s infinite cubic-bezier(0.5,120,0.5,-120); }
        .coin-loader::before { background: #ddd; filter: blur(8px); transform: scaleY(0.4) translate(-13px, 0px); }
        @keyframes coinFlip { 30%,70% { transform: rotate(0deg) } 49.99% { transform: rotate(0.2deg) } 50% { transform: rotate(-0.2deg) } }
        `}
      </style>

      {/* Boot loader */}
      {!loaderGone && (
        <div aria-hidden="true" style={{
          position: "fixed", inset: 0, zIndex: 3000, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", gap: 26,
          background: "var(--bg)",
          backgroundImage: "radial-gradient(800px 500px at 50% 30%, rgba(17,17,17,0.04), transparent 60%), radial-gradient(700px 600px at 50% 120%, rgba(17,17,17,0.03), transparent 55%)",
          opacity: ready ? 0 : 1, transform: ready ? "scale(1.04)" : "scale(1)",
          transition: "opacity 0.5s ease, transform 0.5s ease", pointerEvents: ready ? "none" : "auto",
        }}>
          <div className="coin-loader" />
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 19, fontWeight: 700, letterSpacing: -0.3 }}>{config.business.name}</div>
            <div style={{ fontSize: 10, letterSpacing: 2, color: "var(--text-muted)", fontFamily: "'JetBrains Mono',monospace", textTransform: "uppercase", marginTop: 4 }}>{config.business.tagline}</div>
          </div>
          <div style={{ width: 180, height: 3, borderRadius: 99, background: "rgba(var(--ink-rgb),0.06)", overflow: "hidden", position: "relative" }}>
            <div style={{ position: "absolute", top: 0, width: "40%", height: "100%", borderRadius: 99,
              background: "linear-gradient(90deg, transparent, var(--accent), transparent)",
              animation: "barSweep 1.1s ease-in-out infinite" }} />
          </div>
        </div>
      )}

      <div className="no-print" style={{
        borderBottom: "2px solid var(--ink)", padding: "12px 0",
        background: "var(--bg)",
        position: "sticky", top: 0, zIndex: 100,
      }}>
        <div style={{ maxWidth: 1020, margin: "0 auto", padding: "0 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {config.business.logo ? (
              <img src={config.business.logo} alt={config.business.name} style={{
                width: 32, height: 32, borderRadius: 8,
                boxShadow: "0 4px 16px rgba(var(--accent-rgb),0.15)",
                objectFit: "contain", background: "rgba(0,0,0,0.15)",
              }} />
            ) : (
              <div style={{
                width: 32, height: 32, borderRadius: 8, display: "grid", placeItems: "center",
                background: "var(--pop)", color: "#fff",
                fontWeight: 800, fontSize: 17, fontFamily: "'Space Grotesk',sans-serif",
              }}>{(config.business.name || "?").charAt(0).toUpperCase()}</div>
            )}
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: -0.3 }}>{config.business.name}</div>
              <div className="mobile-hide" style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: "'JetBrains Mono',monospace", letterSpacing: 1 }}>{config.business.tagline}</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <ThemeToggle dark={dark} onToggle={toggleTheme} />
            <AccountMenu />
          </div>
        </div>
      </div>

      <div className="no-print" style={{ maxWidth: 1020, margin: "0 auto", padding: "28px 20px 60px" }}>
        {config.agencyType === "management" ? (
          <ManagementApp data={data} persist={persist} config={config} onSettings={() => setSettingsOpen(true)} onInvoice={(payload) => setInvoiceView(payload)} onExport={exportBackup} onImport={handleImportFile} />
        ) : (<>
        <TabBar active={tab} onChange={setTab} onSettings={() => setSettingsOpen(true)} />

        {/* ═══ DASHBOARD ═══ */}
        {tab === "Dashboard" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 10 }}>
              <h2 style={{ fontSize: 21, fontWeight: 700 }}>Analytics</h2>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                {isMultiCurrency() && (
                  <select
                    value={dispCode} onChange={(e) => setDashCur(e.target.value)} aria-label="Dashboard display currency"
                    style={{
                      padding: "7px 12px", background: "var(--surface)", border: "1px solid rgba(var(--ink-rgb),0.06)",
                      borderRadius: 8, color: "var(--ink)", fontSize: 13, fontFamily: "'JetBrains Mono',monospace", cursor: "pointer",
                    }}>
                    {Object.keys(currencyReg.map).map((c) => (
                      <option key={c} value={c}>{c} ({currencyReg.map[c].symbol})</option>
                    ))}
                  </select>
                )}
                <span style={{ fontSize: 13, color: "var(--text-dim)" }}>Filter:</span>
                <input
                  type="date"
                  value={dashFilterDate === "all" ? "" : dashFilterDate}
                  onChange={(e) => setDashFilterDate(e.target.value || "all")} aria-label="Filter dashboard by date"
                  style={{
                    padding: "7px 12px", background: "var(--surface)", border: "1px solid rgba(var(--ink-rgb),0.06)",
                    borderRadius: 8, color: "var(--ink)", fontSize: 13, fontFamily: "'Space Grotesk',sans-serif", cursor: "pointer"
                  }}
                />
                <button
                  onClick={() => setDashFilterDate(today())}
                  style={{
                    padding: "7px 12px", background: dashFilterDate === today() ? "var(--pop-dim)" : "transparent",
                    border: "1px solid " + (dashFilterDate === today() ? "var(--pop-border)" : "rgba(var(--ink-rgb),0.06)"),
                    borderRadius: 8, color: dashFilterDate === today() ? "var(--pop)" : "var(--text-dim)", fontSize: 13,
                    fontFamily: "'Space Grotesk',sans-serif", cursor: "pointer"
                  }}
                >Today</button>
                <button
                  onClick={() => setDashFilterDate("all")}
                  style={{
                    padding: "7px 12px", background: dashFilterDate === "all" ? "var(--pop-dim)" : "transparent",
                    border: "1px solid " + (dashFilterDate === "all" ? "var(--pop-border)" : "rgba(var(--ink-rgb),0.06)"),
                    borderRadius: 8, color: dashFilterDate === "all" ? "var(--pop)" : "var(--text-dim)", fontSize: 13,
                    fontFamily: "'Space Grotesk',sans-serif", cursor: "pointer"
                  }}
                >All Time</button>
              </div>
            </div>

            <div className="mobile-grid" style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 28 }}>
              <StatCard label={`Total ${t.revenue.many}`} amount={inDisp(totalSales)} delta={salesDelta} currency={dispCode} />
              <StatCard label={agencyCutLabel} amount={inDisp(totalAgency)} pop delta={agencyDelta} currency={dispCode} />
              <StatCard label={chatterCutLabel} amount={inDisp(totalChatterPay)} delta={chatterDelta} currency={dispCode} />
              {roleTotals.map((rt, i) => (
                <StatCard key={rt.name} label={rt.name + " pay"} amount={inDisp(rt.amount)} currency={dispCode} accent="rgba(var(--pop-rgb),0.06)" delay={210 + i * 70} />
              ))}
            </div>

            {isMultiCurrency() && (usedCurrencies.length > 1 || dispCode !== baseCode()) && (
              <div style={{ marginTop: -16, marginBottom: 22, fontSize: 11.5, color: C.textMuted, fontFamily: "'JetBrains Mono',monospace", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <span>↔</span>
                <span>Totals in {dispCode}, converted from {usedCurrencies.filter((c) => c !== dispCode).join(", ") || baseCode()} at live rates.</span>
              </div>
            )}

            <InsightsPanel highlights={serviceHighlights} delay={150} />

            {totalSales > 0 ? (
              <div className="dash-bento">
                <RevenueTrend records={data.records} delay={180} profitOf={(r) => toBase(r.agencyCut || 0, r.currency)} currency={dispCode} />
                <SplitRing total={inDisp(totalSales)} agency={inDisp(totalAgency)} chatter={inDisp(totalChatterPay)} extras={roleTotals.map((rt) => ({ ...rt, amount: inDisp(rt.amount) }))} chatterLabel={t.staffShareLabel} delay={220} currency={dispCode} />
              </div>
            ) : (
              <RevenueTrend records={data.records} delay={180} profitOf={(r) => toBase(r.agencyCut || 0, r.currency)} currency={dispCode} />
            )}

            <ActivityHeatmap records={data.records} delay={260} currency={dispCode} />

            <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--text-dim)", marginBottom: 14, letterSpacing: 0.5 }}>By {t.client.one}</h3>
            {clientStats.length === 0 ? (
              <EmptyState icon="users" text={`No ${t.client.many.toLowerCase()} yet`} sub={`Add ${t.client.many.toLowerCase()} in the ${t.client.many} tab`} action={<Btn variant="secondary" onClick={() => setTab("Clients")}>Go to {t.client.many} →</Btn>} />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {clientStats.sort((a, b) => b.total - a.total).map((cl) => {
                  const clChatters = chatterStats.filter((ch) => ch.clientId === cl.id).sort((a, b) => b.total - a.total);
                  return (
                    <div key={cl.id} className="mobile-p-small" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)", borderRadius: 13, padding: "14px 18px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <Avatar name={cl.name} size={32} color={clientColor(cl)} />
                          <div>
                            <span style={{ fontWeight: 600, fontSize: 14 }}>{cl.name}</span>
                            <span style={{ color: "var(--text-muted)", fontSize: 12, marginLeft: 8 }}>{cl.chatterCount} chatters</span>
                          </div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontWeight: 700, fontSize: 16, color: "var(--accent)" }}>{fmtIn(cl.total, cl.currency)}</span>
                          {cl.total > 0 && (
                            <button onClick={() => setInvoiceView({
                              record: { id: "agg-" + cl.id, amount: cl.total, date: dashFilterDate === "all" ? today() : dashFilterDate },
                              client: cl,
                              customAmount: cl.agency + cl.chatterPay
                            })} style={{
                              background: C.accentDim, border: "none", borderRadius: 6, color: C.accent,
                              fontSize: 10, padding: "4px 8px", cursor: "pointer", fontWeight: 600,
                              fontFamily: "'JetBrains Mono',monospace",
                            }}><Icon name="file-text" size={12} style={{ marginRight: 5 }} />Invoice</button>
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
                              clientNameStr: cl.name, date: "All Time", currency: cl.currency,
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
                            <span style={{ color: "var(--ink)", fontWeight: 600 }}>{ch.name}</span>
                            <span style={{ color: C.textMuted, fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>({ch.count})</span>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 13, fontWeight: 700, color: "var(--ink)" }}>{fmtIn(ch.total, ch.currency)}</span>
                            <span style={{ color: C.textMuted }}>·</span>
                            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, color: "var(--text-dim)" }}>{fmtIn(ch.agency, ch.currency)}</span>
                            <span style={{ color: C.textMuted }}>·</span>
                            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, fontWeight: 600, color: "var(--pop)" }}>{fmtIn(ch.chatterPay, ch.currency)}</span>
                            {ch.chatterPay > 0 && (
                              <button onClick={() => setShareCard({
                                chatters: [{
                                  name: ch.name,
                                  chatterCut: ch.chatterPay,
                                  chatterCutPercent: (() => { const sp = clientCommission(data.clients.find((cl) => cl.id === ch.clientId)).staff; return sp.model === "percent" ? sp.rate : undefined; })()
                                }],
                                clientNameStr: clientNameFn(ch.clientId), date: "All Time", currency: ch.currency,
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
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24, flexWrap: "wrap", gap: 16 }}>
              <div style={{ flex: "1 1 200px" }}>
                <h2 style={{ fontSize: 21, fontWeight: 700, marginBottom: 3 }}>Record {t.revenue.many}</h2>
                <p style={{ color: C.textDim, fontSize: 13 }}>Type amount → Enter adds more. Enter on empty → next chatter.</p>
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap", flex: "1 1 auto", justifyContent: "flex-end" }} className="mobile-stack">
                <Btn variant="secondary" onClick={() => setSmartPasteOpen(true)} style={{ marginBottom: 14, fontSize: 12, padding: "8px 16px" }}><Icon name="sparkles" size={13} style={{ marginRight: 5 }} />Smart Paste</Btn>
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

            {(() => {
              const cl = data.clients.find((c) => c.id === salesClientId);
              const roles = clientRoles(cl);
              if (!roles.length || !salesChatters.length) return null;
              return (
                <div style={{
                  display: "flex", flexWrap: "wrap", gap: 14, alignItems: "flex-end", marginBottom: 18,
                  padding: "14px 16px", background: "var(--pop-dim)", border: "1px solid var(--pop-border)", borderRadius: 13,
                }}>
                  <div style={{ fontSize: 11.5, color: C.textDim, fontWeight: 600, alignSelf: "center" }}>
                    Credit extra roles for this batch:
                  </div>
                  {roles.map((role) => {
                    const members = data.chatters.filter((m) => m.clientId === salesClientId && m.roleId === role.id);
                    return (
                      <Field key={role.id} label={`${role.name} · ${(role.rate * 100).toFixed(1).replace(/\.0$/, "")}%`}>
                        <select value={batchRoleStaff[role.id] || ""} onChange={(e) => setBatchRoleStaff((s) => ({ ...s, [role.id]: e.target.value }))}
                          style={{ ...inpStyle, width: 170, cursor: "pointer", background: "var(--surface)" }}>
                          <option value="">— none —</option>
                          {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                        </select>
                      </Field>
                    );
                  })}
                </div>
              );
            })()}

            {salesChatters.length === 0 ? (
              <EmptyState icon="users" text={!salesClientId ? `Select a ${t.client.one.toLowerCase()} to record ${t.revenue.many.toLowerCase()}` : (salesClientId === "all" ? `No ${t.staff.many.toLowerCase()} yet` : `No ${t.staff.many.toLowerCase()} for this ${t.client.one.toLowerCase()}`)} sub={!salesClientId ? `Choose a ${t.client.one.toLowerCase()} from the dropdown above` : `Add ${t.staff.many.toLowerCase()} in the ${t.client.many} tab`} action={!salesClientId ? null : <Btn variant="secondary" onClick={() => setTab("Clients")}>Go to {t.client.many} →</Btn>} />
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
                          background: has ? "rgba(var(--accent-rgb),0.025)" : "rgba(var(--ink-rgb),0.012)",
                          border: "1px solid " + (has ? C.accentBorder : "rgba(var(--ink-rgb),0.04)"),
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

                          <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center" }}>
                            {vals.map((v, idx) => {
                              const key = c.id + "-" + idx;
                              return (
                                <div key={idx} style={{ position: "relative" }}>
                                  <input
                                    className="brutal-amt"
                                    ref={(el) => { inputRefs.current[key] = el; }}
                                    type="number" placeholder="0" value={v}
                                    data-chatter-id={c.id}
                                    data-input-idx={idx}
                                    id={key}
                                    aria-label={c.name + " sale amount " + (idx + 1)}
                                    enterKeyHint="next"
                                    inputMode="decimal"
                                    onChange={(e) => setVal(c.id, idx, numClean(e.target.value))}
                                    onKeyDown={(e) => handleKeyDown(e, c.id, idx)}
                                    style={{
                                      width: 96, boxSizing: "border-box", padding: "8px 10px",
                                      paddingRight: vals.length > 1 ? 24 : 10,
                                      color: "var(--ink)", fontSize: 14, outline: "none",
                                      fontFamily: "'JetBrains Mono',monospace",
                                    }}
                                  />
                                  {vals.length > 1 && (
                                    <button type="button" onClick={() => removeField(c.id, idx)} aria-label="Remove amount field" style={{
                                      position: "absolute", right: 3, top: "50%", transform: "translateY(-50%)",
                                      background: "none", border: "none", color: "rgba(var(--ink-rgb),0.12)",
                                      cursor: "pointer", fontSize: 11, padding: "2px 3px",
                                    }}><Icon name="x" size={14} /></button>
                                  )}
                                </div>
                              );
                            })}
                            {usesHours && (
                              <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 6, marginLeft: 4 }}>
                                <span style={{ fontSize: 11, color: C.textMuted, display: "inline-flex" }}><Icon name="clock" size={12} /></span>
                                <input
                                  type="number" placeholder="hrs" inputMode="decimal"
                                  value={(bulkHours[c.id] || [])[0] || ""}
                                  aria-label={c.name + " hours"}
                                  onChange={(e) => setBulkHours((s) => ({ ...s, [c.id]: [numClean(e.target.value)] }))}
                                  style={{
                                    width: 70, boxSizing: "border-box", padding: "8px 10px",
                                    background: "rgba(var(--ink-rgb),0.03)", border: "1px solid rgba(var(--ink-rgb),0.07)",
                                    borderRadius: 7, color: "var(--ink)", fontSize: 14, outline: "none",
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
                            background: "rgba(var(--accent-rgb),0.05)", borderRadius: 8,
                            border: "1px solid " + C.accentBorder,
                          }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                              <div>
                                <div style={{ fontSize: 10, color: C.textDim, fontFamily: "'JetBrains Mono',monospace", letterSpacing: 0.4 }}>TOTAL</div>
                                <div style={{ fontSize: 20, fontWeight: 700, color: C.accent, fontFamily: "'JetBrains Mono',monospace" }}>{fmtIn(total, clientCur(client))}</div>
                              </div>
                              <div style={{ width: 1, height: 28, background: "rgba(var(--ink-rgb),0.06)" }} />
                              <div>
                                <div style={{ fontSize: 10, color: C.textDim, fontFamily: "'JetBrains Mono',monospace", letterSpacing: 0.4 }}>YOU ({partLabel(comm.agency, curInfo(clientCur(client)).symbol)})</div>
                                <div style={{ fontSize: 14, fontWeight: 600, color: C.accent2, fontFamily: "'JetBrains Mono',monospace" }}>{fmtIn(rowShares.agencyShare, clientCur(client))}</div>
                              </div>
                              <div>
                                <div style={{ fontSize: 10, color: C.textDim, fontFamily: "'JetBrains Mono',monospace", letterSpacing: 0.4 }}>THEM ({partLabel(comm.staff, curInfo(clientCur(client)).symbol)})</div>
                                <div style={{ fontSize: 14, fontWeight: 600, color: C.earn, fontFamily: "'JetBrains Mono',monospace" }}>{fmtIn(rowShares.staffShare, clientCur(client))}</div>
                              </div>
                            </div>
                            <button onClick={() => setShareCard({
                              chatters: [{ name: c.name, chatterCut: rowShares.staffShare, chatterCutPercent: comm.staff.model === "percent" ? comm.staff.rate : undefined }],
                              clientNameStr: clientNameFn(c.clientId), date: shortDate(salesDate), currency: clientCur(client),
                            })} style={{
                              background: "#2a9d38",
                              border: "none", borderRadius: 8, color: "#04231b", padding: "8px 14px",
                              cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "'Space Grotesk',sans-serif",
                              boxShadow: "0 2px 12px rgba(var(--accent-rgb),0.15)",
                            }}><Icon name="share" size={12} style={{ marginRight: 5 }} />Share</button>
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
                        background: "#2a9d38",
                        border: "none", borderRadius: 7, color: "#04231b", padding: "6px 14px",
                        cursor: "pointer", fontSize: 11, fontWeight: 700, fontFamily: "'Space Grotesk',sans-serif",
                        boxShadow: "0 2px 10px rgba(var(--accent-rgb),0.12)",
                      }}><Icon name="share" size={12} style={{ marginRight: 5 }} />Share All</button>
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
                  {savedFlash ? "Saved" : `Save All `}
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
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22 }}>
              <div>
                <h2 style={{ fontSize: 21, fontWeight: 700, marginBottom: 3 }}>{t.client.many} & {t.staff.many}</h2>
                <p style={{ color: C.textDim, fontSize: 13 }}>Manage your clients and assign chatters.</p>
              </div>
              <Btn onClick={() => setAddClientOpen(true)}>+ Add {t.client.one}</Btn>
            </div>

            {data.clients.length === 0 ? (
              <EmptyState icon="users" text={`No ${t.client.many.toLowerCase()} yet`} sub={`Click "Add ${t.client.one}" to get started`} />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {data.clients.map((cl, i) => {
                  const ch = data.chatters.filter((c) => c.clientId === cl.id);
                  return (
                    <div key={cl.id} className="lift" style={{ background: C.card, border: "1px solid " + C.cardBorder, borderRadius: 12, padding: "18px 20px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: ch.length ? 12 : 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
                          <Avatar name={cl.name} size={40} color={clientColor(cl)} />
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 16 }}>{cl.name}</div>
                            <div style={{ fontSize: 11, color: C.textMuted, fontFamily: "'JetBrains Mono',monospace" }}>{ch.length} {ch.length === 1 ? t.staff.one.toLowerCase() : t.staff.many.toLowerCase()}{clientRoles(cl).length ? " · " + clientRoles(cl).length + " extra " + (clientRoles(cl).length === 1 ? "role" : "roles") : ""}</div>
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button onClick={() => setEditingClient(cl)} style={{
                            background: "rgba(var(--ink-rgb),0.05)", border: "1px solid rgba(var(--ink-rgb),0.1)",
                            borderRadius: 8, color: C.textDim, padding: "7px 12px", cursor: "pointer",
                            fontSize: 11, fontWeight: 600, fontFamily: "'Space Grotesk',sans-serif",
                          }}><Icon name="settings" size={12} style={{ marginRight: 5 }} />Settings</button>
                          <Btn variant="secondary" onClick={() => { setChatterClientId(cl.id); setAddChatterOpen(true); }} style={{ padding: "7px 14px", fontSize: 12 }}>+ {t.staff.one}</Btn>
                          <button onClick={() => setDeleteConfirm({ type: "client", id: cl.id })} style={{
                            background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.12)",
                            borderRadius: 8, color: "#ef4444", padding: "7px 12px", cursor: "pointer",
                            fontSize: 11, fontWeight: 600, fontFamily: "'Space Grotesk',sans-serif",
                          }}>Remove</button>
                        </div>
                      </div>
                      {ch.length > 0 && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginLeft: 51 }}>
                          {ch.map((c) => (
                            <div key={c.id} className="chrow" style={{
                              display: "flex", justifyContent: "space-between", alignItems: "center",
                              padding: "8px 12px", background: "rgba(var(--ink-rgb),0.012)", borderRadius: 8,
                              border: "1px solid rgba(var(--ink-rgb),0.025)",
                            }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                                <Avatar name={c.name} size={28} />
                                <span style={{ fontSize: 13, fontWeight: 500 }}>{c.name}</span>
                                {memberRoleName(c) && (
                                  <span style={{ fontSize: 10, fontWeight: 700, color: "var(--pop)", background: "var(--pop-dim)", border: "1px solid var(--pop-border)", padding: "1px 7px", borderRadius: 999, fontFamily: "'JetBrains Mono',monospace" }}>{memberRoleName(c)}</span>
                                )}
                              </div>
                              <button onClick={() => setDeleteConfirm({ type: "chatter", id: c.id })} style={{
                                background: "none", border: "none", color: "rgba(var(--ink-rgb),0.12)",
                                cursor: "pointer", fontSize: 13, padding: "2px 6px",
                              }}><Icon name="x" size={14} /></button>
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
          <div>
            <div className="no-print" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 24, flexWrap: "wrap", gap: 14 }}>
              <div className="mobile-mb-none" style={{ marginBottom: 4 }}>
                <h2 style={{ fontSize: 21, fontWeight: 700, marginBottom: 3 }}>Sales History</h2>
                <p style={{ color: C.textDim, fontSize: 13 }}>View and manage past performance</p>
              </div>
              <div style={{ display: "flex", gap: 8, width: "100%", justifyContent: "flex-end", maxWidth: "min-content" }}>
                <Btn variant="secondary" onClick={() => exportCSV(filteredRecords)} style={{ fontSize: 12, padding: "8px 14px", display: "flex", alignItems: "center", gap: 6, flex: 1 }}>
                  <Icon name="download" size={13} />Export
                </Btn>
                <Btn variant="secondary" onClick={printReport} style={{ fontSize: 12, padding: "8px 14px", display: "flex", alignItems: "center", gap: 6, flex: 1 }}>
                  <Icon name="printer" size={13} />Print
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
                <Btn variant="secondary" onClick={exportBackup} style={{ fontSize: 12, padding: "8px 14px" }}><Icon name="download" size={13} style={{ marginRight: 5 }} />Save backup</Btn>
                <Btn variant="secondary" onClick={() => importRef.current && importRef.current.click()} style={{ fontSize: 12, padding: "8px 14px" }}><Icon name="upload" size={13} style={{ marginRight: 5 }} />Restore</Btn>
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
                  <div style={{ background: C.accentDim, borderRadius: 8, padding: "12px 18px", flex: "1 1 130px" }}>
                    <div style={{ fontSize: 10, color: C.textMuted, fontFamily: "'JetBrains Mono',monospace", letterSpacing: 0.4, marginBottom: 3 }}>TOTAL</div>
                    <div style={{ fontSize: 18, fontWeight: 700 }}>{fmt(sumMoney(filteredRecords, (r) => r.amount))}</div>
                  </div>
                  <div style={{ background: "rgba(var(--accent-rgb),0.04)", borderRadius: 8, padding: "12px 18px", flex: "1 1 130px" }}>
                    <div style={{ fontSize: 10, color: C.textMuted, fontFamily: "'JetBrains Mono',monospace", letterSpacing: 0.4, marginBottom: 3 }}>YOUR CUT</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: C.accent2 }}>{fmt(sumMoney(filteredRecords, (r) => r.agencyCut))}</div>
                  </div>
                  <div style={{ background: "rgba(167,139,250,0.06)", borderRadius: 8, padding: "12px 18px", flex: "1 1 130px" }}>
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
                      <div style={{ fontWeight: 700, color: C.accent }}>{fmtIn(r.amount, r.currency)}</div>
                      <div style={{ color: C.accent2, fontSize: 12 }}>{fmtIn(r.agencyCut, r.currency)}</div>
                      <div style={{ color: C.earn, fontSize: 12 }}>{fmtIn(r.chatterCut, r.currency)}</div>
                      <div className="no-print" style={{ display: "flex", gap: 2, gridColumn: "7", justifyContent: "flex-end" }}>
                        <button onClick={() => setEditRecord(r)} aria-label="Edit sale" title="Edit" style={{
                          background: "none", border: "none", color: "rgba(var(--ink-rgb),0.35)",
                          cursor: "pointer", fontSize: 13, padding: 3, borderRadius: 5,
                        }}><Icon name="edit" size={13} /></button>
                        <button onClick={() => deleteRecord(r)} aria-label="Delete sale" title="Delete" style={{
                          background: "none", border: "none", color: "rgba(239,68,68,0.45)",
                          cursor: "pointer", fontSize: 14, padding: 3, borderRadius: 5,
                        }}><Icon name="x" size={14} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {tab === "Invoices" && (
          <div>
            <h2 style={{ fontSize: 21, fontWeight: 700, marginBottom: 20 }}>Invoices</h2>
            <InvoicesPanel invoices={data.invoices || []} onUpsert={upsertInvoice} />
          </div>
        )}
        </>)}
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
          <CommissionEditor value={newAgencyPart} onChange={setNewAgencyPart} symbol={curInfo(newClientCurrency).symbol} />
        </Field>
        <Field label={t.staffShareLabel}>
          <CommissionEditor value={newStaffPart} onChange={setNewStaffPart} symbol={curInfo(newClientCurrency).symbol} />
        </Field>
        {isMultiCurrency() && (
          <Field label="Invoicing currency">
            <CurrencySelect value={newClientCurrency} onChange={setNewClientCurrency} />
          </Field>
        )}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 6 }}>
          <Btn variant="secondary" onClick={() => setAddClientOpen(false)}>Cancel</Btn>
          <Btn onClick={addClient} disabled={!newClientName.trim()}>Add {t.client.one}</Btn>
        </div>
      </Modal>

      <Modal open={addChatterOpen} onClose={() => setAddChatterOpen(false)} title={`Add ${t.staff.one}`}>
        <Field label={t.client.one}>
          <select value={chatterClientId} onChange={(e) => { setChatterClientId(e.target.value); }}
            style={{ ...inpStyle, cursor: "pointer", background: "var(--surface)" }}>
            <option value="">Select {t.client.one.toLowerCase()}...</option>
            {data.clients.map((cl) => <option key={cl.id} value={cl.id}>{cl.name}</option>)}
          </select>
        </Field>
        <Field label="Name">
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
              <CommissionEditor value={editAgencyPart} onChange={setEditAgencyPart} symbol={curInfo(editClientCurrency).symbol} />
            </Field>
            <Field label={t.staffShareLabel}>
              <CommissionEditor value={editStaffPart} onChange={setEditStaffPart} symbol={curInfo(editClientCurrency).symbol} />
            </Field>
            {isMultiCurrency() && (
              <Field label="Invoicing currency">
                <CurrencySelect value={editClientCurrency} onChange={setEditClientCurrency} />
              </Field>
            )}
            <Field label="Avatar color">
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <Avatar name={editingClient.name} size={36} color={editClientColor} />
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {CLIENT_COLORS.map((col) => (
                    <button key={col} type="button" onClick={() => setEditClientColor(col)} aria-label={"Use color " + col}
                      style={{
                        width: 26, height: 26, borderRadius: 8, background: col, cursor: "pointer", padding: 0,
                        border: editClientColor === col ? "2px solid var(--ink)" : "2px solid transparent",
                        boxShadow: editClientColor === col ? "inset 0 0 0 2px #fff" : "0 1px 3px rgba(var(--ink-rgb),0.18)",
                        transition: "transform .15s ease",
                      }} />
                  ))}
                </div>
              </div>
            </Field>
            {(() => {
              const example = 1000;
              const ag = computeShare(editAgencyPart, example, 10);
              const st = computeShare(editStaffPart, example, 10);
              return (
                <div style={{ display: "flex", gap: 8, justifyContent: "space-between", alignItems: "center", marginTop: 14 }}>
                  <span style={{ fontSize: 11, color: C.textMuted, fontFamily: "'JetBrains Mono',monospace" }}>
                    On {fmtIn(example, editClientCurrency)}{(editAgencyPart.model === "hourly" || editStaffPart.model === "hourly") ? " · 10h" : ""}: you {fmtIn(ag, editClientCurrency)} · them {fmtIn(st, editClientCurrency)}
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
            ? <span>Remove <strong style={{ color: "var(--ink)" }}>{clientNameFn(deleteConfirm.id)}</strong> and all its chatters and records?</span>
            : deleteConfirm
              ? <span>Remove <strong style={{ color: "var(--ink)" }}>{chatterNameFn(deleteConfirm.id)}</strong> and all their records?</span>
              : null
          }
        </p>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Btn variant="secondary" onClick={() => setDeleteConfirm(null)}>Cancel</Btn>
          <button onClick={deleteItem} style={{
            padding: "11px 22px", background: "rgba(239,68,68,0.12)",
            border: "1px solid rgba(239,68,68,0.2)", borderRadius: 8,
            color: "#ef4444", fontSize: 14, fontWeight: 600, cursor: "pointer",
            fontFamily: "'Space Grotesk',sans-serif",
          }}>Remove</button>
        </div>
      </Modal>

      {shareCard && <ShareCard {...shareCard} onClose={() => setShareCard(null)} />}
      {!loading && needsOnboarding && <Onboarding onComplete={saveConfig} />}

      {settingsOpen && <SettingsPanel initial={config} onClose={() => setSettingsOpen(false)} onSave={saveConfig} onResetData={resetWorkspaceData} />}

      {invoiceView && <InvoiceView {...invoiceView} invoices={data.invoices || []} onUpsertInvoice={upsertInvoice} onClose={() => setInvoiceView(null)} onOpenSettings={() => setSettingsOpen(true)} />}

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
                  onChange={(e) => setEditAmount(numClean(e.target.value))}
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
            fontFamily: "'Space Grotesk',sans-serif",
          }}>Undo</button>
        </div>
      )}

      <Modal open={smartPasteOpen} onClose={() => setSmartPasteOpen(false)} title="Smart Paste">
        <p style={{ fontSize: 13, color: C.textDim, marginBottom: 12, lineHeight: 1.5 }}>
          Paste raw reports or chat logs here. We'll automatically find chatter names and their sales.
        </p>
        {!salesClientId && (
          <div style={{
            background: "rgba(251,191,36,0.06)", border: "1px solid rgba(251,191,36,0.15)",
            borderRadius: 12, padding: "10px 14px", marginBottom: 16, color: "#fbbf24", fontSize: 13,
            display: "flex", alignItems: "center", gap: 8
          }}>
            <span style={{ display: "inline-flex", color: "#CA8A04" }}><Icon name="alert" size={14} /></span>
            <span>Please select a {t.client.one.toLowerCase()} in the "Record {t.revenue.many}" tab first.</span>
          </div>
        )}
        <textarea
          value={pastedText}
          onChange={(e) => { setPastedText(e.target.value); if (reviewItems) setReviewItems(null); }}
          placeholder="e.g. John: $450.00&#10;Sarah had a great day with 250..."
          style={{
            ...inpStyle, height: 180, resize: "none", fontSize: 13, lineHeight: 1.6,
            background: "rgba(var(--ink-rgb),0.02)", marginBottom: 16,
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
                <div key={it.id} style={{ display: "flex", alignItems: "center", gap: 14, opacity: it.included ? 1 : 0.4 }}>
                  <BrutalCheck checked={it.included} onChange={() => toggleReviewItem(it.id)} ariaLabel={"Include " + it.name} />
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
                      onChange={(e) => setReviewAmount(it.id, numClean(e.target.value))}
                      disabled={!it.included}
                      aria-label={it.name + " detected amount"}
                      style={{ width: 110, padding: "6px 8px 6px 18px", background: "rgba(var(--ink-rgb),0.04)",
                        border: "1px solid rgba(var(--ink-rgb),0.08)", borderRadius: 7, color: C.accent, fontSize: 13,
                        fontFamily: "'JetBrains Mono',monospace", outline: "none", textAlign: "right" }} />
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12, paddingTop: 10, borderTop: "1px solid rgba(var(--ink-rgb),0.06)" }}>
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
