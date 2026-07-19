import React, { useState, useEffect } from "react";
import { computeShares, useConfig } from "./config.js";
import { baseCode, fmtIn, money, sumMoney, toWords } from "./currency.js";
import { C } from "./theme.js";
import { Btn, Field, Icon, Modal, inpStyle } from "./ui.jsx";
import { invoiceNumber, printElement } from "./utils.js";

/* ── Share Card ── */
export function ShareCard({ chatters: list, clientNameStr, date, onClose, currency }) {
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

export function InvoiceView({ record, client, onClose, customAmount, isPrinting, onDonePrinting, onOpenSettings, invoices = [], onUpsertInvoice }) {
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

