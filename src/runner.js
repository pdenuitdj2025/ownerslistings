import { chromium } from "playwright";
import { kvGet, kvSet } from "./db.js";
import { mergeAds } from "./merge.js";
import { ensureLogin, loadState, saveState } from "./auth.js";
// import { scrapeIndomio } from "./scrapers/indomio.js";
import { scrapeSpiti24 } from "./scrapers/spiti24.js";
// import { scrapePlot } from "./scrapers/plot.js";
import { scrapeXe, dismissConsent } from "./scrapers/xe.js";
import { scrapeSpitogatos, readPages, AREAS as SG_AREAS } from "./scrapers/spitogatos.js";
import { verifySite } from "./verify.js";
import { phoneSite, revealPhone } from "./phone.js";

// Optional proxy (env PROXY_URL, e.g. http://user:pass@host:port) used ONLY for sites that block datacenter addresses.
function proxyOpt() {
  const raw = process.env.PROXY_URL; if (!raw) return undefined;
  try { const u = new URL(raw); return { server: `${u.protocol}//${u.host}`, username: decodeURIComponent(u.username), password: decodeURIComponent(u.password) }; } catch { return undefined; }
}
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const SITES = [
  { key: "spiti24", label: "Spiti24", run: scrapeSpiti24 },
  { key: "xe", label: "xe.gr", run: scrapeXe, login: { home: "https://www.xe.gr/", preflight: dismissConsent, loggedOutText: /Συνδέσου για να τις δεις/, probe: "https://www.xe.gr/property/results?item_type=residence&transaction_name=buy&publication_origins%5B%5D=false&country=GR&geo_place_ids%5B%5D=ChIJUwsYu2cPnxQRkIC54iy9AAE&sorting=publication_date_desc" } },
  { key: "spitogatos", label: "Spitogatos", run: scrapeSpitogatos, login: { home: "https://www.spitogatos.gr/", probe: "https://www.spitogatos.gr/pwliseis-katoikies/athina-kentro/prwti_dimosieusi_24wres/order_datemodified_desc" } },
];

let running = false;
export const isRunning = () => running;

export async function runAll({ verify = true, enrich = false, phones = false, scan = false } = {}) {
  if (running) return { skipped: true };
  running = true;
  const started = new Date().toISOString();
  const sites = (await kvGet("sites")) || {};
  let totalNew = 0, totalMerged = 0;
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"] });
  try {
    for (const s of SITES) {
      let context, page;
      try {
        context = await browser.newContext({ userAgent: UA, locale: "el-GR", timezoneId: "Europe/Athens", viewport: { width: 1366, height: 900 }, storageState: s.login ? await loadState(s.key) : undefined, proxy: s.proxy ? proxyOpt() : undefined });
        await context.addInitScript(() => Object.defineProperty(navigator, "webdriver", { get: () => undefined }));
        page = await context.newPage();
        page.setDefaultTimeout(30000);
        if (s.login) await ensureLogin(page, context, { site: s.key, label: s.label, ...s.login });
        if (scan) {   // full re-check of every listing: dead ads and ads without a photo are removed
          const since = (await kvGet("scanStartedAt")) || new Date().toISOString();
          const e = await verifySite(page, s.key, { mode: "scan", since });
          if (s.login) await saveState(s.key, context);
          sites[s.key] = { ...(sites[s.key] || {}), scan: { ...e, at: new Date().toISOString() } };
          console.log(`[${s.label}] scan: ${JSON.stringify(e)}`);
          await kvSet("sites", sites);
          continue;
        }
        if (phones) {   // phone backfill only
          const e = await phoneSite(page, s.key, { limit: 2000, maxMs: 25 * 60 * 1000 });
          if (s.login) await saveState(s.key, context);
          sites[s.key] = { ...(sites[s.key] || {}), phones: { ...e, at: new Date().toISOString() } };
          await kvSet("sites", sites);
          continue;
        }
        if (enrich) {   // backfill only: open listed ads that have no photo link yet; no scraping of the lists
          const e = await verifySite(page, s.key, { mode: "photos" });
          if (s.login) await saveState(s.key, context);
          sites[s.key] = { ...(sites[s.key] || {}), enriched: { ...e, at: new Date().toISOString() } };
          console.log(`[${s.label}] enrich: ${JSON.stringify(e)}`);
          await kvSet("sites", sites);
          continue;
        }
        const ads = await s.run(page);
        if (s.login) await saveState(s.key, context);
        if (!ads.length) throw Object.assign(new Error(`${s.label}: the page loaded but 0 ads were read (layout may have changed).`), { code: "empty" });
        const { created, merged, dropped } = await mergeAds(ads);
        totalNew += created; totalMerged += merged;
        sites[s.key] = { status: "ok", at: new Date().toISOString(), scraped: ads.length, created, merged, dropped };
        if (verify) try { sites[s.key].verified = await verifySite(page, s.key); } catch (e) { console.error(`[${s.label}] verify failed: ${e.message}`); sites[s.key].verified = { error: e.message.slice(0, 120) }; }
        try { sites[s.key].phones = { ...(await phoneSite(page, s.key, { limit: 40 })), at: new Date().toISOString() }; } catch (e) { console.error(`[${s.label}] phones failed: ${e.message}`); }
        console.log(`[${s.label}] scraped ${ads.length}, new ${created}, merged ${merged}, price drops ${dropped}`);
      } catch (e) {
        console.error(`[${s.label}] ${e.message}`);
        let diag = {};
        try { diag = { url: page.url(), title: (await page.title()).slice(0, 120), body: (await page.locator("body").innerText({ timeout: 3000 })).replace(/\s+/g, " ").slice(0, 200), buttons: (await page.getByRole("button").allInnerTexts()).map((t) => t.trim()).filter(Boolean).slice(0, 12) }; } catch { /* page gone */ }
        sites[s.key] = { status: e.code || "error", message: e.message.slice(0, 300), at: new Date().toISOString(), ...diag };
      } finally {
        await context?.close().catch(() => {});
      }
      await kvSet("sites", sites);
    }
  } finally {
    await browser.close().catch(() => {});
    running = false;
  }
  if (!enrich) await kvSet("run", { lastCheck: new Date().toISOString(), lastNew: totalNew, lastMerged: totalMerged, started });
  return { totalNew, totalMerged };
}

// Weekly full sweep of Spitogatos (it has no owners-only filter, so every list page is read and agency ads are dropped).
// Slow on purpose, resumable: progress is kept in the database, so a restart continues where it stopped.
export async function runSweep() {
  if (running) return { skipped: true };
  running = true;
  let st = (await kvGet("sweep")) || {};
  if (!st.startedAt || st.done) st = { startedAt: new Date().toISOString(), ai: 0, page: 1, prev: "", ads: 0, created: 0, done: false };
  const s = SITES.find((x) => x.key === "spitogatos");
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"] });
  try {
    const context = await browser.newContext({ userAgent: UA, locale: "el-GR", timezoneId: "Europe/Athens", viewport: { width: 1366, height: 900 }, storageState: await loadState("spitogatos") });
    await context.addInitScript(() => Object.defineProperty(navigator, "webdriver", { get: () => undefined }));
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    await ensureLogin(page, context, { site: s.key, label: s.label, ...s.login });
    await saveState("spitogatos", context);
    while (st.ai < SG_AREAS.length) {
      const r = await page.evaluate(readPages, { area: SG_AREAS[st.ai], filter: "", from: st.page, to: st.page + 19, delay: 1400, prevIds: st.prev });
      if (r.blocked) { st.note = `blocked with ${r.status}, will resume`; await kvSet("sweep", st); console.error("[sweep]", st.note); return { paused: true }; }
      const { created } = await mergeAds(r.out);
      st.ads += r.out.length; st.created += created; st.prev = r.lastIds; st.page += r.read; st.note = "";
      if (r.ended || st.page > 2500) { console.log(`[sweep] ${SG_AREAS[st.ai]} done at page ${st.page}`); st.ai++; st.page = 1; st.prev = ""; }
      await kvSet("sweep", st);
    }
    st.done = true; st.finishedAt = new Date().toISOString();
    await kvSet("sweep", st);
    console.log(`[sweep] finished: ${st.ads} owner ads read, ${st.created} new`);
    return { done: true };
  } catch (e) {
    console.error("[sweep]", e.message); st.note = String(e.message).slice(0, 200); await kvSet("sweep", st).catch(() => {});
    return { error: e.message };
  } finally { await browser.close().catch(() => {}); running = false; }
}

// Debug helper (team-password protected): opens a URL with the saved session of a site and reports what is on screen.
export async function debugPage(site, url, click, sel, find, dump, phone) {
  const s = SITES.find((x) => x.key === site) || SITES[0];
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"] });
  try {
    const context = await browser.newContext({ userAgent: UA, locale: "el-GR", timezoneId: "Europe/Athens", viewport: { width: 1280, height: 1000 }, storageState: s.login ? await loadState(s.key) : undefined });
    await context.addInitScript(() => Object.defineProperty(navigator, "webdriver", { get: () => undefined }));
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "load", timeout: 45000 });
    await page.waitForTimeout(6000);
    const { dismissConsent } = await import("./scrapers/xe.js");
    if (site === "xe") await dismissConsent(page);
    await page.waitForTimeout(3000);
    if (click) { for (const c of String(click).split("|")) { await page.getByText(c.startsWith("~") ? c.slice(1) : c, { exact: !c.startsWith("~") }).first().click({ timeout: 6000, force: true }).catch((e) => console.log("debug click failed", String(e).slice(0, 100))); await page.waitForTimeout(3000); } }
    if (phone) {
      const seen = []; page.on("response", async (r) => { if (/emfanisi-tilefonou|phone/i.test(r.url())) seen.push(r.status() + " " + r.url().slice(0, 80) + " :: " + (await r.text().catch(() => "")).replace(/\d{4,}/g, "#").slice(0, 200)); });
      const btnTexts = await page.locator("button:visible").evaluateAll((els) => els.map((e) => e.innerText.trim().slice(0, 30)).slice(0, 12));
      const p = await revealPhone(page, site);
      const { extractDetails } = await import("./details.js");
      const det = await extractDetails(page, site).catch((e) => String(e));
      const lines = (await page.locator("body").innerText()).split("\n").map((l) => l.trim()).filter(Boolean);
      const i0 = Math.max(0, lines.findIndex((l) => /^Περιγραφή/.test(l)) - 2);
      return { phone: p ? "ok" : null, det: det && typeof det === "object" ? { ...det, desc: (det.desc || "").slice(0, 80) } : det, lines: lines.slice(i0, i0 + 40).map((l) => l.slice(0, 50).replace(/\d{9,}/g, "#")) };
    }
    if (false) { const p = await revealPhone(page, site); const vis = await page.getByText("Εμφάνιση τηλεφώνου").evaluateAll((els) => els.map((e) => (e.offsetParent ? "vis" : "hid") + ":" + e.tagName + "." + e.className.toString().slice(0, 40))); return { phone: p ? p.replace(/\d(?=\d{3})/g, "#") : null, len: p ? p.length : 0, vis, after: (await page.locator(".mfp-content, [role=dialog], .modal, [class*=popup]:visible, a.reAgentPhone.s24EecClick").evaluateAll((els) => els.map((e) => e.innerText.replace(/\s+/g, " ").replace(/\d{4,}/g, "#").slice(0, 300)))).slice(0, 6) }; }
    const inputs = await page.locator("input:visible").evaluateAll((els) => els.map((e) => `${e.type}|${e.name}|${e.placeholder}|${e.autocomplete}`));
    const shot = (await page.screenshot({ type: "jpeg", quality: 55 })).toString("base64");
    return { url: page.url(), title: await page.title(), text: (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 1500), inputs, frames: page.frames().map((f) => f.url().slice(0, 100)), dump: dump ? await page.locator(String(dump)).first().innerText({ timeout: 4000 }).then((t) => t.replace(/\s+/g, " ").slice(0, 6000)).catch(() => "no match") : undefined, html: sel ? await page.locator(String(sel)).first().evaluate((e) => e.outerHTML.replace(/\s+/g, " ").slice(0, 4000)).catch(() => "no match") : undefined, found: find ? [...(await page.locator("body").innerText()).replace(/\s+/g, " ").matchAll(new RegExp(String(find), "gi"))].slice(0, 12).map((m) => m.input.slice(Math.max(0, m.index - 70), m.index + 110)) : undefined, agencyLinks: await page.locator('a[href*="/mesites/"]').evaluateAll((els) => els.map((e) => e.getAttribute("href")).slice(0, 5)).catch(() => []), cookies: (await context.cookies()).map((c) => c.name).slice(0, 40), shot };
  } finally { await browser.close(); }
}
