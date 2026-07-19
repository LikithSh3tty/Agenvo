

export const STORAGE_KEY = "fanlink-tracker-v4";
export const THEME_KEY = "agenvo-theme"; // "light" | "dark"; falls back to OS preference
export const defaultState = { clients: [], chatters: [], records: [], brands: [], entries: [], invoices: [] };

export const genId = () =>
  (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
export const today = () => new Date().toISOString().slice(0, 10);

export const shortDate = (d) => {
  const dt = new Date(d + "T00:00:00");
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};
// Monday-anchored week key (YYYY-MM-DD of that week's Monday) for weekly aggregation.
export const weekKey = (d) => {
  const dt = new Date(d + "T00:00:00");
  const off = (dt.getDay() + 6) % 7;
  dt.setDate(dt.getDate() - off);
  return dt.toISOString().slice(0, 10);
};

// Fiscal-year label for a date, given the FY start month (e.g. 4 = April -> "26-27").
const fiscalYear = (dateStr, startMonth = 1) => {
  const d = new Date((dateStr || today()) + "T00:00:00");
  const m = d.getMonth() + 1, y = d.getFullYear();
  const start = m >= startMonth ? y : y - 1;
  const pad = (n) => String(n % 100).padStart(2, "0");
  return `${pad(start)}-${pad(start + 1)}`;
};

// Expand an invoice-number template using a record + invoice config.
export const invoiceNumber = (record, inv) => {
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
export const darken = (hex, f) => {
  const m = /^#?([0-9a-fA-F]{6})$/.exec((hex || "").trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => Math.max(0, Math.round(x * (1 - f))));
  return "#" + ch.map((x) => x.toString(16).padStart(2, "0")).join("");
};


export async function loadData() {
  try {
    const r = await window.storage.get(STORAGE_KEY);
    return r ? JSON.parse(r.value) : null;
  } catch (e) {
    return null;
  }
}

export async function saveData(d) {
  try {
    await window.storage.set(STORAGE_KEY, JSON.stringify(d));
  } catch (e) {
    console.error("Save failed", e);
  }
}

const escHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const printElement = (elId, title) => {
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

