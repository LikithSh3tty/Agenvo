// End-to-end drive of the deployed Agenvo app with a disposable test account.
// Service-agency preset wording: staff = "Team Member", cuts = 10% / 10%.
const { chromium } = require("playwright");
const path = require("path");

const BASE = process.env.BASE || "https://agency-x-six.vercel.app";
const SHOTS = process.env.SHOTS_DIR || ".";
const EMAIL = process.env.E2E_EMAIL || "agenvo.e2e.20260719@example.com";
const PASS = "Smoke-Test-2026!";

const results = [];
let shotN = 0;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  const shot = async (name) => {
    const f = path.join(SHOTS, String(++shotN).padStart(2, "0") + "-" + name + ".png");
    await page.screenshot({ path: f }).catch(() => {});
  };
  const body = () => page.evaluate(() => document.body.innerText);
  const step = async (name, fn) => {
    try {
      const note = await fn();
      results.push("PASS " + name + (note ? " — " + note : ""));
      await shot(name.replace(/[^a-z0-9]+/gi, "-").toLowerCase());
    } catch (e) {
      results.push("FAIL " + name + " — " + String(e.message).split("\n")[0].slice(0, 200));
      await shot("FAIL-" + name.replace(/[^a-z0-9]+/gi, "-").toLowerCase());
      console.log("  [after fail: " + name + "]\n" + (await body().catch(() => "")).slice(0, 500).replace(/\n{2,}/g, "\n"));
    }
  };
  const clickBtn = async (rx, opts = {}) => {
    const all = page.getByRole("button", { name: rx });
    const b = opts.last ? all.last() : all.first();
    await b.waitFor({ state: "visible", timeout: opts.timeout || 8000 });
    await b.click();
  };
  const nav = async (label) => {
    await page.getByText(label, { exact: true }).first().click();
    await page.waitForTimeout(700);
  };

  await step("load: login overlay appears", async () => {
    await page.goto(BASE, { waitUntil: "load", timeout: 45000 });
    await page.getByText("Sign in to your workspace").waitFor({ timeout: 15000 });
  });

  await step("sign in / sign up test account", async () => {
    await page.getByRole("tab", { name: "SIGN UP" }).click();
    await page.getByPlaceholder("Jane Doe").fill("Claude Smoke");
    await page.getByPlaceholder("you@agency.com").fill(EMAIL);
    await page.getByPlaceholder("At least 6 characters").fill(PASS);
    await clickBtn(/Open workspace/);
    await page.waitForTimeout(4000);
    let how = "new account " + EMAIL;
    if (/already (in use|registered|exists)/i.test(await body())) {
      await page.getByRole("tab", { name: "LOG IN" }).click();
      await page.getByPlaceholder("you@agency.com").fill(EMAIL);
      await page.getByPlaceholder("Your password").fill(PASS);
      await clickBtn(/Enter workspace/);
      how = "account existed; logged in";
    }
    await page.getByText("Sign in to your workspace").waitFor({ state: "hidden", timeout: 25000 });
    return how + " (overlay gone)";
  });

  await step("onboarding or dashboard", async () => {
    await page.getByText(/What kind of agency do you run\?|total sales/i).first().waitFor({ timeout: 25000 });
    if (!/What kind of agency/.test(await body())) return "already onboarded; dashboard shown";
    await clickBtn(/Continue/);
    await page.getByText("Tell us about your agency").waitFor({ timeout: 10000 });
    await page.getByPlaceholder("e.g. Acme Studio").fill("Claude Smoke Agency");
    await clickBtn(/Continue/);
    await page.getByText("Default payout").waitFor({ timeout: 10000 });
    await clickBtn(/Enter dashboard/);
    await page.getByText("TOTAL SALES").waitFor({ timeout: 20000 });
    return "onboarded as service agency";
  });

  await step("client Acme Corp exists or is added", async () => {
    await nav("Clients");
    await page.waitForTimeout(800);
    if ((await body()).includes("Acme Corp")) return "already present from earlier run";
    await clickBtn(/Add Client/);
    await page.getByPlaceholder(/Enter .*name/).fill("Acme Corp");
    await clickBtn(/^Add Client$/, { last: true });
    await page.getByText("Acme Corp").first().waitFor({ timeout: 8000 });
    return "added";
  });

  await step("add team member Alice", async () => {
    if ((await body()).includes("Alice")) return "already present";
    await clickBtn(/Team Member/);
    await page.locator("select").first().selectOption({ label: "Acme Corp" });
    await page.getByPlaceholder("Enter name...").fill("Alice");
    await clickBtn(/^Add Team Member$/, { last: true });
    await page.getByText("Alice").first().waitFor({ timeout: 8000 });
  });

  await step("PROBE NumInput sanitizes '05x7'", async () => {
    await nav("Add Sale");
    await page.getByLabel("Select client for sales entry").selectOption({ label: "Acme Corp" });
    await page.waitForTimeout(600);
    const amt = page.getByPlaceholder("0").first();
    await amt.click();
    await amt.pressSequentially("05x7");
    const v = await amt.inputValue();
    if (v !== "57") throw new Error("expected '57', got '" + v + "'");
    return "typed 05x7 → field shows 57";
  });

  await step("record $1,000 sale for Alice", async () => {
    const amt = page.getByPlaceholder("0").first();
    await amt.fill("");
    await amt.pressSequentially("1000");
    await clickBtn(/Save All/);
    await page.getByText(/recorded for/).waitFor({ timeout: 8000 });
  });

  await step("dashboard math: $1,000 total, $100 fee, $100 team", async () => {
    await nav("Dashboard");
    const txt = await body();
    if (!txt.includes("$1,000.00")) throw new Error("missing $1,000.00");
    if ((txt.match(/\$100\.00/g) || []).length < 2) throw new Error("agency fee / team pay not both $100.00");
    if (/\d+ chatters/i.test(txt)) throw new Error("hardcoded 'chatters' label on By-Client card");
    if (!/1 team member\b/i.test(txt)) throw new Error("By-Client card not using terms ('1 team member')");
  });

  await step("set business address in settings", async () => {
    await nav("Settings");
    const ta = page.locator("textarea").first();
    await ta.waitFor({ timeout: 10000 });
    await ta.fill("221B Test Street\nSpec City");
    await clickBtn(/Save settings/);
    await page.waitForTimeout(1500);
  });

  await step("invoice opens with amount in words", async () => {
    await nav("Dashboard");
    await clickBtn(/^Invoice$/, { timeout: 10000 });
    await page.waitForTimeout(1500);
    const txt = await body();
    await shot("invoice-view");
    const words = (txt.match(/\b(One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten)[A-Za-z ]*(Thousand|Hundred)[A-Za-z ]*\b/) || [""])[0];
    const ref = (txt.match(/\b[A-Z]{2,4}[-\/]\S*\d+\b/) || [""])[0];
    // reload to guarantee the modal is gone regardless of assert outcome
    await page.reload({ waitUntil: "load" });
    await page.getByText(/total sales/i).first().waitFor({ timeout: 25000 });
    if (!words) throw new Error("amount-in-words not found in invoice view");
    return "amount in words: \"" + words.trim() + "\"" + (ref ? ", ref " + ref : "");
  });

  await step("history shows the record", async () => {
    await nav("History");
    const txt = await body();
    if (!txt.includes("Acme Corp") || !txt.includes("$1,000.00")) throw new Error("record not in history");
    if (/All Chatters/.test(txt)) throw new Error("history filter still says 'All Chatters'");
    if (!/All Team Members/i.test(txt)) throw new Error("history filter not using terms");
    if (/stored only in this browser/.test(txt)) throw new Error("stale local-storage backup copy still shown");
    if (!/syncs to your account/.test(txt)) throw new Error("new cloud-sync backup copy missing");
  });

  await step("dark mode toggles theme vars", async () => {
    const getBg = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--bg").trim());
    const before = await getBg();
    await page.getByLabel(/Switch to (dark|light) mode/).click();
    await page.waitForTimeout(800);
    const after = await getBg();
    if (before === after) throw new Error("--bg unchanged: " + before);
    return before + " → " + after;
  });

  await step("assistant answers with real numbers", async () => {
    await page.getByLabel("Open assistant").click();
    await page.getByPlaceholder("Ask about the app or your numbers").fill("What are my total sales?");
    await page.getByLabel("Send").click();
    let reply = "";
    for (let i = 0; i < 30; i++) {
      await page.waitForTimeout(1500);
      const after = (await body()).split("What are my total sales?").pop() || "";
      if (after.trim().length > 25 && /\d/.test(after)) { reply = after.trim(); break; }
    }
    if (!reply) throw new Error("no assistant reply within 45s");
    await page.getByLabel("Close assistant").click().catch(() => {});
    return "reply: \"" + reply.replace(/\s+/g, " ").slice(0, 160) + "\"";
  });

  await step("reload: session + data persist", async () => {
    await page.reload({ waitUntil: "load" });
    await page.getByText("TOTAL SALES").waitFor({ timeout: 25000 });
    const txt = await body();
    if (/Sign in to your workspace/.test(txt)) throw new Error("logged out after reload");
    if (!txt.includes("$1,000.00")) throw new Error("sale not persisted after reload");
  });

  await step("reset workspace data", async () => {
    await nav("Settings");
    await clickBtn(/Reset workspace data/, { timeout: 12000 });
    await page.getByPlaceholder("RESET").fill("RESET");
    await clickBtn(/^Reset data$/, { last: true });
    await page.waitForTimeout(3500);
    await nav("Dashboard");
    const txt = await body();
    if (txt.includes("$1,000.00") || txt.includes("Acme Corp")) throw new Error("data still present after reset");
  });

  await step("delete test account (cleanup)", async () => {
    await nav("Settings");
    await clickBtn(/Delete account/, { timeout: 12000 });
    await page.getByPlaceholder("DELETE").fill("DELETE");
    await page.getByPlaceholder("Your password").last().fill(PASS);
    await clickBtn(/Delete account/, { last: true });
    await page.getByText("Sign in to your workspace").waitFor({ timeout: 25000 });
  });

  console.log("\n===== RESULTS =====");
  for (const r of results) console.log(r);
  console.log("page errors: " + (pageErrors.length ? pageErrors.join(" | ") : "(none)"));
  await browser.close();
  process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
})();
