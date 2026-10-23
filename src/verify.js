// Daily "is this ad still on the market?" check for homes already in the list.
// Polite by design: at most LIMIT ads per site per day, each ad re-checked at most every 2 days, random pauses between requests.
import { pool } from "./db.js";

const HOST = { spiti24: "www.spiti24.gr", xe: "www.xe.gr", spitogatos: "www.spitogatos.gr" };
const LIMIT = { spiti24: 200, spitogatos: 200, xe: 150 };
const PHOTO = { spiti24: /spitogatos\.gr\/\d{5,}_/, spitogatos: /spitogatos\.gr\/\d{5,}_/, xe: /blob\.cdn\.xe\.gr/ };   // what a real ad photo URL looks like (og:image)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function verifySite(page, key, { mode } = {}) {
  const photos = mode === "photos";   // backfill: every listed ad that has no photo link yet, all statuses, no daily cap
  const { rows } = photos
    ? await pool.query(
        `SELECT id, url, (also_on IS NULL OR also_on='[]'::jsonb) AS solo FROM listings
          WHERE source=$1 AND gone_at IS NULL AND img IS NOT FALSE AND photo IS NULL ORDER BY first_seen DESC LIMIT 2000`, [key])
    : await pool.query(
    `SELECT id, url, true AS solo FROM listings
      WHERE source=$1 AND gone_at IS NULL AND status IN ('new','contacted')
        AND (also_on IS NULL OR also_on='[]'::jsonb)
        AND first_seen < now() - interval '1 day'
        AND (checked_at IS NULL OR checked_at < now() - interval '2 days' OR img IS NULL)
      ORDER BY (img IS NULL) DESC, checked_at NULLS FIRST, first_seen LIMIT $2`, [key, LIMIT[key] || 100]);
  if (!rows.length) return { checked: 0, gone: 0 };
  if (new URL(page.url()).host !== HOST[key]) await page.goto("https://" + HOST[key] + "/", { waitUntil: "domcontentloaded", timeout: 30000 });

  const alive = [], gone = [], withPhoto = [], noPhoto = [], photoUrl = {};
  let unknownRun = 0, unknown = 0;
  const flush = async () => {   // save progress as we go, so the list fills in while the check is still running
    if (alive.length) await pool.query("UPDATE listings SET checked_at=now() WHERE id = ANY($1)", [alive]);
    if (withPhoto.length) await pool.query("UPDATE listings SET img=true WHERE id = ANY($1)", [withPhoto]);
    for (const [id, url] of Object.entries(photoUrl)) await pool.query("UPDATE listings SET photo=$2 WHERE id=$1 AND photo IS NULL", [id, url]);
    if (noPhoto.length) await pool.query("UPDATE listings SET img=false WHERE id = ANY($1)", [noPhoto]);   // hidden; shows again if a list later shows a photo
    alive.length = 0; withPhoto.length = 0; noPhoto.length = 0; for (const k of Object.keys(photoUrl)) delete photoUrl[k];
  };
  let total = 0, totalNoPhoto = 0;
  for (const r of rows) {
    let v;
    if (key === "xe") {   // xe.gr is a JS app: open the ad like a visitor and see whether it bounces to the generic search page
      try {
        const resp = await page.goto(r.url, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForTimeout(2500);
        const og = await page.locator('meta[property="og:image"]').first().getAttribute("content", { timeout: 2000 }).catch(() => null);
        const ogTitle = await page.locator('meta[property="og:title"]').count().catch(() => 0);
        v = { status: resp ? resp.status() : 0, final: page.url(), title: await page.title(), og: og || "", page: ogTitle > 0 };
      } catch (e) { v = { err: String(e).slice(0, 100) }; }
    } else {
      v = await page.evaluate(async (url) => {
        try {
          const res = await fetch(url, { credentials: "include", redirect: "follow" });
          const html = res.status === 200 ? await res.text() : "";
          const tag = (html.match(/<meta[^>]*og:image[^>]*>/) || [""])[0];
          return { status: res.status, final: res.url, title: (html.match(/<title>([^<]*)/) || [])[1] || "", og: (tag.match(/content=["']([^"']*)/) || [])[1] || "", page: html.length > 5000 };
        } catch (e) { return { err: String(e).slice(0, 100) }; }
      }, r.url);
    }
    let verdict = "unknown";
    if (!v.err) {
      if (v.status === 404 || v.status === 410) verdict = "gone";
      else if (v.status === 200 && /\/property\/r\//.test(v.final) && !/\/property\/r\//.test(r.url)) verdict = "gone";   // xe.gr sends removed ads to the generic search page
      else if (v.status === 200 && /δεν είναι διαθέσιμη|Η Σελίδα Δεν Βρέθηκε/.test(v.title)) verdict = "gone";
      else if (v.status === 200) verdict = "alive";
    }
    if (verdict === "unknown") { unknown++; if (++unknownRun >= 5) break; } else unknownRun = 0;
    if (verdict === "gone" && !r.solo) verdict = "unknown";   // it may still be live on the other site
    if (verdict === "gone") gone.push(r.id);
    else if (verdict === "alive") {
      alive.push(r.id);
      if (v.page) (PHOTO[key].test(v.og || "") ? withPhoto : noPhoto).push(r.id);
      if (PHOTO[key].test(v.og || "")) photoUrl[r.id] = v.og.replace(/^http:/, "https:");   // only judged when the ad page really loaded
    }
    if (alive.length >= 15) { total += alive.length; totalNoPhoto += noPhoto.length; await flush(); }
    await sleep(1200 + Math.random() * 1400);
  }
  total += alive.length; totalNoPhoto += noPhoto.length;
  const checked = total + gone.length;
  // Safety net: if most of a batch looks "gone", the site is probably blocking us, so remove nothing.
  if (checked >= 20 && gone.length / checked > 0.6) {
    await flush();
    console.error(`[verify ${key}] ${gone.length}/${checked} look gone, ignoring batch`);
    return { checked, gone: 0, suspicious: true };
  }
  await flush();
  if (gone.length) await pool.query("DELETE FROM listings WHERE id = ANY($1)", [gone]);   // off the market: remove it from the list
  console.log(`[verify ${key}] checked ${checked}, gone ${gone.length}, no photo ${totalNoPhoto}, unclear ${unknown}`);
  return { checked, gone: gone.length, noPhoto: totalNoPhoto, unclear: unknown };
}
