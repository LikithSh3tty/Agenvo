import { createContext, useContext } from "react";
import { money } from "./currency.js";

export const AGENCY_CUT = 0.075;
export const CHATTER_CUT = 0.125;

/* ── Productization: per-agency config. Defaults reproduce the current app exactly,
   so adding this changes nothing visible. Later steps make the UI read from it. ── */
export const defaultConfig = {
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
export const computeShare = (part, amount, hours = 0) => {
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
export const clientCommission = (client) => {
  if (client && client.commission && client.commission.agency && client.commission.staff) return client.commission;
  return {
    agency: { model: "percent", rate: (client && client.agencyCut != null) ? client.agencyCut : AGENCY_CUT },
    staff: { model: "percent", rate: (client && client.chatterCut != null) ? client.chatterCut : CHATTER_CUT },
  };
};

export const computeShares = (client, amount, hours = 0) => {
  const c = clientCommission(client);
  return { agencyShare: computeShare(c.agency, amount, hours), staffShare: computeShare(c.staff, amount, hours) };
};

// Extra payout roles for a client (beyond the agency cut and the primary staff/chatter cut).
// Each role: { id, name, rate } where rate is a percent fraction (0.08 = 8%).
export const clientRoles = (client) => (client && Array.isArray(client.roles) ? client.roles : []);
// The cut a given extra role takes on an amount.
export const roleCut = (role, amount) => money((Number(amount) || 0) * (Number(role && role.rate) || 0));

// True if any side of a client's commission is hourly (so a record needs an hours input).
export const clientUsesHours = (client) => {
  const c = clientCommission(client);
  return c.agency.model === "hourly" || c.staff.model === "hourly";
};

// Short human label for a commission part, e.g. "7.5%", "$200 flat", "$50/hr", "tiered".
export const partLabel = (part, symbol = "$") => {
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
export const defaultCommissionParts = (config) => {
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
export const AGENCY_PRESETS = {
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
export const mergeConfig = (saved) => {
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
export const ConfigContext = createContext(defaultConfig);
export const useConfig = () => useContext(ConfigContext);
const LOGO = "/logo.svg";

