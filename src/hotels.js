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

// ---- details from each hotel's own page (place, size, rooms, dates, address, features) ----
const isoDate = (s) => { const m = String(s || "").match(/(\d{4})-(\d\d)-(\d\d)/); return m ? `${m[3]}/${m[2]}/${m[1]}` : ""; };
const titleCase = (s) => String(s || "").replace(/\bisland\b/i, "").trim().toLowerCase().replace(/(^|[\s-])\S/g, (c) => c.toUpperCase());
const lines = (html) => html.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/g, " ").replace(/<\/(li|div|p|h\d|tr|td|th|section)>|<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ")
  .replace(/&amp;/g, "&").replace(/&nbsp;|&#8211;|&#8217;/g, " ").split("\n").map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
const between = (L, from, to) => { const i = L.findIndex((l) => from.test(l)); if (i < 0) return []; const out = []; for (let k = i + 1; k < L.length && k < i + 60; k++) { if (to.test(L[k])) break; out.push(L[k]); } return out; };
const numOf = (s) => num(String(s || "").replace(/[^\d.,]/g, ""));
const apMap = (j) => Object.fromEntries((j?.additionalProperty || []).map((p) => [String(p.name).toLowerCase(), String(p.value)]));
const empty = () => ({ published: "", updated: "", desc: "", address: "", facts: [], extras: [] });
const fact = (d, k, v) => { if (v !== null && v !== undefined && String(v).trim() !== "") d.facts.push([k, String(v).trim() + (/^Εμβαδόν/.test(k) ? " τ.μ." : "")]); };

export function gepDetails(html) {
  const lds = ldBlocks(html), j = lds.find((b) => b["@type"] === "RealEstateListing");
  if (!j) return null;
  const wp = (lds.find((b) => Array.isArray(b["@graph"]))?.["@graph"] || []).find((g) => [].concat(g["@type"]).includes("WebPage"));
  const ap = apMap(j), d = empty();
  const street = String(j.address?.streetAddress || "").replace(/,\s*Greece$/i, "").trim(), place = titleCase(j.address?.addressLocality);
  d.address = [street, place && !street.toLowerCase().includes(place.toLowerCase()) ? place : ""].filter(Boolean).join(", ");
  d.published = isoDate(j.datePosted); d.updated = isoDate(wp?.dateModified);
  fact(d, "Υπνοδωμάτια", ap["bedrooms"]); fact(d, "Μπάνια", ap["bathrooms"]); fact(d, "Εμβαδόν", ap["area size"] && Math.round(numOf(ap["area size"]))); fact(d, "Εμβαδόν οικοπέδου", ap["plot size"] && Math.round(numOf(ap["plot size"])));
  fact(d, "Έτος κατασκευής", ap["year built"]);
  const ref = lines(html).find((l) => /^[A-Z]{3,}[A-Z0-9]*\d{2,}$/.test(l)); fact(d, "Κωδικός αγγελίας", ref);
  d.extras = between(lines(html), /^FEATURES$/i, /^SHARE THIS$/i).filter((l) => l.length < 40).slice(0, 30);
  return { details: d, sqm: Math.round(numOf(ap["area size"])) || null, beds: +ap["bedrooms"] || null, year: +ap["year built"] || null, loc: place };
}

export function ktimatoDetails(html) {
  const lds = ldBlocks(html), j = lds.find((b) => b["@type"] === "RealEstateListing") || lds.find((b) => [].concat(b["@type"]).includes("RealEstateListing"));
  if (!j) return null;
  const bc = (lds.find((b) => [].concat(b["@type"]).includes("BreadcrumbList"))?.itemListElement || []).map((x) => x.name || x.item?.name).filter(Boolean).filter((n) => !/^home$/i.test(n)).slice(0, -1);
  const L = lines(html), ap = apMap(j), d = empty(), at = (re) => { const i = L.findIndex((l) => re.test(l)); return i >= 0 ? L[i + 1] : ""; };
  d.address = bc.slice().reverse().join(", ") || [j.address?.addressLocality, j.address?.addressRegion].filter(Boolean).join(", ");
  d.published = isoDate(j.datePosted);
  const sqm = Math.round(numOf(ap["area size"] || j.floorSize?.value)) || null;
  fact(d, "Εμβαδόν", sqm); fact(d, "Εμβαδόν οικοπέδου", ap["plot size"] && Math.round(numOf(ap["plot size"])));
  fact(d, "Νομός", at(/^Prefecture$/i) || j.address?.addressRegion); fact(d, "Δήμος", at(/^Municipality$/i)); fact(d, "Κωδικός αγγελίας", at(/^Ref\.? No\.?$/i));
  d.extras = between(L, /^Features$/i, /^Location$/i).filter((l) => l.length < 40).slice(0, 30);
  return { details: d, sqm, beds: +j.numberOfBedrooms || null, year: null, loc: j.address?.addressLocality || "" };
}

export function realtingDetails(text, title) {
  const L = text.split("\n").map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean), d = empty();
  const at = (re) => { const i = L.findIndex((l) => re.test(l)); return i >= 0 ? L[i + 1] || "" : ""; };
  const upd = (text.match(/Last update:\s*(\d\d\/\d\d\/\d{4})/) || [])[1]; d.updated = upd || "";
  const town = at(/^Town$/), city = at(/^City$/), addr = at(/^Address$/);   // the "Address" label also appears in the price block; the value after "Town" is what we want
  const loc = L.findIndex((l) => /^Location$/.test(l)), blk = loc >= 0 ? L.slice(loc, loc + 20) : [];
  const g = (k) => { const i = blk.findIndex((l) => l === k); return i >= 0 ? blk[i + 1] || "" : ""; };
  d.address = [g("Address"), g("Town") || town, g("City") || city].filter((x, i, a) => x && a.indexOf(x) === i).join(", ");
  const area = (L[L.findIndex((l) => /^Total area$/.test(l)) + 1] || "").match(/([\d\s.,]+)\s*m²/);
  const sqm = area ? Math.round(num(area[1].replace(/\s/g, ""))) : null, beds = +(String(title).match(/(\d+)\s*bedrooms?/i) || [])[1] || null;
  fact(d, "Εμβαδόν", sqm); fact(d, "Υπνοδωμάτια", beds); fact(d, "Περιοχή", g("Region")); fact(d, "Δήμος", g("City"));
  fact(d, "Κωδικός αγγελίας", (text.match(/ID:\s*\n?\s*(\d{5,})/) || [])[1]);
  return d.address || d.facts.length ? { details: d, sqm, beds, year: null, loc: g("Town") || town || "" } : null;
}

async function saveHotel(id, r) {
  await pool.query("UPDATE listings SET details=$2, sqm=COALESCE($3,sqm), beds=COALESCE($4,beds), year=COALESCE($5,year), location=CASE WHEN $6<>'' THEN $6 ELSE location END, details_checked=now() WHERE id=$1",
    [id, JSON.stringify(r.details), r.sqm, r.beds, r.year && r.year > 1800 && r.year < 2100 ? r.year : null, r.loc || ""]);
}
const hotelQueue = (sources, limit) => pool.query(`SELECT id, source, url FROM listings WHERE category='hotel' AND gone_at IS NULL AND source = ANY($1)
  AND (details_checked IS NULL OR (details IS NULL AND details_checked < now() - interval '1 day')) ORDER BY details_checked NULLS FIRST, first_seen DESC LIMIT $2`, [sources, limit]);

// Reads each hotel's own page once. A page that cannot be read is tried again the next day.
export async function enrichHotels() {
  let done = 0, failed = 0;
  for (const r of (await hotelQueue(["ktimato", "gep"], 400)).rows) {
    try {
      const html = await get(r.url), res = r.source === "ktimato" ? ktimatoDetails(html) : gepDetails(html);
      if (!res) throw new Error("no details found");
      await saveHotel(r.id, res); done++;
    } catch (e) { failed++; await pool.query("UPDATE listings SET details_checked=now() WHERE id=$1", [r.id]); }
    await new Promise((z) => setTimeout(z, 300));
  }
  const rt = (await hotelQueue(["realting"], 120)).rows;
  if (rt.length) {   // realting blocks plain requests, so a real browser reads these
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"] });
    try {
      const page = await (await browser.newContext({ userAgent: UA, locale: "en-US", viewport: { width: 1366, height: 900 } })).newPage();
      for (const r of rt) {
        try {
          const resp = await page.goto(r.url, { waitUntil: "domcontentloaded", timeout: 45000 }); await page.waitForTimeout(1200);
          if (!resp || resp.status() !== 200) throw new Error("status " + (resp && resp.status()));
          const res = realtingDetails(await page.locator("body").innerText({ timeout: 8000 }), await page.title());
          if (!res) throw new Error("no details found");
          await saveHotel(r.id, res); done++;
        } catch (e) { failed++; await pool.query("UPDATE listings SET details_checked=now() WHERE id=$1", [r.id]); }
        await new Promise((z) => setTimeout(z, 700));
      }
    } finally { await browser.close().catch(() => {}); }
  }
  console.log(`hotel details: read ${done}, failed ${failed}`);
  return done;
}

const SOURCES = [{ key: "ktimato", label: "Ktimatoemporiki", run: ktimato }, { key: "gep", label: "Greek Exclusive Properties", run: gep }, { key: "realting", label: "Realting", run: realting }];

export async function runHotelSources(sites) {
  for (const s of SOURCES) {
    try {
      const ads = (await s.run()).filter((a) => a.price);
      const { created, merged } = await mergeAds(ads);
      for (const a of ads) await pool.query("UPDATE listings SET prev_price=CASE WHEN price IS DISTINCT FROM $2 THEN price ELSE prev_price END, price=$2 WHERE id=$1 AND price IS DISTINCT FROM $2", [a.id, a.price]).catch(() => {});
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
