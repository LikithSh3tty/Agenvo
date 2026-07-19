import React, { useState, useEffect, useRef } from "react";
import AccountMenu from "../auth/AccountMenu.jsx";
import { useAuth } from "../auth/AuthContext.jsx";
import ChatWidget from "../chat/ChatWidget.jsx";
import { ActivityHeatmap, RevenueTrend, SplitRing } from "./charts.jsx";
import { AGENCY_CUT, CHATTER_CUT, ConfigContext, clientCommission, clientRoles, clientUsesHours, computeShare, computeShares, defaultCommissionParts, defaultConfig, mergeConfig, partLabel, roleCut } from "./config.js";
import { baseCode, clientCur, curInfo, currencyReg, fetchLiveRates, fmt, fmtIn, fromCents, isMultiCurrency, money, numClean, setActiveCurrency, setCurrencyContext, sumMoney, toBase, toCents } from "./currency.js";
import { InvoiceView, ShareCard } from "./invoice.jsx";
import { InsightsPanel, InvoicesPanel, ManagementApp } from "./management.jsx";
import { TabBar } from "./nav.jsx";
import { Onboarding } from "./onboarding.jsx";
import { CommissionEditor, CurrencySelect, SettingsPanel } from "./settings.jsx";
import { C, DARK, THEME } from "./theme.js";
import { Avatar, BrutalCheck, Btn, CLIENT_COLORS, EmptyState, Field, Icon, Modal, StatCard, ThemeToggle, clientColor, inpStyle } from "./ui.jsx";
import { STORAGE_KEY, THEME_KEY, defaultState, genId, loadData, printElement, saveData, shortDate, today } from "./utils.js";

function App() {
  const [data, setData] = useState(defaultState);
  const config = data.config || defaultConfig;
  setActiveCurrency(config.locale);
  setCurrencyContext(config);
  const t = config.terms;
  // Guests see the pristine app shell behind the login overlay — never onboarding.
  const { user: authedUser } = useAuth();
  const needsOnboarding = !!authedUser && !config.onboarded
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
    topClient && topClient.total > 0 && { icon: "award", label: "Top " + t.client.one.toLowerCase(), value: topClient.name + " · " + fmtIn(topClient.total, topClient.currency) },
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
          --pop: ${TH.pop};
          --pop2: ${TH.pop2};
          --pop-rgb: ${TH.popRgb};
          --pop-fg: ${TH.popFg};
          --pop-dim: rgba(var(--pop-rgb), 0.10);
          --pop-border: rgba(var(--pop-rgb), 0.32);
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
        .side-nav { display: none; }
        .snav-item { transition: background .18s ease, color .18s ease; }
        .side-nav { transition: width .22s cubic-bezier(.4,0,.2,1), padding .22s cubic-bezier(.4,0,.2,1); }
        .snav-burger { transition: color .18s ease, background .18s ease; }
        .snav-burger:hover { color: var(--ink); background: var(--surface2); }
        .snav-item:not(.snav-active):hover { background: rgba(var(--ink-rgb),0.06); color: var(--ink); }
        .side-nav { transition: width .25s ease, left .25s ease; }
        @media (min-width: 900px) {
          .desktop-nav { display: none !important; }
          .side-nav { display: flex; }
          /* Clear the fixed sidebar rail (width set by the collapse toggle),
             but stay centered on wide screens. */
          .app-main, .app-head {
            margin-left: max(var(--snav-w, 250px), calc(50vw - 510px)) !important;
            transition: margin-left .25s ease;
          }
        }
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

      <div className="no-print glass" style={{
        padding: "12px 0",
        background: "var(--header-bg)",
        position: "sticky", top: 0, zIndex: 100,
      }}>
        <div className="app-head" style={{ maxWidth: 1020, margin: "0 auto", padding: "0 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
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
                background: "var(--pop)", color: "var(--pop-fg)",
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

      <div className="no-print app-main" style={{ maxWidth: 1020, margin: "0 auto", padding: "28px 20px 60px" }}>
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
                            <span style={{ color: "var(--text-muted)", fontSize: 12, marginLeft: 8 }}>{cl.chatterCount} {(cl.chatterCount === 1 ? t.staff.one : t.staff.many).toLowerCase()}</span>
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
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
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
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22, flexWrap: "wrap", gap: 10 }}>
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
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: ch.length ? 12 : 0, flexWrap: "wrap", gap: 10 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
                          <Avatar name={cl.name} size={40} color={clientColor(cl)} />
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: 16, overflowWrap: "anywhere" }}>{cl.name}</div>
                            <div style={{ fontSize: 11, color: C.textMuted, fontFamily: "'JetBrains Mono',monospace" }}>{ch.length} {ch.length === 1 ? t.staff.one.toLowerCase() : t.staff.many.toLowerCase()}{clientRoles(cl).length ? " · " + clientRoles(cl).length + " extra " + (clientRoles(cl).length === 1 ? "role" : "roles") : ""}</div>
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
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
                  Your data syncs to your account in the cloud. Save a backup file now and then for extra safety.
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
              <Field label={t.staff.one}>
                <select value={filterChatter} aria-label={`Filter by ${t.staff.one.toLowerCase()}`} onChange={(e) => setFilterChatter(e.target.value)} style={{ ...inpStyle, cursor: "pointer", background: "var(--surface)" }}>
                  <option value="all">All {t.staff.many}</option>
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
    <ChatWidget data={data} config={config} />
    </ConfigContext.Provider>
  );
}

export default App;
