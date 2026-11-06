// Collects EVERY photo of an ad (full size) by opening the ad page. Results are cached in listings.gallery.
import { chromium } from "playwright";
import { pool } from "./db.js";
import { loadState } from "./auth.js";
import { dismissConsent } from "./scrapers/xe.js";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const LOGIN = { xe: true, spitogatos: true };

const pageGallery = {
  spiti24: () => {
    const h = document.documentElement.outerHTML, seen = new Map();
    for (const m of h.matchAll(/https?:\/\/(m\d\.spitogatos\.gr)\/(\d{6,})_(?:900x675|1600x1200)\.jpg/g)) if (!seen.has(m[2])) seen.set(m[2], `https://${m[1]}/${m[2]}_1600x1200.jpg`);
    return [...seen.values()];
  },
  spitogatos: () => {
    for (const sc of document.scripts) {
      const t = sc.textContent, i = t.indexOf("images:[{id:"); if (i < 0) continue;
      const seg = t.slice(i, t.indexOf("]", i)), out = [...seg.matchAll(/xlarge:"([^"]+)"/g)].map((m) => m[1].replace(/\\u002F/g, "/"));
      if (out.length) return out;
    }
    const og = document.querySelector('meta[property="og:image"]')?.content; return og ? [og.replace(/_\d+x\d+\.jpg.*$/, "_1600x1200.jpg")] : [];
  },
  xe: () => {
    for (const sc of document.querySelectorAll('script[type="application/ld+json"]')) {
      try { const j = JSON.parse(sc.textContent); if (j && j.image) return (Array.isArray(j.image) ? j.image : [j.image]).map((u) => String(u).replace(/\?.*$/, "")); } catch {}
    }
    return [];
  },
};

// items: [{id, url, source, photo}] -> Map id -> [urls]
export async function collectGalleries(items, onProgress = () => {}) {
  const out = new Map(); let done = 0;
  const ids = items.map((x) => x.id);
  const { rows } = await pool.query("SELECT id, gallery FROM listings WHERE id = ANY($1) AND gallery IS NOT NULL AND gallery_at > now() - interval '3 days'", [ids]);
  for (const r of rows) if (Array.isArray(r.gallery) && r.gallery.length) { out.set(r.id, r.gallery); done++; }
  onProgress(done, items.length);
  const todo = items.filter((x) => !out.has(x.id));
  if (!todo.length) return out;
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"] });
  try {
    const ctxs = {};
    for (const it of todo) {
      const key = pageGallery[it.source] ? it.source : "xe";
      try {
        ctxs[key] ||= await browser.newContext({ userAgent: UA, locale: "el-GR", timezoneId: "Europe/Athens", viewport: { width: 1280, height: 900 }, storageState: LOGIN[key] ? await loadState(key) : undefined });
        const page = await ctxs[key].newPage();
        try {
          await page.goto(it.url, { waitUntil: "domcontentloaded", timeout: 40000 });
          await page.waitForTimeout(key === "xe" ? 3500 : 2500);
          if (key === "xe") await dismissConsent(page).catch(() => {});
          let urls = await page.evaluate(pageGallery[key]).catch(() => []);
          urls = [...new Set(urls.filter((u) => /^https:\/\//.test(u)))].slice(0, 40);
          if (urls.length) { out.set(it.id, urls); await pool.query("UPDATE listings SET gallery=$2::jsonb, gallery_at=now() WHERE id=$1", [it.id, JSON.stringify(urls)]); }
        } finally { await page.close().catch(() => {}); }
      } catch (e) { console.error("gallery", it.id, String(e).slice(0, 120)); }
      onProgress(++done, items.length);
    }
  } finally { await browser.close().catch(() => {}); }
  return out;
}
