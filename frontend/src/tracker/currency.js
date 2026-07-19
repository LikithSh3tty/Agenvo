
// Active currency — kept in sync with config.locale by <App>. Single tenant per browser,
// so a module-level value lets fmt()/toWords() stay config-driven without threading props.
let activeCurrency = { locale: "en-US", currency: "USD", symbol: "$", words: { major: "Dollars", minor: "Cents" } };
export const setActiveCurrency = (loc) => {
  activeCurrency = {
    locale: loc.locale || "en-US",
    currency: loc.currency || "USD",
    symbol: loc.currencySymbol || "$",
    words: loc.currencyWords || { major: "Dollars", minor: "Cents" },
  };
};
export const fmt = (n) => {
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
export const toCents = (dollars) => Math.round(((Number(dollars) || 0) + Number.EPSILON) * 100);
export const fromCents = (c) => (Number(c) || 0) / 100;
// Round a dollar amount to whole cents.
export const money = (dollars) => fromCents(toCents(dollars));
// Sum an array of dollar values exactly (accumulate in integer cents).
export const sumMoney = (arr, fn = (x) => x) => fromCents(arr.reduce((c, x) => c + toCents(fn(x)), 0));

// ── Multi-currency ──────────────────────────────────────────────────
// The workspace has one BASE (reporting) currency (config.locale). Additional currencies
// live in config.currencies as { code, symbol, rate, locale } where rate = value of 1 unit
// of that currency in the base currency. Each client/record can be in any enabled currency.
export let currencyReg = { base: "USD", map: { USD: { symbol: "$", locale: "en-US", rate: 1, words: { major: "Dollars", minor: "Cents" } } } };
export const setCurrencyContext = (config) => {
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
export const baseCode = () => currencyReg.base;
export const curInfo = (code) => currencyReg.map[String(code || currencyReg.base).toUpperCase()] || currencyReg.map[currencyReg.base];
export const isMultiCurrency = () => Object.keys(currencyReg.map).length > 1;
// Format a value in a specific currency code (defaults to base).
export const fmtIn = (n, code) => {
  const v = Number(n) || 0;
  const cc = String(code || currencyReg.base).toUpperCase();
  const info = curInfo(cc);
  try { return new Intl.NumberFormat(info.locale, { style: "currency", currency: cc }).format(v); }
  catch { return info.symbol + v.toFixed(2); }
};
// Convert an amount in `code` to the base currency (rounded to cents).
export const toBase = (amount, code) => money((Number(amount) || 0) * (curInfo(code).rate || 0));
// A client's currency code (defaults to base).
export const clientCur = (client) => String((client && client.currency) || currencyReg.base).toUpperCase();

// ── Numeric input hygiene ───────────────────────────────────────────
// Sanitize a decimal string as the user types: digits and a single dot only,
// and no leading zeros ("05" → "5", "0.5" stays "0.5"). Amounts here are never
// negative, so "-" is stripped too.
export const numClean = (s, { integer = false } = {}) => {
  let v = String(s ?? "").replace(/[^\d.]/g, "");
  if (integer) v = v.replace(/\./g, "");
  const i = v.indexOf(".");
  if (i !== -1) v = v.slice(0, i + 1) + v.slice(i + 1).replace(/\./g, "");
  return v.replace(/^0+(?=\d)/, "");
};


// Common currencies for the pickers: symbol, display locale, and unit words
// (words feed "amount in words" on invoices). Exchange rates come live from
// the API below, never from this table.
export const CURRENCY_CATALOG = [
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
export const curCatalog = (code) => CURRENCY_CATALOG.find((c) => c.code === String(code || "").toUpperCase()) || null;

// Live FX rates (free, keyless). The primary source is the app's own /api/rates
// proxy — a same-origin request that ad blockers and DNS filters can't touch.
// Third-party hosts remain as fallbacks (they also cover local dev, where the
// serverless function isn't running). Returns units of each currency per 1
// `base` keyed by UPPERCASE code; the app stores rate = 1 / rates[code].
export const fetchLiveRates = async (base) => {
  const b = String(base || "USD").toUpperCase();
  const fromOwnApi = async () => {
    const j = await (await fetch("/api/rates?base=" + encodeURIComponent(b))).json();
    if (!j || j.result !== "success" || !j.rates) throw new Error("bad response");
    return j.rates;
  };
  const fromErApi = async () => {
    const j = await (await fetch("https://open.er-api.com/v6/latest/" + encodeURIComponent(b))).json();
    if (!j || j.result !== "success" || !j.rates) throw new Error("bad response");
    return j.rates;
  };
  const fromCurrencyApi = (root) => async () => {
    const j = await (await fetch(root + b.toLowerCase() + ".json")).json();
    const m = j && j[b.toLowerCase()];
    if (!m) throw new Error("bad response");
    const rates = {};
    Object.keys(m).forEach((k) => { if (typeof m[k] === "number") rates[k.toUpperCase()] = m[k]; });
    return rates;
  };
  const sources = [
    fromOwnApi,
    fromErApi,
    fromCurrencyApi("https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/"),
    fromCurrencyApi("https://latest.currency-api.pages.dev/v1/currencies/"),
  ];
  for (const src of sources) {
    try { return await src(); } catch { /* blocked or down — try the next host */ }
  }
  throw new Error("Rate service unavailable");
};


export const toWords = (num) => {
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

