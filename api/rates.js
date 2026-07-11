// Same-origin FX rate proxy. Ad blockers and some networks block third-party
// rate hosts from the browser, but they can't block the app's own domain — so
// the client asks this function, and the upstream fetch happens server-side.
// Responses are cached at the Vercel edge for an hour per base currency.
//
// GET /api/rates?base=USD → { result: "success", base: "USD", rates: { INR: 95.4, ... } }

const sources = (b) => [
  async () => {
    const j = await (await fetch("https://open.er-api.com/v6/latest/" + encodeURIComponent(b))).json();
    if (!j || j.result !== "success" || !j.rates) throw new Error("bad response");
    return j.rates;
  },
  ...[
    "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/",
    "https://latest.currency-api.pages.dev/v1/currencies/",
  ].map((root) => async () => {
    const j = await (await fetch(root + b.toLowerCase() + ".json")).json();
    const m = j && j[b.toLowerCase()];
    if (!m) throw new Error("bad response");
    const rates = {};
    Object.keys(m).forEach((k) => { if (typeof m[k] === "number") rates[k.toUpperCase()] = m[k]; });
    return rates;
  }),
];

export default async function handler(req, res) {
  const base = (String(req.query.base || "USD").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3)) || "USD";
  for (const src of sources(base)) {
    try {
      const rates = await src();
      res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
      return res.status(200).json({ result: "success", base, rates });
    } catch { /* provider down — try the next */ }
  }
  return res.status(502).json({ result: "error", message: "All rate providers unavailable" });
}
