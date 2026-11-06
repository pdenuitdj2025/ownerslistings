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

const SOURCES = [{ key: "ktimato", label: "Ktimatoemporiki", run: ktimato }, { key: "gep", label: "Greek Exclusive Properties", run: gep }];

export async function runHotelSources(sites) {
  for (const s of SOURCES) {
    try {
      const ads = (await s.run()).filter((a) => a.price);
      const { created, merged } = await mergeAds(ads);
      let removed = 0;
      const { rows } = await pool.query("SELECT id FROM listings WHERE source=$1 AND gone_at IS NULL", [s.key]);
      if (ads.length >= 50 && ads.length >= rows.length * 0.7) {   // complete list read: ads that are no longer on the site are removed
        const keep = new Set(ads.map((a) => a.id)), dead = rows.filter((r) => !keep.has(r.id)).map((r) => r.id);
        if (dead.length) { await pool.query("DELETE FROM listings WHERE id = ANY($1)", [dead]); removed = dead.length; }
      }
      sites[s.key] = { status: "ok", at: new Date().toISOString(), scraped: ads.length, created, merged, removed };
      console.log(`[${s.label}] hotels: scraped ${ads.length}, new ${created}, removed ${removed}`);
    } catch (e) { console.error(`[${s.label}] ${e.message}`); sites[s.key] = { status: "error", message: String(e.message).slice(0, 200), at: new Date().toISOString() }; }
    await kvSet("sites", sites);
  }
}
