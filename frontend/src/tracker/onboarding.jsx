import React, { useState } from "react";
import { AGENCY_PRESETS, computeShare, defaultConfig } from "./config.js";
import { curCatalog, money } from "./currency.js";
import { CommissionEditor, CurrencyPicker } from "./settings.jsx";
import { C } from "./theme.js";
import { Btn, Field, Icon, inpStyle } from "./ui.jsx";

export function Onboarding({ onComplete }) {
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

