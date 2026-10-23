// Adds scraped ads to the database without creating a second row for a home that is already listed
// (same sqm exactly, price within 1 %, and the location agrees).
import { pool } from "./db.js";

const SITE_LABEL = { xe: "xe.gr", spitogatos: "Spitogatos", indomio: "Indomio", spiti24: "Spiti24", plot: "Plot" };
const GENERIC = new Set(["αθηνα", "πειραιας"]);
const norm = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/ς/g, "σ");
const muni = (loc) => norm((loc || "").split("(")[0]).trim();
const words = (loc) => new Set(norm(loc).split(/[^a-zα-ω0-9]+/).filter((w) => w.length >= 4 && !GENERIC.has(w) && !GENERIC.has(w.replace(/σ$/, "ς"))));

function locAgree(a, b) {
  const ma = muni(a), mb = muni(b);
  const g = (m) => GENERIC.has(m.replace(/σ$/, "ς")) || GENERIC.has(m);
  if (ma && ma === mb && !g(ma)) return true;
  const wa = words(a);
  for (const w of words(b)) if (wa.has(w)) return true;
  return false;
}
const sameHome = (x, y) =>
  x.sqm && y.sqm && x.sqm === y.sqm && x.price && y.price &&
  Math.abs(x.price - y.price) <= 0.01 * Math.max(x.price, y.price) && locAgree(x.location, y.location);

export async function mergeAds(ads) {
  const { rows } = await pool.query("SELECT * FROM listings");
  const existing = rows.map((r) => ({ ...r, firstSeen: r.first_seen, alsoOn: r.also_on || [] }));
  const ids = new Set(existing.map((r) => r.id));
  const urls = new Set(existing.flatMap((r) => [r.url, ...r.alsoOn.map((a) => a.url)]));
  let created = 0, merged = 0, dropped = 0;
  const createdList = [];
  for (const ad of ads) { try {
    if (!ad.sqm || !ad.price || ad.price < 10000 || ad.price > 200_000_000 || ad.sqm > 100000) continue;   // typos / mis-parsed cards
    if (ad.beds > 100) ad.beds = null; if (ad.year && (ad.year < 1800 || ad.year > 2100)) ad.year = null;
    if (ad.img === false) {   // no photo: the team doesn't want these. If it was already listed, hide it.
      await pool.query("UPDATE listings SET img=false WHERE id=$1", [ad.id]);
      continue;
    }
    if (ids.has(ad.id)) {   // already listed: only react to a price drop (>1 %), and put a skipped home back in the review list
      const e = existing.find((x) => x.id === ad.id);
      if (e && ad.img === true && e.img !== true) await pool.query("UPDATE listings SET img=true WHERE id=$1", [e.id]);
      if (e && e.gone_at) { await pool.query("UPDATE listings SET gone_at=NULL, checked_at=now() WHERE id=$1", [e.id]); e.gone_at = null; }   // it is back on the market
      if (e && e.price && ad.price < e.price * 0.99) {
        await pool.query(`UPDATE listings SET prev_price=$2, price=$3, status=CASE WHEN status='skip' THEN 'new' ELSE status END WHERE id=$1`, [e.id, e.price, ad.price]);
        e.price = ad.price; dropped++;
      }
      continue;
    }
    if (urls.has(ad.url)) continue;
    const twin = existing.find((e) => sameHome(e, ad));
    if (twin) {
      const also = [...twin.alsoOn, { site: SITE_LABEL[ad.source], url: ad.url }];
      await pool.query(
        `UPDATE listings SET also_on=$2,
           beds=COALESCE(beds,$3), floor=CASE WHEN floor IS NULL OR floor='' THEN $4 ELSE floor END, year=COALESCE(year,$5)
         WHERE id=$1`,
        [twin.id, JSON.stringify(also), ad.beds || null, ad.floor || "", ad.year || null]
      );
      twin.alsoOn = also; urls.add(ad.url); merged++;
      continue;
    }
    await pool.query(
      `INSERT INTO listings(id,source,url,type,sqm,price,floor,beds,year,location,multi,posted,img)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT DO NOTHING`,
      [ad.id, ad.source, ad.url, ad.type, ad.sqm, ad.price, ad.floor || "", ad.beds || null, ad.year || null, ad.location || "", !!ad.multi, ad.posted || "", ad.img === true ? true : null]
    );
    existing.push({ ...ad, alsoOn: [] }); ids.add(ad.id); urls.add(ad.url); created++;
    createdList.push(ad);
  } catch (e) { console.error("skipped ad", ad?.id, String(e.message).slice(0, 120)); } }
  return { created, merged, dropped, createdList };
}
