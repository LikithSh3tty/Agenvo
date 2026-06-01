import React, { useState, useEffect, useCallback, useRef } from "react";

const STORAGE_KEY = "fanlink-tracker-v4";
const defaultState = { clients: [], chatters: [], records: [] };

const genId = () => Math.random().toString(36).slice(2, 10);
const today = () => new Date().toISOString().slice(0, 10);
const fmt = (n) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
const shortDate = (d) => {
  const dt = new Date(d + "T00:00:00");
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};
const AGENCY_CUT = 0.075;
const CHATTER_CUT = 0.125;
const LOGO = "/logo.svg";

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
  let str = convert(main) + " Dollars";
  if (cents > 0) str += " And " + convert(cents) + " Cents";
  return str;
};

const THEMES = {
  dark: {
    name: "Dark Premium",
    bg: "#0a0d0b",
    card: "rgba(173,255,180,0.02)",
    cardBorder: "rgba(173,255,180,0.06)",
    accent: "#adffb4",
    accent2: "#7aed84",
    accent3: "#4cdb5a",
    accentGlow: "rgba(173,255,180,0.12)",
    accentDim: "rgba(173,255,180,0.08)",
    accentBorder: "rgba(173,255,180,0.15)",
    textDim: "rgba(255,255,255,0.45)",
    textMuted: "rgba(255,255,255,0.25)",
    earn: "#fbbf24",
    blur: "blur(16px)",
  },
  glass: {
    name: "Glassmorphism",
    bg: "linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)",
    card: "rgba(255,255,255,0.03)",
    cardBorder: "rgba(255,255,255,0.1)",
    accent: "#60a5fa",
    accent2: "#3b82f6",
    accent3: "#2563eb",
    accentGlow: "rgba(96,165,250,0.15)",
    accentDim: "rgba(96,165,250,0.1)",
    accentBorder: "rgba(96,165,250,0.2)",
    textDim: "rgba(255,255,255,0.5)",
    textMuted: "rgba(255,255,255,0.3)",
    earn: "#fbbf24",
    blur: "blur(24px)",
  },
  sunset: {
    name: "Sunset Ridge",
    bg: "linear-gradient(135deg, #1e0a16 0%, #2d0f11 100%)",
    card: "rgba(251,113,133,0.03)",
    cardBorder: "rgba(251,113,133,0.1)",
    accent: "#fb7185",
    accent2: "#f43f5e",
    accent3: "#e11d48",
    accentGlow: "rgba(251,113,133,0.15)",
    accentDim: "rgba(251,113,133,0.1)",
    accentBorder: "rgba(251,113,133,0.2)",
    textDim: "rgba(255,255,255,0.5)",
    textMuted: "rgba(255,255,255,0.3)",
    earn: "#fbbf24",
    blur: "blur(20px)",
  }
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

  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow.document;
  doc.open();
  doc.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>${title || "Print"}</title>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;700&family=Inter:wght@400;600;700&display=swap');
          body { 
            margin: 0; padding: 0; background: #fff; color: #000;
            font-family: 'Inter', sans-serif; 
            -webkit-print-color-adjust: exact !important; 
            print-color-adjust: exact !important; 
          }
          #invoice-printable { 
            width: 720px !important; 
            margin: 0 auto !important; 
            padding: 30px !important;
            box-shadow: none !important;
            display: block !important;
            box-sizing: border-box !important;
          }
          @media print {
            @page { margin: 0; size: auto; }
            body { margin: 20mm !important; background: #fff !important; }
            .no-print { display: none !important; }
          }
        </style>
      </head>
      <body>
        ${el.outerHTML}
        <script>
          window.onload = () => {
            setTimeout(() => {
              window.print();
              setTimeout(() => { window.frameElement.remove(); }, 100);
            }, 500);
          };
        <\/script>
      </body>
    </html>
  `);
  doc.close();
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
        background: "#111412", border: "1px solid " + C.cardBorder, borderRadius: 20,
        padding: "28px 32px", width: "92%", maxWidth: 440,
        boxShadow: "0 40px 80px rgba(0,0,0,0.5)", maxHeight: "85vh", overflowY: "auto",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 19, fontWeight: 600 }}>{title}</h3>
          <button onClick={onClose} style={{
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
      background: disabled ? "rgba(173,255,180,0.15)" : "linear-gradient(135deg," + C.accent3 + ",#2a9d38)",
      color: "#0a0d0b",
      boxShadow: disabled ? "none" : "0 4px 24px rgba(173,255,180,0.2)",
    }
    : {
      background: "rgba(255,255,255,0.04)",
      border: "1px solid rgba(255,255,255,0.08)",
      color: "rgba(255,255,255,0.6)",
    };
  return (
    <button onClick={onClick} disabled={disabled} style={{
      padding: "11px 24px", border: "none", borderRadius: 11, fontSize: 14, fontWeight: 700,
      cursor: disabled ? "not-allowed" : "pointer", fontFamily: "'Outfit',sans-serif",
      transition: "all 0.2s", opacity: disabled ? 0.5 : 1, ...base, ...s,
    }}>{children}</button>
  );
}

function StatCard({ label, value, accent }) {
  return (
    <div style={{
      background: C.card, border: "1px solid " + C.cardBorder, borderRadius: 14,
      padding: "20px 24px", flex: "1 1 180px", minWidth: 155, position: "relative", overflow: "hidden",
    }}>
      <div style={{
        position: "absolute", top: -12, right: -12, width: 65, height: 65, borderRadius: "50%",
        background: accent || C.accentGlow, filter: "blur(20px)",
      }} />
      <div style={{
        fontSize: 11, color: C.textDim, letterSpacing: 1, textTransform: "uppercase",
        marginBottom: 6, fontFamily: "'JetBrains Mono',monospace",
      }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700 }}>{value}</div>
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
  const tabs = ["Dashboard", "Add Sales", "Clients", "History"];
  return (
    <div className="no-print" style={{
      display: "flex", gap: 10, marginBottom: 28, borderBottom: "1px solid var(--card-border)",
      paddingBottom: 12, overflowX: "auto",
    }}>
      {tabs.map((t) => (
        <button key={t} onClick={() => onChange(t)} style={{
          background: active === t ? "var(--accent-dim)" : "transparent",
          border: "1px solid " + (active === t ? "var(--accent-border)" : "transparent"),
          padding: "8px 16px", borderRadius: 10, color: active === t ? "var(--accent)" : "var(--text-dim)",
          cursor: "pointer", fontSize: 14, fontWeight: 600, transition: "all 0.2s",
          whiteSpace: "nowrap",
        }}>{t}</button>
      ))}
    </div>
  );
}

/* ── Share Card ── */
function ShareCard({ chatters: list, clientNameStr, date, onClose }) {
  const isSingle = list.length === 1;
  const totalCut = list.reduce((s, c) => s + c.chatterCut, 0);

  return (
    <Modal open={true} onClose={onClose} title="Share Earnings">
      <div style={{
        background: "linear-gradient(160deg,#0d1a10,#0a1a0d 40%,#0f2213)",
        borderRadius: 18, padding: "26px 28px", marginBottom: 18,
        border: "1px solid rgba(173,255,180,0.12)", position: "relative", overflow: "hidden",
      }}>
        <div style={{
          position: "absolute", top: -30, right: -30, width: 120, height: 120,
          borderRadius: "50%", background: "rgba(173,255,180,0.06)", filter: "blur(30px)",
        }} />
        <div style={{
          position: "absolute", bottom: -20, left: -20, width: 80, height: 80,
          borderRadius: "50%", background: "rgba(173,255,180,0.04)", filter: "blur(20px)",
        }} />

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
          <img src={LOGO} alt="Fanlink" style={{
            width: 32, height: 32, borderRadius: 9, objectFit: "contain",
            background: "rgba(0,0,0,0.15)",
          }} />
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>Fanlink Chatting</div>
            <div style={{ fontSize: 10, color: C.textMuted, fontFamily: "'JetBrains Mono',monospace", letterSpacing: 0.8 }}>EARNINGS REPORT</div>
          </div>
          <div style={{ marginLeft: "auto", fontSize: 11, color: C.textMuted, fontFamily: "'JetBrains Mono',monospace" }}>{date}</div>
        </div>

        {isSingle ? (
          <div>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: C.textDim, fontFamily: "'JetBrains Mono',monospace", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 4 }}>Chatter</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: "#fff" }}>{list[0].name}</div>
              <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>{clientNameStr}</div>
            </div>
            <div style={{
              background: "rgba(251,191,36,0.06)", borderRadius: 12, padding: "16px 18px",
              border: "1px solid rgba(251,191,36,0.08)",
            }}>
              <div style={{ fontSize: 10, color: C.textDim, fontFamily: "'JetBrains Mono',monospace", letterSpacing: 0.5, marginBottom: 4 }}>YOUR EARNINGS (12.5%)</div>
              <div style={{ fontSize: 26, fontWeight: 700, color: C.earn }}>{fmt(list[0].chatterCut)}</div>
            </div>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 11, color: C.textDim, fontFamily: "'JetBrains Mono',monospace", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 12 }}>
              {clientNameStr || "All Clients"} — Chatter Earnings (12.5%)
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
              padding: "12px 14px", background: "rgba(173,255,180,0.05)", borderRadius: 10,
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

function InvoiceView({ record, client, onClose, customAmount, isPrinting, onDonePrinting }) {
  if (!record || !client) return null;
  const invNo = record.invoiceNo || "INV/25-26/" + record.id.slice(0, 4).toUpperCase();
  const dateStr = new Date(record.date + "T00:00:00").toLocaleDateString("en-GB");
  const invAmount = customAmount ?? (record.amount * ((client.agencyCut || AGENCY_CUT) + (client.chatterCut || CHATTER_CUT)));

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
            <img src={LOGO} alt="Fanlink Logo" style={{ width: 60, height: 60, marginBottom: 10, objectFit: "contain" }} />
            <div style={{ fontSize: 16, fontWeight: 700 }}>Fanlink Chatting</div>
            <div style={{ fontSize: 13, color: "#444" }}>Ghansoli</div>
            <div style={{ fontSize: 13, color: "#444" }}>Navi Mumbai</div>
            <div style={{ fontSize: 13, color: "#444" }}>Vashi 400703</div>
            <div style={{ fontSize: 13, color: "#444" }}>Maharashtra MH</div>
            <div style={{ fontSize: 13, color: "#444" }}>India</div>
          </div>
          <div style={{ textAlign: "right", alignSelf: "flex-end" }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{client.name}</div>
            <div style={{ fontSize: 13, color: "#444", marginTop: 8 }}>Place of supply: Maharashtra</div>
          </div>
        </div>

        {/* Invoice Info */}
        <div style={{ marginBottom: 30 }}>
          <h1 style={{ fontSize: 24, color: "#aaa", fontWeight: 400, marginBottom: 20 }}>Customer Invoices {invNo}</h1>
          <div style={{ display: "flex", gap: 60 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Invoice Date</div>
              <div style={{ fontSize: 13 }}>{dateStr}</div>
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Due Date</div>
              <div style={{ fontSize: 13 }}>{dateStr}</div>
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
              <div style={{ fontWeight: 600 }}>Agency Fees - ${client.name}</div>
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
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, fontSize: 13, borderTop: "1px solid #000", paddingTop: 8 }}>
              <span>Total</span>
              <span>{fmt(invAmount)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: 14 }}>
              <span>Amount Due</span>
              <span>{fmt(invAmount)}</span>
            </div>
          </div>
        </div>

        {/* Bottom Text */}
        <div style={{ marginTop: 60 }}>
          <div style={{ fontSize: 12, fontStyle: "italic", marginBottom: 20 }}>
            {toWords(invAmount)}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
            <div style={{ fontSize: 12, color: "#444" }}>
              Notes: Please make the payment within 7 days.
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ width: "150px", borderBottom: "1px solid #000", marginBottom: 8 }}></div>
              <div style={{ fontSize: 12, fontWeight: 600 }}>Authorized Signatory</div>
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

function App() {
  const [data, setData] = useState(defaultState);
  const [tab, setTab] = useState("Dashboard");
  const [currentTheme, setCurrentTheme] = useState("dark");
  const [loading, setLoading] = useState(true);

  const [salesClientId, setSalesClientId] = useState("");
  const [salesDate, setSalesDate] = useState(today());
  const [bulkAmounts, setBulkAmounts] = useState({});
  const [savedFlash, setSavedFlash] = useState(false);

  // Modals
  const [addClientOpen, setAddClientOpen] = useState(false);
  const [addChatterOpen, setAddChatterOpen] = useState(false);
  const [chatterClientId, setChatterClientId] = useState("");
  const [editingClient, setEditingClient] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  // Forms
  const [newClientName, setNewClientName] = useState("");
  const [newClientAgencyCut, setNewClientAgencyCut] = useState(7.5);
  const [newClientChatterCut, setNewClientChatterCut] = useState(12.5);
  const [newChatterName, setNewChatterName] = useState("");

  // Sharing & Invoices
  const [shareCard, setShareCard] = useState(null);
  const [invoiceView, setInvoiceView] = useState(null);

  // Filters
  const [dashFilterDate, setDashFilterDate] = useState("all");
  const [filterClient, setFilterClient] = useState("all");
  const [filterChatter, setFilterChatter] = useState("all");
  const [filterMonth, setFilterMonth] = useState("all");

  // Smart Paste
  const [smartPasteOpen, setSmartPasteOpen] = useState(false);
  const [pastedText, setPastedText] = useState("");
  const [parsedResults, setParsedResults] = useState(null);

  // Refs & Voice
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef(null);
  const inputRefs = useRef({});

  useEffect(() => {
    loadData().then((d) => { if (d) setData(d); setLoading(false); });
  }, []);

  const persist = (d) => { setData(d); saveData(d); };

  const addClient = () => {
    const c = { id: genId(), name: newClientName, agencyCut: newClientAgencyCut / 100, chatterCut: newClientChatterCut / 100 };
    persist({ ...data, clients: [...data.clients, c] });
    setNewClientName(""); setAddClientOpen(false);
  };

  const addChatter = () => {
    const c = { id: genId(), name: newChatterName, clientId: chatterClientId };
    persist({ ...data, chatters: [...data.chatters, c] });
    setNewChatterName(""); setAddChatterOpen(false);
  };

  const updateClientCuts = (id, ag, ch) => {
    const clients = data.clients.map((cl) => (cl.id === id ? { ...cl, agencyCut: ag, chatterCut: ch } : cl));
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
  const chatterSum = (cid, arr) => (arr || getVals(cid)).reduce((s, v) => s + (parseFloat(v) || 0), 0);

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
          const agCut = client?.agencyCut || AGENCY_CUT;
          const chCut = client?.chatterCut || CHATTER_CUT;
          newRecs.push({ id: genId(), chatterId: cid, amount: num, date: salesDate, agencyCut: num * agCut, chatterCut: num * chCut });
        }
      });
    });
    if (newRecs.length) { persist({ ...data, records: [...data.records, ...newRecs] }); setBulkAmounts({}); setSavedFlash(true); setTimeout(() => setSavedFlash(false), 2500); }
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
              res[ch.id] = (res[ch.id] || 0) + parsedVal;
            }
          }
        }
      });
    });
    setParsedResults(res);
  };

  const applyParsed = () => {
    const next = { ...bulkAmounts };
    Object.entries(parsedResults).forEach(([id, val]) => { next[id] = [val.toString(), ""]; });
    setBulkAmounts(next); setParsedResults(null); setPastedText(""); setSmartPasteOpen(false);
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
    const headers = ["Chatter", "Client", "Date", "Total Amount", "Agency Cut", "Chatter Pay"];
    const rows = recs.map((r) => [chatterNameFn(r.chatterId), clientNameFn(chatterClientFn(r.chatterId)), r.date, r.amount, r.agencyCut, r.chatterCut]);
    const csv = [headers, ...rows].map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `sales_report_${today()}.csv`; a.click();
  };

  const printReport = () => { printElement("history-printable", "Sales_History_" + today()); };

  const salesChatters = data.chatters.filter((c) => salesClientId === "all" || c.clientId === salesClientId);
  const totalSales = data.records.filter((r) => dashFilterDate === "all" || r.date === dashFilterDate).reduce((s, r) => s + r.amount, 0);
  const totalAgency = data.records.filter((r) => dashFilterDate === "all" || r.date === dashFilterDate).reduce((s, r) => s + r.agencyCut, 0);
  const totalChatterPay = data.records.filter((r) => dashFilterDate === "all" || r.date === dashFilterDate).reduce((s, r) => s + r.chatterCut, 0);

  const clientStats = data.clients.map((cl) => {
    const recs = data.records.filter((r) => (dashFilterDate === "all" || r.date === dashFilterDate) && data.chatters.find((c) => c.id === r.chatterId)?.clientId === cl.id);
    return { id: cl.id, name: cl.name, total: recs.reduce((s, r) => s + r.amount, 0), agency: recs.reduce((s, r) => s + r.agencyCut, 0), chatterPay: recs.reduce((s, r) => s + r.chatterCut, 0), chatterCount: data.chatters.filter((c) => c.clientId === cl.id).length };
  });

  const chatterStats = data.chatters.map((ch) => {
    const recs = data.records.filter((r) => (dashFilterDate === "all" || r.date === dashFilterDate) && r.chatterId === ch.id);
    return { id: ch.id, name: ch.name, clientId: ch.clientId, total: recs.reduce((s, r) => s + r.amount, 0), agency: recs.reduce((s, r) => s + r.agencyCut, 0), chatterPay: recs.reduce((s, r) => s + r.chatterCut, 0), count: recs.length };
  });

  const clientNameFn = (id) => data.clients.find((c) => c.id === id)?.name || "Unknown";
  const chatterNameFn = (id) => data.chatters.find((c) => c.id === id)?.name || "Unknown";
  const chatterClientFn = (id) => data.chatters.find((c) => c.id === id)?.clientId;

  const bulkTotal = Object.entries(bulkAmounts).reduce((acc, [cid, vals]) => acc + chatterSum(cid, vals), 0);
  const bulkHas = bulkTotal > 0;

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

  if (loading) return null;

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "#fff", fontFamily: "'Outfit',sans-serif" }}>

      <style>
        {`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap');
        :root {
          --accent: ${THEMES[currentTheme].accent};
          --accent2: ${THEMES[currentTheme].accent2};
          --accent3: ${THEMES[currentTheme].accent3};
          --accent-glow: ${THEMES[currentTheme].accentGlow};
          --accent-dim: ${THEMES[currentTheme].accentDim};
          --accent-border: ${THEMES[currentTheme].accentBorder};
          --bg: ${THEMES[currentTheme].bg};
          --card-bg: ${THEMES[currentTheme].card};
          --card-border: ${THEMES[currentTheme].cardBorder};
          --text-dim: ${THEMES[currentTheme].textDim};
          --text-muted: ${THEMES[currentTheme].textMuted};
          --earn: ${THEMES[currentTheme].earn};
          --blur: ${THEMES[currentTheme].blur};
        }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { background: var(--bg); min-height: 100vh; font-family: 'Outfit', sans-serif; color: #fff; }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.6; } 100% { opacity: 1; } }
        .glass { backdrop-filter: var(--blur); -webkit-backdrop-filter: var(--blur); }
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
        ::-webkit-scrollbar-thumb { background: rgba(173,255,180,0.1); border-radius: 3px; }

        @media (max-width: 640px) {
          .mobile-stack { flex-direction: column !important; align-items: stretch !important; }
          .mobile-hide { display: none !important; }
          .mobile-grid { grid-template-columns: 1fr !important; }
          .mobile-grid-2 { grid-template-columns: 1fr 1fr !important; }
          .mobile-p-small { padding: 12px 14px !important; }
          .mobile-font-small { font-size: 13px !important; }
          .mobile-mb-none { marginBottom: 0 !important; }
          .mobile-scroll-x { overflow-x: auto !important; -webkit-overflow-scrolling: touch; }
        }
        `}
      </style>


      {/* HEADER */}
      <div className="no-print" style={{
        borderBottom: "1px solid var(--card-border)", padding: "12px 0",
        background: "rgba(10,13,11,0.9)", backdropFilter: "var(--blur)",
        position: "sticky", top: 0, zIndex: 100,
      }}>
        <div style={{ maxWidth: 1020, margin: "0 auto", padding: "0 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <img src={LOGO} alt="Fanlink" style={{
              width: 32, height: 32, borderRadius: 9,
              boxShadow: "0 4px 16px rgba(173,255,180,0.15)",
              objectFit: "contain", background: "rgba(0,0,0,0.15)",
            }} />
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: -0.3 }}>Fanlink Chatting</div>
              <div className="mobile-hide" style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: "'JetBrains Mono',monospace", letterSpacing: 1 }}>Chatting Agency</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 5 }}>
            <Badge>{data.clients.length} <span className="mobile-hide">clients</span></Badge>
            <Badge>{data.chatters.length} <span className="mobile-hide">chatters</span></Badge>
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
                  onChange={(e) => setDashFilterDate(e.target.value || "all")}
                  style={{
                    padding: "7px 12px", background: "#111412", border: "1px solid rgba(255,255,255,0.06)",
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
              <StatCard label="Total Sales" value={fmt(totalSales)} accent="var(--accent-glow)" />
              <StatCard label="Your Cut · 7.5%" value={fmt(totalAgency)} accent="rgba(173,255,180,0.08)" />
              <StatCard label="Chatter Pay · 12.5%" value={fmt(totalChatterPay)} accent="rgba(251,191,36,0.08)" />
            </div>

            <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--text-dim)", marginBottom: 14, letterSpacing: 0.5 }}>By Client</h3>
            {clientStats.length === 0 ? (
              <EmptyState icon="📌" text="No clients yet" sub="Add clients in the Clients tab" action={<Btn variant="secondary" onClick={() => setTab("Clients")}>Go to Clients →</Btn>} />
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
                              chatters: clChatters.filter((ch) => ch.chatterPay > 0).map((ch) => ({ name: ch.name, chatterCut: ch.chatterPay })),
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
                                chatters: [{ name: ch.name, chatterCut: ch.chatterPay }],
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
                <h2 style={{ fontSize: 21, fontWeight: 700, marginBottom: 3 }}>Record Sales</h2>
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
                  <select value={salesClientId} onChange={(e) => setSalesClientId(e.target.value)} style={{ ...inpStyle, width: 170, cursor: "pointer", background: "#111412" }}>
                    <option value="">Select Client...</option>
                    <option value="all">All Clients</option>
                    {data.clients.map((cl) => <option key={cl.id} value={cl.id}>{cl.name}</option>)}
                  </select>
                </Field>
                <Field label="Date">
                  <input type="date" value={salesDate} onChange={(e) => setSalesDate(e.target.value)} style={{ ...inpStyle, width: 150, background: "#111412" }} />
                </Field>
              </div>
            </div>

            {salesChatters.length === 0 ? (
              <EmptyState icon="💬" text={!salesClientId ? "Select a client to record sales" : (salesClientId === "all" ? "No chatters yet" : "No chatters for this client")} sub={!salesClientId ? "Choose a client from the dropdown above" : "Add chatters in the Clients tab"} action={!salesClientId ? null : <Btn variant="secondary" onClick={() => setTab("Clients")}>Go to Clients →</Btn>} />
            ) : (
              <div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 22 }}>
                  {salesChatters.map((c, chIndex) => {
                    const vals = getVals(c.id);
                    const total = chatterSum(c.id, bulkAmounts[c.id]);
                    const has = total > 0;
                    return (
                      <div key={c.id} style={{ marginBottom: 8 }}>
                        <form onSubmit={(e) => handleFormSubmit(e, c.id, vals.length - 1)} className="mobile-p-small" style={{
                          padding: "14px 16px",
                          background: has ? "rgba(173,255,180,0.025)" : "rgba(255,255,255,0.012)",
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
                                    id={c.id}
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
                                    onFocus={(e) => { e.target.style.borderColor = "rgba(173,255,180,0.35)"; }}
                                    onBlur={(e) => { e.target.style.borderColor = "rgba(255,255,255,0.07)"; }}
                                  />
                                  {vals.length > 1 && (
                                    <button type="button" onClick={() => removeField(c.id, idx)} style={{
                                      position: "absolute", right: 3, top: "50%", transform: "translateY(-50%)",
                                      background: "none", border: "none", color: "rgba(255,255,255,0.12)",
                                      cursor: "pointer", fontSize: 11, padding: "2px 3px",
                                    }}>✖</button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </form>
                        {has && (
                          <div className="mobile-p-small" style={{
                            display: "flex", alignItems: "center", justifyContent: "space-between",
                            marginTop: 10, padding: "10px 14px",
                            background: "rgba(173,255,180,0.05)", borderRadius: 10,
                            border: "1px solid " + C.accentBorder,
                          }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                              <div>
                                <div style={{ fontSize: 10, color: C.textDim, fontFamily: "'JetBrains Mono',monospace", letterSpacing: 0.4 }}>TOTAL</div>
                                <div style={{ fontSize: 20, fontWeight: 700, color: C.accent, fontFamily: "'JetBrains Mono',monospace" }}>{fmt(total)}</div>
                              </div>
                              <div style={{ width: 1, height: 28, background: "rgba(255,255,255,0.06)" }} />
                              <div>
                                <div style={{ fontSize: 10, color: C.textDim, fontFamily: "'JetBrains Mono',monospace", letterSpacing: 0.4 }}>YOU (7.5%)</div>
                                <div style={{ fontSize: 14, fontWeight: 600, color: C.accent2, fontFamily: "'JetBrains Mono',monospace" }}>{fmt(total * AGENCY_CUT)}</div>
                              </div>
                              <div>
                                <div style={{ fontSize: 10, color: C.textDim, fontFamily: "'JetBrains Mono',monospace", letterSpacing: 0.4 }}>THEM (12.5%)</div>
                                <div style={{ fontSize: 14, fontWeight: 600, color: C.earn, fontFamily: "'JetBrains Mono',monospace" }}>{fmt(total * CHATTER_CUT)}</div>
                              </div>
                            </div>
                            <button onClick={() => setShareCard({
                              chatters: [{ name: c.name, chatterCut: total * CHATTER_CUT }],
                              clientNameStr: clientNameFn(c.clientId), date: shortDate(salesDate),
                            })} style={{
                              background: "linear-gradient(135deg," + C.accent3 + ",#2a9d38)",
                              border: "none", borderRadius: 8, color: "#0a0d0b", padding: "8px 14px",
                              cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "'Outfit',sans-serif",
                              boxShadow: "0 2px 12px rgba(173,255,180,0.15)",
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
                        const allCh = salesChatters.filter((c) => chatterSum(c.id) > 0).map((c) => ({ name: c.name, chatterCut: chatterSum(c.id) * CHATTER_CUT }));
                        if (allCh.length) setShareCard({ chatters: allCh, clientNameStr: salesClientId === "all" ? "All Clients" : clientNameFn(salesClientId), date: shortDate(salesDate) });
                      }} style={{
                        background: "linear-gradient(135deg," + C.accent3 + ",#2a9d38)",
                        border: "none", borderRadius: 7, color: "#0a0d0b", padding: "6px 14px",
                        cursor: "pointer", fontSize: 11, fontWeight: 700, fontFamily: "'Outfit',sans-serif",
                        boxShadow: "0 2px 10px rgba(173,255,180,0.12)",
                      }}>📤 Share All</button>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                      <span style={{ color: C.textDim, fontSize: 13 }}>Total sales</span>
                      <span style={{ color: C.accent, fontWeight: 700 }}>{fmt(bulkTotal)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                      <span style={{ color: C.textDim, fontSize: 13 }}>Your cut (7.5%)</span>
                      <span style={{ color: C.accent2, fontWeight: 600 }}>{fmt(bulkTotal * AGENCY_CUT)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: C.textDim, fontSize: 13 }}>Chatter pay (12.5%)</span>
                      <span style={{ color: C.earn, fontWeight: 600 }}>{fmt(bulkTotal * CHATTER_CUT)}</span>
                    </div>
                  </div>
                )}

                <Btn onClick={saveBulkSales} disabled={!bulkHas} style={{ width: "100%" }}>
                  {savedFlash ? "✓ Saved!" : "Save All Sales"}
                </Btn>
                {savedFlash && (
                  <div style={{ textAlign: "center", marginTop: 10, color: C.accent, fontSize: 13, fontWeight: 500, animation: "fadeIn 0.3s ease" }}>
                    Sales recorded for {shortDate(salesDate)}
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
                <h2 style={{ fontSize: 21, fontWeight: 700, marginBottom: 3 }}>Clients & Chatters</h2>
                <p style={{ color: C.textDim, fontSize: 13 }}>Manage your clients and assign chatters.</p>
              </div>
              <Btn onClick={() => setAddClientOpen(true)}>+ Add Client</Btn>
            </div>

            {data.clients.length === 0 ? (
              <EmptyState icon="📌" text="No clients yet" sub={'Click "Add Client" to get started'} />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {data.clients.map((cl) => {
                  const ch = data.chatters.filter((c) => c.clientId === cl.id);
                  return (
                    <div key={cl.id} style={{ background: C.card, border: "1px solid " + C.cardBorder, borderRadius: 14, padding: "18px 20px" }}>
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
                          <Btn variant="secondary" onClick={() => { setChatterClientId(cl.id); setAddChatterOpen(true); }} style={{ padding: "7px 14px", fontSize: 12 }}>+ Chatter</Btn>
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
                            <div key={c.id} style={{
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

            <div className="no-print" style={{
              display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
              gap: 12, marginBottom: 24, padding: 18, background: C.card,
              border: "1px solid " + C.cardBorder, borderRadius: 16
            }}>
              <Field label="Client">
                <select value={filterClient} onChange={(e) => { setFilterClient(e.target.value); setFilterChatter("all"); }} style={{ ...inpStyle, cursor: "pointer", background: "#111412" }}>
                  <option value="all">All Clients</option>
                  {data.clients.map((cl) => <option key={cl.id} value={cl.id}>{cl.name}</option>)}
                </select>
              </Field>
              <Field label="Chatter">
                <select value={filterChatter} onChange={(e) => setFilterChatter(e.target.value)} style={{ ...inpStyle, cursor: "pointer", background: "#111412" }}>
                  <option value="all">All Chatters</option>
                  {(filterClient === "all" ? data.chatters : data.chatters.filter((ch) => ch.clientId === filterClient)).map((ch) => (
                    <option key={ch.id} value={ch.id}>{ch.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Month">
                <select value={filterMonth} onChange={(e) => setFilterMonth(e.target.value)} style={{ ...inpStyle, cursor: "pointer", background: "#111412" }}>
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
                    <div style={{ fontSize: 18, fontWeight: 700 }}>{fmt(filteredRecords.reduce((s, r) => s + r.amount, 0))}</div>
                  </div>
                  <div style={{ background: "rgba(173,255,180,0.04)", borderRadius: 11, padding: "12px 18px", flex: "1 1 130px" }}>
                    <div style={{ fontSize: 10, color: C.textMuted, fontFamily: "'JetBrains Mono',monospace", letterSpacing: 0.4, marginBottom: 3 }}>YOUR CUT</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: C.accent2 }}>{fmt(filteredRecords.reduce((s, r) => s + r.agencyCut, 0))}</div>
                  </div>
                  <div style={{ background: "rgba(251,191,36,0.04)", borderRadius: 11, padding: "12px 18px", flex: "1 1 130px" }}>
                    <div style={{ fontSize: 10, color: C.textMuted, fontFamily: "'JetBrains Mono',monospace", letterSpacing: 0.4, marginBottom: 3 }}>CHATTER PAY</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: C.earn }}>{fmt(filteredRecords.reduce((s, r) => s + r.chatterCut, 0))}</div>
                  </div>
                </div>
              )}

              {filteredRecords.length === 0 ? (
                <EmptyState text="No records found" />
              ) : (
                <div className="mobile-scroll-x" style={{ borderRadius: 14, overflow: "hidden", border: "1px solid " + C.cardBorder }}>
                  <div style={{
                    display: "grid", gridTemplateColumns: "1fr 0.8fr 0.7fr 0.9fr 0.7fr 0.7fr 36px",
                    minWidth: 600, padding: "10px 18px", background: "rgba(173,255,180,0.015)",
                    fontSize: 10, color: C.textMuted, fontFamily: "'JetBrains Mono',monospace",
                    letterSpacing: 0.7, textTransform: "uppercase", gap: 6,
                  }}>
                    <div>Chatter</div><div>Client</div><div>Date</div><div>Amount</div><div>You</div><div>Them</div><div>Actions</div>
                  </div>
                  {filteredRecords.map((r) => (
                    <div key={r.id} style={{
                      display: "grid", gridTemplateColumns: "1fr 0.8fr 0.7fr 0.9fr 0.7fr 0.7fr 36px",
                      minWidth: 600, padding: "12px 18px", borderTop: "1px solid rgba(173,255,180,0.03)",
                      fontSize: 13, alignItems: "center", gap: 6,
                    }}>
                      <div style={{ fontWeight: 600 }}>{chatterNameFn(r.chatterId)}</div>
                      <div style={{ color: C.textDim, fontSize: 12 }}>{clientNameFn(chatterClientFn(r.chatterId))}</div>
                      <div style={{ color: C.textMuted, fontSize: 11, fontFamily: "'JetBrains Mono',monospace" }}>{shortDate(r.date)}</div>
                      <div style={{ fontWeight: 700, color: C.accent }}>{fmt(r.amount)}</div>
                      <div style={{ color: C.accent2, fontSize: 12 }}>{fmt(r.agencyCut)}</div>
                      <div style={{ color: C.earn, fontSize: 12 }}>{fmt(r.chatterCut)}</div>
                      <button className="no-print" onClick={() => persist({ ...data, records: data.records.filter((x) => x.id !== r.id) })} style={{
                        background: "none", border: "none", color: "rgba(239,68,68,0.4)",
                        cursor: "pointer", fontSize: 14, padding: 3, gridColumn: "7"
                      }}>✖</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── MODALS ── */}
      <Modal open={addClientOpen} onClose={() => setAddClientOpen(false)} title="Add Client">
        <Field label="Client Name">
          <input type="text" placeholder="Enter client name..." value={newClientName}
            onChange={(e) => setNewClientName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addClient(); }}
            style={inpStyle} />
        </Field>
        <div style={{ display: "flex", gap: 12 }}>
          <Field label="Agency Cut (%)">
            <input type="number" step="0.1" value={newClientAgencyCut}
              onChange={(e) => setNewClientAgencyCut(e.target.value)}
              style={inpStyle} />
          </Field>
          <Field label="Chatter Pay (%)">
            <input type="number" step="0.1" value={newClientChatterCut}
              onChange={(e) => setNewClientChatterCut(e.target.value)}
              style={inpStyle} />
          </Field>
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 6 }}>
          <Btn variant="secondary" onClick={() => setAddClientOpen(false)}>Cancel</Btn>
          <Btn onClick={addClient} disabled={!newClientName.trim()}>Add Client</Btn>
        </div>
      </Modal>

      <Modal open={addChatterOpen} onClose={() => setAddChatterOpen(false)} title="Add Chatter">
        <Field label="Client">
          <select value={chatterClientId} onChange={(e) => setChatterClientId(e.target.value)}
            style={{ ...inpStyle, cursor: "pointer", background: "#151916" }}>
            <option value="">Select client...</option>
            {data.clients.map((cl) => <option key={cl.id} value={cl.id}>{cl.name}</option>)}
          </select>
        </Field>
        <Field label="Chatter Name">
          <input type="text" placeholder="Enter name..." value={newChatterName}
            onChange={(e) => setNewChatterName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addChatter(); }}
            style={inpStyle} />
        </Field>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 6 }}>
          <Btn variant="secondary" onClick={() => setAddChatterOpen(false)}>Cancel</Btn>
          <Btn onClick={addChatter} disabled={!newChatterName.trim() || !chatterClientId}>Add Chatter</Btn>
        </div>
      </Modal>

      <Modal open={!!editingClient} onClose={() => setEditingClient(null)} title="Client Settings">
        {editingClient && (
          <div>
            <p style={{ fontSize: 13, color: C.textDim, marginBottom: 18 }}>Update paycut percentages for <strong>{editingClient.name}</strong>.</p>
            <div style={{ display: "flex", gap: 12 }}>
              <Field label="Agency Cut (%)">
                <input type="number" step="0.1" defaultValue={(editingClient.agencyCut || AGENCY_CUT) * 100}
                  id="edit-ag-cut" style={inpStyle} />
              </Field>
              <Field label="Chatter Pay (%)">
                <input type="number" step="0.1" defaultValue={(editingClient.chatterCut || CHATTER_CUT) * 100}
                  id="edit-ch-cut" style={inpStyle} />
              </Field>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 10 }}>
              <Btn variant="secondary" onClick={() => setEditingClient(null)}>Cancel</Btn>
              <Btn onClick={() => {
                const ag = parseFloat(document.getElementById("edit-ag-cut").value) / 100;
                const ch = parseFloat(document.getElementById("edit-ch-cut").value) / 100;
                updateClientCuts(editingClient.id, ag, ch);
              }}>Save Changes</Btn>
            </div>
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
      {invoiceView && <InvoiceView {...invoiceView} onClose={() => setInvoiceView(null)} />}

      <Modal open={smartPasteOpen} onClose={() => setSmartPasteOpen(false)} title="✨ Smart Paste Sales">
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
            <span>Please select a client in the "Record Sales" tab first.</span>
          </div>
        )}
        <textarea
          value={pastedText}
          onChange={(e) => setPastedText(e.target.value)}
          placeholder="e.g. John: $450.00&#10;Sarah had a great day with 250..."
          style={{
            ...inpStyle, height: 180, resize: "none", fontSize: 13, lineHeight: 1.6,
            background: "rgba(255,255,255,0.02)", marginBottom: 16,
          }}
        />

        {parsedResults && Object.keys(parsedResults).length > 0 && (
          <div style={{
            background: "rgba(173,255,180,0.05)", border: "1px solid " + C.accentBorder,
            borderRadius: 12, padding: 14, marginBottom: 18
          }}>
            <div style={{ fontSize: 11, color: C.textDim, fontFamily: "'JetBrains Mono',monospace", marginBottom: 8 }}>DETECTED SALES</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {Object.entries(parsedResults).map(([id, val]) => (
                <div key={id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 }}>
                  <span style={{ fontWeight: 600 }}>{chatterNameFn(id)}</span>
                  <span style={{ color: C.accent, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace" }}>{fmt(val)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {parsedResults && Object.keys(parsedResults).length === 0 && (
          <div style={{ textAlign: "center", padding: 12, color: "#ff7f7f", fontSize: 13, marginBottom: 16 }}>
            No sales or chatter names detected. Try adjusting the text.
          </div>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Btn variant="secondary" onClick={() => setSmartPasteOpen(false)}>Cancel</Btn>
          {!parsedResults ? (
            <Btn onClick={parseSales} disabled={!pastedText.trim() || !salesClientId}>Scan Text</Btn>
          ) : (
            <Btn onClick={applyParsed} disabled={Object.keys(parsedResults).length === 0}>Apply to Inputs</Btn>
          )}
        </div>
      </Modal>
    </div >
  );
}

export default App;
