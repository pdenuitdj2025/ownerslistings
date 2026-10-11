import { chromium } from "playwright";
import { kvGet, kvSet } from "./db.js";
import { mergeAds } from "./merge.js";
import { ensureLogin, loadState, saveState } from "./auth.js";
import { scrapeIndomio } from "./scrapers/indomio.js";
import { scrapeSpiti24 } from "./scrapers/spiti24.js";
import { scrapePlot } from "./scrapers/plot.js";
import { scrapeXe } from "./scrapers/xe.js";
import { scrapeSpitogatos } from "./scrapers/spitogatos.js";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const SITES = [
  { key: "indomio", label: "Indomio", run: scrapeIndomio },
  { key: "spiti24", label: "Spiti24", run: scrapeSpiti24 },
  { key: "plot", label: "Plot", run: scrapePlot },
  { key: "xe", label: "xe.gr", run: scrapeXe, login: { home: "https://www.xe.gr/", probe: "https://www.xe.gr/property/results?item_type=residence&transaction_name=buy&publication_origins%5B%5D=false&country=GR&geo_place_ids%5B%5D=ChIJUwsYu2cPnxQRkIC54iy9AAE&sorting=publication_date_desc" } },
  { key: "spitogatos", label: "Spitogatos", run: scrapeSpitogatos, login: { home: "https://www.spitogatos.gr/", probe: "https://www.spitogatos.gr/pwliseis-katoikies/athina-kentro/prwti_dimosieusi_24wres/order_datemodified_desc" } },
];

let running = false;
export const isRunning = () => running;

export async function runAll() {
  if (running) return { skipped: true };
  running = true;
  const started = new Date().toISOString();
  const sites = (await kvGet("sites")) || {};
  let totalNew = 0, totalMerged = 0;
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"] });
  try {
    for (const s of SITES) {
      let context;
      try {
        context = await browser.newContext({ userAgent: UA, locale: "el-GR", timezoneId: "Europe/Athens", viewport: { width: 1366, height: 900 }, storageState: s.login ? await loadState(s.key) : undefined });
        await context.addInitScript(() => Object.defineProperty(navigator, "webdriver", { get: () => undefined }));
        const page = await context.newPage();
        page.setDefaultTimeout(30000);
        if (s.login) await ensureLogin(page, context, { site: s.key, label: s.label, ...s.login });
        const ads = await s.run(page);
        if (s.login) await saveState(s.key, context);
        if (!ads.length) throw Object.assign(new Error(`${s.label}: the page loaded but 0 ads were read (layout may have changed).`), { code: "empty" });
        const { created, merged } = await mergeAds(ads);
        totalNew += created; totalMerged += merged;
        sites[s.key] = { status: "ok", at: new Date().toISOString(), scraped: ads.length, created, merged };
        console.log(`[${s.label}] scraped ${ads.length}, new ${created}, merged ${merged}`);
      } catch (e) {
        console.error(`[${s.label}] ${e.message}`);
        sites[s.key] = { status: e.code || "error", message: e.message.slice(0, 300), at: new Date().toISOString() };
      } finally {
        await context?.close().catch(() => {});
      }
      await kvSet("sites", sites);
    }
  } finally {
    await browser.close().catch(() => {});
    running = false;
  }
  await kvSet("run", { lastCheck: new Date().toISOString(), lastNew: totalNew, lastMerged: totalMerged, started });
  return { totalNew, totalMerged };
}
