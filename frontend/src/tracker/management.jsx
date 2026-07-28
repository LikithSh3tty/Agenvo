import React, { useState, useRef } from "react";
import { ActivityHeatmap, RevenueTrend, SplitRing } from "./charts.jsx";
import { computeShare } from "./config.js";
import { baseCode, fmt, fmtIn, money, numClean, sumMoney } from "./currency.js";
import { TabBar } from "./nav.jsx";
import { CommissionEditor } from "./settings.jsx";
import { C } from "./theme.js";
import { Avatar, Btn, CLIENT_COLORS, EmptyState, Field, Icon, Modal, StatCard, inpStyle } from "./ui.jsx";
import { genId, shortDate, today } from "./utils.js";

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
export function InsightsPanel({ highlights = [], delay = 0 }) {
  const items = highlights.filter(Boolean);
  if (!items.length) return null;
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: -0.2, fontFamily: "'Space Grotesk',sans-serif", marginBottom: 12 }}>Insights</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
        {items.map((it, i) => {
          const tc = it.tone === "good" ? { bg: "rgba(22,163,74,0.12)", fg: "#16A34A" }
            : it.tone === "bad" ? { bg: "rgba(239,68,68,0.12)", fg: "#EF4444" }
            : { bg: "rgba(var(--pop-rgb),0.14)", fg: "var(--pop)" };
          return (
            <div key={i} className="lift" style={{
              background: C.card, border: "1px solid " + C.cardBorder, borderRadius: 14,
              padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                <span style={{
                  width: 22, height: 22, borderRadius: 7, flex: "none", display: "grid", placeItems: "center",
                  background: tc.bg, color: tc.fg,
                }}>
                  <Icon name={it.icon} size={12} />
                </span>
                <span style={{
                  fontSize: 10, color: C.textMuted, letterSpacing: 1, textTransform: "uppercase",
                  fontFamily: "'JetBrains Mono',monospace", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                }}>{it.label}</span>
              </div>
              <div title={String(it.value)} style={{
                fontSize: 16.5, fontWeight: 700, letterSpacing: -0.2, lineHeight: 1.35,
                fontFamily: "'Space Grotesk',sans-serif", fontVariantNumeric: "tabular-nums",
                color: "var(--ink)", overflowWrap: "anywhere",
              }}>{it.value}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Shared invoice-status tracker (Draft / Sent / Paid / Overdue). Reads/writes data.invoices.
export function InvoicesPanel({ invoices = [], onUpsert, delay = 0 }) {
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

export function ManagementApp({ data, persist, config, onSettings, onInvoice, onExport, onImport }) {
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
    topBrand && { icon: "award", label: "Most profitable", value: topBrand.name + " · " + fmt(topBrand.profit) },
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
                Your data syncs to your account in the cloud. Save a backup file now and then for extra safety.
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

