// Hotels for sale, from broker sites that publish plain HTML + JSON-LD (no browser needed). Every ad here is an AGENCY ad.
import { pool, kvSet } from "./db.js";
import { mergeAds } from "./merge.js";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const get = async (u) => { const r = await fetch(u, { headers: { "user-agent": UA, "accept-language": "en,el;q=0.8" }, signal: AbortSignal.timeout(30000) }); if (!r.ok) throw new Error(`${u} → ${r.status}`); return r.text(); };
const ldBlocks = (html) => [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => { try { return JSON.parse(m[1]); } catch { return null; } }).filter(Boolean);
const num = (s) => Number(String(s).replace(/[.,](?=\d{3}\b)/g, "")) || null;

// ktimatoemporiki.gr — /search?type=hotels&offer=sale&page=N, ItemList JSON-LD; area (m²) is only in the visible card text
async function ktimato() {
  const base = "https://ktimatoemporiki.gr", out = []; let prev = "";
  for (let p = 1; p <= 40; p++) {
    const html = await get(`${base}/search?type=hotels&offer=sale` + (p > 1 ? `&page=${p}` : ""));
    const list = ldBlocks(html).find((b) => b["@type"] === "ItemList")?.itemListElement || [];
    if (!list.length) break;
    const first = list[0]?.item?.url || ""; if (first === prev) break; prev = first;
    for (const { item: it } of list) {
      if (!it?.url) continue;
      const slug = it.url.replace(/^.*\//, "");
      const at = html.indexOf(`href="${it.url}"`);
      let chunk = "";
      if (at >= 0) { const re = /href="(\/property\/[^"]+)"/g; re.lastIndex = at + 10; let end = at + 6000, m2; while ((m2 = re.exec(html)) && m2.index < at + 6000) if (m2[1] !== it.url) { end = m2.index; break; } chunk = html.slice(at, end).replace(/<(script|style)[\s\S]*?<\/\1>/g, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " "); }
      const m = chunk.match(/([\d.,]+)\s*m²/);
      const img = String(it.image || "").replace(/\?.*$/, "");
      out.push({ id: "kt-" + slug, source: "ktimato", url: base + it.url, category: "hotel", seller: "agency", type: "Ξενοδοχείο", sqm: m ? Math.round(num(m[1])) : null,
        price: it.offers?.price || null, floor: "", beds: it.numberOfBedrooms || null, year: null, location: it.address?.addressLocality || "", multi: false, posted: "", img: !!img, photo: img });
    }
    await new Promise((r) => setTimeout(r, 700));
  }
  return out;
}

// realting.com — /greece/commercial/hotels?page=N (30 per page); prices are listed in USD and kept in USD
async function realting() {   // realting.com blocks plain HTTP requests from servers, so a real browser reads the pages
  const base = "https://realting.com", out = []; let prev = "";
  const usd = (t) => { const m = String(t || "").match(/\$\s*([\d\s.,]+?)\s*([MK]?)\s*$/i); if (!m) return null; const n = m[2] ? parseFloat(m[1].replace(/\s/g, "").replace(",", ".")) * (m[2].toUpperCase() === "M" ? 1e6 : 1e3) : Number(m[1].replace(/[\s.,]/g, "")); return Math.round(n) || null; };
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"] });
  try {
    const ctx = await browser.newContext({ userAgent: UA, locale: "en-US", viewport: { width: 1366, height: 900 } });
    const page = await ctx.newPage();
    for (let p = 1; p <= 20; p++) {
      const resp = await page.goto(`${base}/greece/commercial/hotels` + (p > 1 ? `?page=${p}` : ""), { waitUntil: "domcontentloaded", timeout: 45000 });
      if (resp && resp.status() === 404 && p > 1) break;
      await page.waitForTimeout(1500);
      const html = await page.content();
      const blocks = html.split('<a class="flex-grow-1" href="').slice(1);
      if (!blocks.length) { if (p === 1) throw new Error("realting: no cards found (page blocked? title: " + (await page.title()).slice(0, 60) + ")"); break; }
      const first = blocks[0].slice(0, 80); if (first === prev) break; prev = first;
      for (const b of blocks) {
        const url = (b.match(/^(https:\/\/realting\.com\/greece\/commercial\/\d+)/) || [])[1]; if (!url) continue;
        const price = usd((b.match(/data-price-usd="([^"]+)"/) || [])[1]); if (!price) continue;
        const title = (b.match(/class="teaser-title[^>]*>([^<]+)</) || [])[1] || "", route = (b.match(/class="route">([^<]+)</) || [])[1] || "";
        const sq = (title + " " + ((b.match(/title="Area"[\s\S]{0,300}?<span>([^<]+)</) || [])[1] || "")).match(/([\d\s.,]+)\s*m²/);
        const img = (b.match(/itemprop="contentUrl" content="([^"]+)"/) || [])[1] || (b.match(/<img class="w-100p" src="([^"]+)"/) || [])[1] || "";
        out.push({ id: "rt-" + url.replace(/^.*\//, ""), source: "realting", url, category: "hotel", seller: "agency", currency: "USD", type: "Ξενοδοχείο", sqm: sq ? Math.round(num(sq[1].replace(/\s/g, ""))) : null,
          price, floor: "", beds: null, year: null, location: route.replace(/,\s*Greece$/, "").trim(), multi: false, posted: "", img: !!img, photo: img });
      }
      await page.waitForTimeout(800);
    }
  } finally { await browser.close().catch(() => {}); }
  return out;
}

// greekexclusiveproperties.com — WordPress archive /property-type/hotel-sales/page/N/ (article.property-item)
async function gep() {
  const base = "https://www.greekexclusiveproperties.com", out = []; let prev = "";
  const dec = (t) => t.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#8211;|&#8217;|&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  for (let p = 1; p <= 15; p++) {
    const html = await get(`${base}/property-type/hotel-sales/` + (p > 1 ? `page/${p}/` : ""));
    const blocks = html.split('<article class="property-item').slice(1).map((b) => b.split("</article>")[0]);
    if (!blocks.length) break;
    const first = (blocks[0].match(/href="([^"]+)"/) || [])[1] || ""; if (first === prev) break; prev = first;
    for (const b of blocks) {
      const url = (b.match(/<h4><a href="([^"]+)"/) || [])[1]; const title = dec((b.match(/<h4>([\s\S]*?)<\/h4>/) || [])[1] || "");
      const price = num((b.match(/<h5 class="price">\s*([\d.,]+)\s*€/) || [])[1] || ""); if (!url || !price) continue;
      const img = (b.match(/<img[^>]+src="([^"]+wp-content\/uploads[^"]+)"/) || [])[1] || "";
      const sz = (b.match(/Area Size[\s\S]{0,500}?>\s*([\d.,]+)\s*(?:m|sq|τ)/i) || [])[1];
      const loc = (title.match(/\b(?:in|At)\s+([A-Z][A-Za-z' ]+?)(?:\s*[,|–-]|$)/) || [])[1] || "";
      out.push({ id: "gep-" + url.replace(/\/$/, "").replace(/^.*\//, ""), source: "gep", url, category: "hotel", seller: "agency", type: "Ξενοδοχείο", sqm: sz ? Math.round(num(sz)) : null, price, floor: "", beds: null, year: null,
        location: loc.trim() || title.slice(0, 60), multi: false, posted: "", img: !!img, photo: img.replace(/-\d+x\d+(?=\.)/, "") });
    }
    await new Promise((r) => setTimeout(r, 700));
  }
  return out;
}

// Fills m², rooms, year and a clean location from each hotel's own page (once per hotel; 80 per run)
async function enrichHotels() {
  const { rows } = await pool.query("SELECT id, source, url FROM listings WHERE category='hotel' AND source IN ('ktimato','gep') AND details_checked IS NULL ORDER BY first_seen DESC LIMIT 80");
  let done = 0;
  for (const r of rows) {
    try {
      const html = await get(r.url); let sqm = null, beds = null, year = null, loc = "";
      if (r.source === "ktimato") {
        const j = ldBlocks(html).find((b) => b["@type"] === "RealEstateListing");
        sqm = Math.round(num(j?.floorSize?.value ?? j?.floorSize ?? "")) || null; beds = j?.numberOfBedrooms || null;
        loc = [j?.address?.addressLocality].filter(Boolean).join(", ");
      } else {
        const txt = html.replace(/<(script|style)[\s\S]*?<\/\1>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
        const meta = txt.match(/GREX\w+\s+(.{0,160})/)?.[1] || "";
        sqm = Math.round(num((meta.match(/([\d.,]+)\s*m2/i) || [])[1] || "")) || null; beds = +(meta.match(/(\d+)\s*Bedrooms/i) || [])[1] || null; year = +(meta.match(/(\d{4})\s*Year Built/i) || [])[1] || null;
        const cities = [...html.matchAll(/property-city\/[a-z0-9-]+\/?"[^>]*>([^<]+)</g)].map((m) => m[1].trim()).filter((c) => c && !/^greece$/i.test(c));
        loc = cities.length ? cities[cities.length - 1].toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase()) : "";
      }
      await pool.query("UPDATE listings SET sqm=COALESCE($2,sqm), beds=COALESCE($3,beds), year=COALESCE($4,year), location=CASE WHEN $5<>'' THEN $5 ELSE location END, details_checked=now() WHERE id=$1", [r.id, sqm, beds, year && year > 1800 && year < 2100 ? year : null, loc]);
      done++;
    } catch (e) { await pool.query("UPDATE listings SET details_checked=now() WHERE id=$1", [r.id]); }
    await new Promise((z) => setTimeout(z, 500));
  }
  return done;
}

// Sabbianco's own listings — the company's CMS feed (the same public feed the website uses)
const SB_API = "https://cms.sabbiancoproperties.com/api/public";
export async function sabbianco() {
  const out = [], galleries = {};
  const tok = process.env.SABBIANCO_TOKEN || "XIZSiqNDTh9xXfD7zZSIe89HCMXYgLI1oK4HKWbkX9DLtrMZnkxqDRjas2c5gVzF";   // public key shipped in the website's own JS
  let last = 1;
  for (let p = 1; p <= last && p <= 80; p++) {
    const r = await fetch(`${SB_API}/properties?country=greece&page=${p}`, { headers: { Authorization: "Bearer " + tok, Accept: "application/json", "User-Agent": UA }, signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(`sabbianco page ${p} → ${r.status}`);
    const j = await r.json(); last = j.meta?.last_page || 1;
    for (const x of j.data || []) {
      const at = {}; for (const g of Object.values(x.attributes || {})) for (const a of g) if (a.value !== undefined && a.format !== "boolean") at[a.key] = a.value;
      const key = x.property_type?.key || "";
      const category = key === "land" || key === "plot" ? "land" : "home";
      const el = (o) => o?.translates?.el?.name || o?.name || "";
      const area = el(x.area), town = el(x.address) || el(x.city);
      const imgs = [x.main_image?.url, ...(x.gallery || []).map((g) => g.url)].filter(Boolean);
      const price = Math.round(Number(x.discount_price || x.price)) || null;
      const sqm = Math.round(num(at["square-meters"] || at["plot-size"] || "") || 0) || null;
      const lvl = at["apartment-level"];
      out.push({ id: "sb-" + x.id, source: "sabbianco", url: "https://sabbiancoproperties.com/property/" + x.path, category, seller: "owner", currency: "EUR",
        type: el(x.property_type) || key, sqm: category === "land" ? Math.round(num(at["plot-size"] || at["square-meters"] || "") || 0) || null : sqm, price, floor: lvl !== undefined && lvl !== "" ? String(lvl) : "",
        beds: Number(at["bedrooms"]) || null, year: Number(at["year-built"]) || null, location: [town, area].filter(Boolean).join(", "), multi: false, posted: "", img: imgs.length ? true : false, photo: imgs[0] || "" });
      galleries["sb-" + x.id] = imgs;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  out.galleries = galleries;
  return out;
}

const SOURCES = [{ key: "ktimato", label: "Ktimatoemporiki", run: ktimato }, { key: "gep", label: "Greek Exclusive Properties", run: gep }, { key: "realting", label: "Realting", run: realting }, { key: "sabbianco", label: "Sabbianco", run: sabbianco }];

export async function runHotelSources(sites) {
  for (const s of SOURCES) {
    try {
      const raw = await s.run(); const ads = raw.filter((a) => a.price); ads.galleries = raw.galleries;
      const { created, merged } = await mergeAds(ads);
      if (ads.galleries) for (const [id, urls] of Object.entries(ads.galleries)) if (urls.length > 1) await pool.query("UPDATE listings SET gallery=$2::jsonb, gallery_at=now() WHERE id=$1", [id, JSON.stringify(urls)]);
      let removed = 0;
      const { rows } = await pool.query("SELECT id FROM listings WHERE source=$1 AND gone_at IS NULL", [s.key]);
      if (ads.length >= 50 && ads.length >= rows.length * 0.7) {   // complete list read: ads that are no longer on the site are removed
        const keep = new Set(ads.map((a) => a.id)), dead = rows.filter((r) => !keep.has(r.id)).map((r) => r.id);
        if (dead.length) { await pool.query("DELETE FROM listings WHERE id = ANY($1)", [dead]); removed = dead.length; }
      }
      try { await enrichHotels(); } catch (e) { console.error("hotel enrich", e.message); }
      sites[s.key] = { status: "ok", at: new Date().toISOString(), scraped: ads.length, created, merged, removed };
      console.log(`[${s.label}] hotels: scraped ${ads.length}, new ${created}, removed ${removed}`);
    } catch (e) { console.error(`[${s.label}] ${e.message}`); sites[s.key] = { status: "error", message: String(e.message).slice(0, 200), at: new Date().toISOString() }; }
    await kvSet("sites", sites);
  }
}
