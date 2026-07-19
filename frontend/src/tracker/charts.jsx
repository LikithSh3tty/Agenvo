import React, { useState, useEffect, useRef, useMemo } from "react";
import { useConfig } from "./config.js";
import { curInfo, fmt, fmtIn, money, toBase } from "./currency.js";
import { C } from "./theme.js";
import { shortDate, weekKey } from "./utils.js";

export function RevenueTrend({ records, delay = 0, profitOf = null, currency = null }) {
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
export function SplitRing({ total, agency, chatter, extras = [], chatterLabel = "Chatters", segments = null, subtitle = null, delay = 0, currency = null }) {
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
      { key: "chatter", label: chatterLabel, val: chatter, color: "#7A8FA6" },
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

export function ActivityHeatmap({ records, weeks = 18, delay = 0, currency = null }) {
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

