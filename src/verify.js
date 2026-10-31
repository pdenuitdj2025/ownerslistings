// Daily "is this ad still on the market?" check for homes already in the list.
// Polite by design: at most LIMIT ads per site per day, each ad re-checked at most every 20 hours, random pauses between requests.
import { pool } from "./db.js";

const HOST = { spiti24: "www.spiti24.gr", xe: "www.xe.gr", spitogatos: "www.spitogatos.gr" };
const LIMIT = { spiti24: 200, spitogatos: 200, xe: 150 };
const PHOTO = { spiti24: /spitogatos\.gr\/\d{5,}_/, spitogatos: /spitogatos\.gr\/\d{5,}_/, xe: /blob\.cdn\.xe\.gr/ };   // what a real ad photo URL looks like (og:image)
// Current asking price as shown on the ad page (visible text). Only trusted if it is in a sane range around the stored price.
function priceOf(key, text, stored) {
  const t = String(text || "").replace(/\s+/g, " ");
  const m = key === "xe" ? t.match(/(\d{1,3}(?:\.\d{3})+) ?€/) : t.match(/€\s?(\d{1,3}(?:\.\d{3})+)/);
  const p = m ? Number(m[1].replace(/\./g, "")) : null;
  return p && stored && p >= stored * 0.4 && p <= stored * 2.5 ? p : null;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function verifySite(page, key, { mode, since } = {}) {
  const scan = mode === "scan";   // full re-check of every listing (all statuses), resumable: skips rows already checked since the scan started
  const photos = mode === "photos";   // backfill: every listed ad that has no photo link yet, all statuses, no daily cap
  const { rows } = scan
    ? await pool.query(
        `SELECT id, url, price, (also_on IS NULL OR also_on='[]'::jsonb) AS solo FROM listings
          WHERE source=$1 AND gone_at IS NULL AND (checked_at IS NULL OR checked_at < $2) ORDER BY first_seen DESC LIMIT 3000`, [key, since])
    : photos
    ? await pool.query(
        `SELECT id, url, price, (also_on IS NULL OR also_on='[]'::jsonb) AS solo FROM listings
          WHERE source=$1 AND gone_at IS NULL AND img IS NOT FALSE AND photo IS NULL ORDER BY first_seen DESC LIMIT 2000`, [key])
    : await pool.query(
    `SELECT id, url, price, true AS solo FROM listings
      WHERE source=$1 AND gone_at IS NULL AND status IN ('new','contacted')
        AND (also_on IS NULL OR also_on='[]'::jsonb)
        AND first_seen < now() - interval '1 day'
        AND (checked_at IS NULL OR checked_at < now() - interval '20 hours' OR img IS NULL)
      ORDER BY (img IS NULL) DESC, checked_at NULLS FIRST, first_seen LIMIT $2`, [key, LIMIT[key] || 100]);
  if (!rows.length) return { checked: 0, gone: 0 };
  if (new URL(page.url()).host !== HOST[key]) await page.goto("https://" + HOST[key] + "/", { waitUntil: "domcontentloaded", timeout: 30000 });

  const priceUpd = {};   // id -> [old, new]: the ad page shows a different price than we stored
  const promote = [];   // gone here but the same home is still listed on another site: make that listing the main one
  const alive = [], gone = [], withPhoto = [], noPhoto = [], photoUrl = {};
  let unknownRun = 0, unknown = 0;
  const SITEKEY = { "xe.gr": "xe", "Spitogatos": "spitogatos", "Spiti24": "spiti24" };
  const doPromote = async () => {
    while (promote.length) {
      const id = promote.pop();
      const { rows: [row] } = await pool.query("SELECT also_on FROM listings WHERE id=$1", [id]);
      const also = (row?.also_on || []);
      const pick = also.find((a) => SITEKEY[a.site] && SITEKEY[a.site] !== key) || also[0];
      if (!pick) { await pool.query("DELETE FROM listings WHERE id=$1", [id]); continue; }
      const rest = also.filter((a) => a !== pick && a.url !== pick.url);
      await pool.query("UPDATE listings SET source=$2, url=$3, also_on=$4, photo=NULL, img=NULL, checked_at=NULL WHERE id=$1", [id, SITEKEY[pick.site] || key, pick.url, JSON.stringify(rest)]);
    }
  };
  const flush = async () => {
    if (promote.length < 25) await doPromote();   // save progress as we go, so the list fills in while the check is still running
    for (const [id, [oldP, newP]] of Object.entries(priceUpd)) { await pool.query("UPDATE listings SET price=$2::int, prev_price=CASE WHEN $2::int < $3::int * 0.99 THEN $3::int ELSE prev_price END, status=CASE WHEN status='skip' AND $2::int < $3::int * 0.99 THEN 'new' ELSE status END WHERE id=$1", [id, newP, oldP]); priceChanged++; delete priceUpd[id]; }
    if (alive.length) await pool.query("UPDATE listings SET checked_at=now() WHERE id = ANY($1)", [alive]);
    if (withPhoto.length) await pool.query("UPDATE listings SET img=true WHERE id = ANY($1)", [withPhoto]);
    for (const [id, url] of Object.entries(photoUrl)) await pool.query("UPDATE listings SET photo=$2 WHERE id=$1 AND photo IS NULL", [id, url]);
    if (noPhoto.length) await pool.query("DELETE FROM listings WHERE id = ANY($1)", [noPhoto]);   // no photo: removed
    if (scan && gone.length && gone.length < 25) { await pool.query("DELETE FROM listings WHERE id = ANY($1)", [gone]); goneDeleted += gone.length; gone.length = 0; }   // scan: drop dead ads as they are found (a big sudden batch is held back by the safety net)
    alive.length = 0; withPhoto.length = 0; noPhoto.length = 0; for (const k of Object.keys(photoUrl)) delete photoUrl[k];
  };
  let total = 0, totalNoPhoto = 0, goneDeleted = 0, priceChanged = 0;
  for (const r of rows) {
    let v;
    if (key === "xe") {   // xe.gr is a JS app: open the ad like a visitor and see whether it bounces to the generic search page
      try {
        const resp = await page.goto(r.url, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForTimeout(2500);
        const og = await page.locator('meta[property="og:image"]').first().getAttribute("content", { timeout: 2000 }).catch(() => null);
        const ogTitle = await page.locator('meta[property="og:title"]').count().catch(() => 0);
        const bodyTxt = await page.locator("body").innerText({ timeout: 3000 }).catch(() => "");
        v = { text: bodyTxt.slice(0, 4000), dead: /δεν είναι πλέον (διαθέσιμη|δημοσιευμένη)|έχει αφαιρεθεί|Η αγγελία δεν υπάρχει/.test(bodyTxt.slice(0, 1500)), status: resp ? resp.status() : 0, final: page.url(), title: await page.title(), og: og || "", page: ogTitle > 0 };
      } catch (e) { v = { err: String(e).slice(0, 100) }; }
    } else {
      v = await page.evaluate(async (url) => {
        try {
          const res = await fetch(url, { credentials: "include", redirect: "follow" });
          const html = res.status === 200 ? await res.text() : "";
          const tag = (html.match(/<meta[^>]*og:image[^>]*>/) || [""])[0];
          return { text: html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").slice(0, 60000), dead: /δεν είναι πλέον δημοσιευμένο/.test(html), status: res.status, final: res.url, title: (html.match(/<title>([^<]*)/) || [])[1] || "", og: (tag.match(/content=["']([^"']*)/) || [])[1] || "", page: html.length > 5000 };
        } catch (e) { return { err: String(e).slice(0, 100) }; }
      }, r.url);
    }
    let verdict = "unknown";
    if (!v.err) {
      if (v.status === 404 || v.status === 410) verdict = "gone";
      else if (v.status === 200 && /\/property\/r\//.test(v.final) && !/\/property\/r\//.test(r.url)) verdict = "gone";   // xe.gr sends removed ads to the generic search page
      else if (v.status === 200 && (v.dead || /δεν είναι διαθέσιμη|Η Σελίδα Δεν Βρέθηκε/.test(v.title))) verdict = "gone";
      else if (v.status === 200) verdict = "alive";
    }
    if (verdict === "unknown") { unknown++; if (++unknownRun >= 5) break; } else unknownRun = 0;
    if (verdict === "gone" && !r.solo) { promote.push(r.id); verdict = "promoted"; }   // it may still be live on the other site
    if (verdict === "gone") gone.push(r.id);
    else if (verdict === "alive") {
      alive.push(r.id);
      if (v.page) { const np = priceOf(key, v.text, r.price); if (np && np !== r.price) priceUpd[r.id] = [r.price, np]; }
      if (v.page) (PHOTO[key].test(v.og || "") ? withPhoto : noPhoto).push(r.id);
      if (PHOTO[key].test(v.og || "")) photoUrl[r.id] = v.og.replace(/^http:/, "https:");   // only judged when the ad page really loaded
    }
    if (alive.length >= 15) { total += alive.length; totalNoPhoto += noPhoto.length; await flush(); }
    await sleep(1200 + Math.random() * 1400);
  }
  total += alive.length; totalNoPhoto += noPhoto.length;
  const checked = total + gone.length + goneDeleted + promote.length;
  // Safety net: if most of a batch looks "gone", the site is probably blocking us, so remove nothing.
  if (checked >= 20 && (gone.length + promote.length) / checked > 0.6) {
    promote.length = 0;
    await flush();
    console.error(`[verify ${key}] ${gone.length}/${checked} look gone, ignoring batch`);
    return { checked, gone: 0, suspicious: true };
  }
  await flush();
  await doPromote();
  if (gone.length) await pool.query("DELETE FROM listings WHERE id = ANY($1)", [gone]);   // off the market: remove it from the list
  const goneAll = gone.length + goneDeleted;
  console.log(`[verify ${key}] checked ${checked}, gone ${goneAll}, no photo ${totalNoPhoto}, unclear ${unknown}`);
  return { checked, gone: goneAll, noPhoto: totalNoPhoto, unclear: unknown, priceChanged };
}
