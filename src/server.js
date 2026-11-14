import express from "express";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { makeZip } from "./zip.js";
import { collectGalleries } from "./gallery.js";
import { init, fixXe1, fixPrice1, fixPrice2, fixHotel1, pool, kvGet, kvSet, toApi } from "./db.js";
import { mergeAds } from "./merge.js";
import { runAll, runSweep, isRunning, debugPage } from "./runner.js";
import { initSaas, mountSaas } from "./saas.js";

const RUN_HOURS = (process.env.RUN_HOURS_ATHENS || "10,16,22").split(",").map(Number).filter((n) => n >= 0 && n < 24).sort((a, b) => a - b);   // scrape three times a day, Athens time

const app = express();
app.use(express.json({ limit: "10mb" }));
app.get("/healthz", (_q, r) => r.send("ok"));

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
mountSaas(app, { appFile: path.join(PUBLIC, "index.html"), publicDir: PUBLIC });   // public pages, accounts, billing; everything under /api needs a paid office or the house team

app.get("/api/listings", async (req, res) => {
  const seller = ["owner", "agency"].includes(req.query.seller) ? req.query.seller : null, cat = ["home", "land", "hotel"].includes(req.query.category) ? req.query.category : null;
  // each office sees its own statuses and notes
  const { rows } = await pool.query("SELECT l.*, COALESCE(m.status, 'new') AS status, COALESCE(m.note, '') AS note FROM listings l LEFT JOIN org_marks m ON m.listing_id = l.id AND m.org_id = $3 WHERE l.img IS NOT FALSE AND NOT EXISTS (SELECT 1 FROM blocked b WHERE b.key = l.url OR b.key = l.phone) AND ($1::text IS NULL OR l.seller=$1) AND ($2::text IS NULL OR l.category=$2) ORDER BY l.first_seen DESC LIMIT 8000", [seller, cat, req.who.orgId]);
  res.json(rows.map(toApi).map((x) => (req.who.admin ? x : { ...x, phone: undefined })));   // subscribers get the link to the original ad, never a phone number
});
app.get("/api/counts", async (_q, res) => {
  const { rows } = await pool.query("SELECT seller, category, count(*)::int AS n FROM listings WHERE img IS NOT FALSE AND gone_at IS NULL GROUP BY 1,2");
  res.json(Object.fromEntries(rows.map((r) => [r.seller + "/" + r.category, r.n])));
});
app.patch("/api/listings/:id", async (req, res) => {
  const { status, note } = req.body || {};
  if (status !== undefined && !["new", "contacted", "skip"].includes(status)) return res.status(400).end();
  if (!(await pool.query("SELECT 1 FROM listings WHERE id=$1", [req.params.id])).rowCount) return res.status(404).json({ ok: false });
  const r = await pool.query(
    "INSERT INTO org_marks(org_id, listing_id, status, note) VALUES ($1,$2,COALESCE($3,'new'),COALESCE($4,'')) ON CONFLICT (org_id, listing_id) DO UPDATE SET status=COALESCE($3, org_marks.status), note=COALESCE($4, org_marks.note)",
    [req.who.orgId, req.params.id, status ?? null, note === undefined ? null : String(note).slice(0, 2000)]);
  res.status(r.rowCount ? 200 : 404).json({ ok: !!r.rowCount });
});
app.get("/api/meta", async (req, res) => { const run = (await kvGet("run")) || {}; res.json(req.who.admin ? { run, sites: (await kvGet("sites")) || {}, sweep: await kvGet("sweep"), running: isRunning() } : { run: { lastCheck: run.lastCheck, lastNew: run.lastNew } }); });
app.get("/api/hidden", async (_q, res) => { const { rows } = await pool.query("SELECT id, source, url, price, sqm, location, checked_at FROM listings WHERE img = false ORDER BY checked_at DESC LIMIT 400"); res.json(rows); });
app.post("/api/scan", async (_q, res) => { await kvSet("scanStartedAt", new Date().toISOString()); await kvSet("scanPending", true); res.json({ queued: true }); });
app.post("/api/phones", (_q, res) => { const started = !isRunning(); if (started) runAll({ phones: true }).catch((e) => console.error(e)); res.json({ started }); });
app.post("/api/enrich", (_q, res) => { const started = !isRunning(); if (started) runAll({ enrich: true }).catch((e) => console.error(e)); res.json({ started }); });
app.post("/api/sweep", (_q, res) => { const started = !isRunning(); if (started) runSweep().catch((e) => console.error(e)); res.json({ started }); });
app.post("/api/run", async (_q, res) => {
  const started = !isRunning();
  if (started) { await kvSet("lastScheduledSlot", dueSlot()).catch(() => {}); runAll().catch((e) => console.error(e)); }   // a manual run counts as the current slot
  res.json({ started });
});

// ZIP for presentations: listing text/CSV + the owners' photos in the best size the sites offer
const PHOTO_OK = /^https:\/\/([a-z0-9-]+\.)*(spitogatos\.gr|xe\.gr|b-cdn\.net|greekexclusiveproperties\.com|realting\.com)\//i;
const bigPhoto = (u) => /spitogatos\.gr\//.test(u) ? u.replace(/_\d+x\d+\.jpg.*$/, "_1600x1200.jpg") : /blob\.cdn\.xe\.gr\//.test(u) ? u.replace(/\?.*$/, "") : u;
async function getImg(u) { try { const r = await fetch(u, { headers: { "user-agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(20000) }); if (!r.ok || !/^image\//.test(r.headers.get("content-type") || "")) return null; const b = Buffer.from(await r.arrayBuffer()); return b.length > 2000 ? b : null; } catch { return null; } }
const exportJobs = new Map();   // id -> {state, done, total, zip, photos, error, at}
app.post("/api/export-zip", (req, res) => {
  const { md = "", csv = "", items = [] } = req.body || {};
  const list = (Array.isArray(items) ? items : []).slice(0, 120).filter((x) => x && typeof x.id === "string" && typeof x.url === "string" && /^https:\/\/(www\.)?(xe\.gr|spitogatos\.gr|spiti24\.gr|ktimatoemporiki\.gr|greekexclusiveproperties\.com|realting\.com)\//.test(x.url));
  if ([...exportJobs.values()].some((j) => j.state === "running")) return res.status(429).json({ error: "busy" });
  for (const [k, j] of exportJobs) if (Date.now() - j.at > 20 * 60e3) exportJobs.delete(k);
  const id = Math.random().toString(36).slice(2, 10), job = { state: "running", done: 0, total: list.length, at: Date.now() }; exportJobs.set(id, job);
  (async () => {
    const gal = await collectGalleries(list.map((x) => ({ id: x.id, url: x.url, source: x.source })), (d) => { job.done = d; });
    const files = [], per = []; let total = 0, ok = 0;
    for (const x of list) { const urls = (gal.get(x.id) || (x.photo ? [x.photo] : [])).filter((u) => PHOTO_OK.test(u)); per.push({ x, urls }); total += urls.length; }
    job.total = total; job.done = 0;
    const names = new Map();
    const tasks = []; per.forEach(({ x, urls }) => urls.forEach((u, k) => tasks.push({ x, u, k })));
    let next = 0;
    await Promise.all(Array.from({ length: 6 }, async () => { for (;;) { const t = tasks[next++]; if (!t) return;
      const b = (await getImg(bigPhoto(t.u))) || (await getImg(t.u));
      if (b) { const nm = `photos/${t.x.name}/${String(t.k + 1).padStart(2, "0")}.${b[0] === 0x89 ? "png" : b[0] === 0x52 ? "webp" : "jpg"}`; files.push({ name: nm, data: b }); (names.get(t.x.id) || names.set(t.x.id, []).get(t.x.id)).push(nm); ok++; }
      job.done++; } }));
    let text = String(md); for (const x of list) text = text.split(`{{PH:${x.id}}}`).join((names.get(x.id) || []).sort().join(", ") || "—");
    job.zip = makeZip([{ name: "listings.md", data: Buffer.from(text, "utf8") }, { name: "listings.csv", data: Buffer.from("\ufeff" + String(csv), "utf8") }, ...files.sort((a, b) => a.name.localeCompare(b.name))]);
    job.photos = `${ok}/${total}`; job.state = "done";
  })().catch((e) => { console.error(e); job.state = "error"; job.error = String(e); });
  res.json({ job: id, total: list.length });
});
app.get("/api/export-zip/:id", (req, res) => {
  const j = exportJobs.get(req.params.id); if (!j) return res.status(404).json({ error: "gone" });
  if (req.query.download && j.state === "done") return res.set({ "content-type": "application/zip", "content-disposition": 'attachment; filename="listings.zip"' }).send(j.zip);
  res.json({ state: j.state, done: j.done, total: j.total, photos: j.photos, error: j.error });
});
app.get("/api/debug", async (req, res) => { try { res.json(await debugPage(String(req.query.site || "xe"), String(req.query.url), req.query.click ? String(req.query.click) : undefined, req.query.sel ? String(req.query.sel) : undefined, req.query.find ? String(req.query.find) : undefined, req.query.dump ? String(req.query.dump) : undefined, !!req.query.phone)); } catch (e) { res.status(500).json({ error: String(e) }); } });

// Ads read elsewhere (e.g. Indomio / Plot, which block server IPs) are posted here and merged like any other source.
app.post("/api/ingest", async (req, res) => {
  const ads = (req.body.ads || []).filter((a) => a && a.id && a.url && a.source);
  const { created, merged } = await mergeAds(ads);
  const sites = (await kvGet("sites")) || {};
  for (const src of new Set(ads.map((a) => a.source)))
    sites[src] = { status: "ok", at: new Date().toISOString(), scraped: ads.filter((a) => a.source === src).length, via: "computer" };
  await kvSet("sites", sites);
  const run = (await kvGet("run")) || {};
  await kvSet("run", { ...run, lastCheck: new Date().toISOString(), lastNew: created });
  res.json({ received: ads.length, created, merged });
});

// One-time import of the existing list (keeps status + notes). Body: { listings: [...] }
app.post("/api/import", async (req, res) => {
  let n = 0;
  for (const x of req.body.listings || []) {
    await pool.query(
      `INSERT INTO listings(id,source,url,type,sqm,price,floor,beds,year,location,multi,posted,status,note,first_seen,also_on)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,COALESCE($15::timestamptz,now()),$16) ON CONFLICT (id) DO NOTHING`,
      [x.id, x.source || "xe", x.url, x.type, x.sqm, x.price, x.floor || "", x.beds || null, x.year || null, x.location || "", !!x.multi, x.posted || "",
       x.status || "new", x.note || "", x.firstSeen || null, JSON.stringify(x.alsoOn || [])]);
    n++;
  }
  res.json({ imported: n });
});



await init();
await initSaas();
await fixXe1().catch((e) => console.error(e));
await fixPrice1().catch((e) => console.error(e));
await fixPrice2().catch((e) => console.error(e));
await fixHotel1().catch((e) => console.error(e));
app.listen(process.env.PORT || 3000, () => console.log("listening"));

// Schedule: one run at each hour in RUN_HOURS (Athens time), 10:00, 16:00 and 22:00 by default. Every run also re-checks which listed ads are still online.
const athensKey = () => new Date().toLocaleString("sv-SE", { timeZone: "Europe/Athens" });   // "YYYY-MM-DD HH:MM:SS"
function dueSlot() {
  const k = athensKey(), hour = +k.slice(11, 13);
  const due = RUN_HOURS.filter((h) => h <= hour).pop();
  return due === undefined ? null : `${k.slice(0, 10)} ${due}`;
}
// After a restart or deploy, don't "catch up" a slot if a run happened recently.
(async () => { try { const r = await kvGet("run"); if (r?.lastCheck && Date.now() - Date.parse(r.lastCheck) < 12 * 36e5 && dueSlot()) await kvSet("lastScheduledSlot", dueSlot()); } catch {} })();
setInterval(async () => {
  const k = athensKey(), day = k.slice(0, 10), hour = +k.slice(11, 13);
  const due = RUN_HOURS.filter((h) => h <= hour).pop();
  if (due === undefined || isRunning()) return;
  const slot = `${day} ${due}`;
  if ((await kvGet("lastScheduledSlot")) === slot) return;
  await kvSet("lastScheduledSlot", slot);
  console.log("scheduled run", k);
  runAll({ verify: true }).catch((e) => console.error(e));
}, 5 * 60 * 1000);
// Phones + details for ads that don't have them yet: starts by itself whenever nothing else is running (after every run, after a deploy).
setInterval(async () => {
  try {
    if (isRunning()) return;
    const last = await kvGet("lastPhonePass");
    if (last && Date.now() - Date.parse(last) < 10 * 60 * 1000) return;
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM listings WHERE gone_at IS NULL AND img IS NOT FALSE AND ((phone IS NULL AND phone_checked IS NULL) OR details_checked IS NULL)`);
    if (!rows[0].n) {   // nothing left to read: if a full scan is waiting, run it now (dead ads + ads without a photo)
      if (await kvGet("scanPending")) {
        await kvSet("lastPhonePass", new Date().toISOString());
        console.log("full scan");
        const done = async () => { const left = await pool.query("SELECT count(*)::int AS n FROM listings WHERE gone_at IS NULL AND (checked_at IS NULL OR checked_at < $1)", [await kvGet("scanStartedAt")]); if (!left.rows[0].n) { await kvSet("scanPending", false); await kvSet("scanVersion", "v2"); } };
        runAll({ scan: true }).then(done).catch((e) => console.error(e));
      }
      return;
    }
    await kvSet("lastPhonePass", new Date().toISOString());
    console.log("phone/details pass, pending", rows[0].n);
    runAll({ phones: true }).catch((e) => console.error(e));
  } catch (e) { console.error(e); }
}, 2 * 60 * 1000);
// One-time full scan requested for this version: queue it once after deploy.
(async () => { try {
  if ((await kvGet("scanVersion")) !== "v2" && !(await kvGet("scanPending"))) {   // v2: re-check homes that are listed on several sites (a dead main ad now hands over to its twin)
    await pool.query("UPDATE listings SET checked_at=NULL WHERE also_on <> '[]'::jsonb");
    await kvSet("scanStartedAt", new Date(Date.now() - 6 * 36e5).toISOString()); await kvSet("scanPending", true);
  }
} catch {} })();
// Weekly Spitogatos sweep: Sunday from 04:00 Athens time. An unfinished sweep (restart, block) is resumed on the next tick.
setInterval(async () => {
  try {
    if (isRunning()) return;
    const k = athensKey(), hour = +k.slice(11, 13), day = k.slice(0, 10);
    const sw = await kvGet("sweep");
    const sunday = new Date().toLocaleDateString("en-US", { timeZone: "Europe/Athens", weekday: "short" }) === "Sun";
    const unfinished = sw && sw.startedAt && !sw.done;
    if (unfinished && (hour >= 3 && hour < 9)) { console.log("resuming sweep"); runSweep().catch((e) => console.error(e)); return; }
    if (sunday && hour >= 4 && hour < 9 && (await kvGet("lastSweepDay")) !== day && !unfinished) {
      await kvSet("lastSweepDay", day);
      console.log("starting weekly sweep", k);
      runSweep().catch((e) => console.error(e));
    }
  } catch (e) { console.error(e); }
}, 5 * 60 * 1000);
