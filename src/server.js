import express from "express";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { init, pool, kvGet, kvSet, toApi } from "./db.js";
import { mergeAds } from "./merge.js";
import { runAll, isRunning, debugPage } from "./runner.js";

const PASSWORD = process.env.TEAM_PASSWORD;
if (!PASSWORD) { console.error("Set TEAM_PASSWORD in Railway variables (the shared password for your team)."); process.exit(1); }
const RUN_HOUR = +(process.env.RUN_HOUR_ATHENS ?? 7);   // one scrape per day, Athens time

const app = express();
app.use(express.json({ limit: "10mb" }));
app.get("/healthz", (_q, r) => r.send("ok"));

// One shared password for the team: login form + signed cookie (API clients may also send Basic auth).
import crypto from "node:crypto";
const sign = (v) => crypto.createHmac("sha256", PASSWORD).update(v).digest("hex");
const TOKEN = sign("owner-listings-session");
const eq = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const cookieOf = (req, name) => (req.headers.cookie || "").split(/;\s*/).map((c) => c.split("=")).find(([k]) => k === name)?.[1] || "";
const LOGIN = (msg = "") => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in</title>
<style>body{font-family:system-ui,sans-serif;background:#f5f6f4;display:grid;place-items:center;min-height:100vh;margin:0}form{background:#fff;padding:28px;border-radius:12px;box-shadow:0 2px 14px #0001;width:min(340px,90vw)}
h1{font-size:18px;margin:0 0 14px}input,button{width:100%;padding:11px;font-size:16px;margin-top:10px;box-sizing:border-box;border-radius:8px;border:1px solid #ccd}button{background:#1f5f8b;color:#fff;border:0;cursor:pointer}p{color:#b3261e;margin:8px 0 0}</style>
<form method="post" action="/login"><h1>Αγγελίες ιδιωτών Αττικής</h1><input type="password" name="password" placeholder="Κωδικός ομάδας" autofocus required><button>Σύνδεση</button>${msg ? `<p>${msg}</p>` : ""}</form>`;
app.use(express.urlencoded({ extended: false }));
app.get("/login", (_q, r) => r.send(LOGIN()));
app.post("/login", (req, res) => {
  if (!eq(String(req.body.password || ""), PASSWORD)) return res.status(401).send(LOGIN("Λάθος κωδικός"));
  res.set("Set-Cookie", `auth=${TOKEN}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 90}`).redirect("/");
});
app.use((req, res, next) => {
  if (eq(cookieOf(req, "auth"), TOKEN)) return next();
  const [, p] = Buffer.from((req.headers.authorization || "").replace(/^Basic /, ""), "base64").toString().split(/:(.*)/s);
  if (p && eq(p, PASSWORD)) return next();
  if (req.path.startsWith("/api/")) return res.status(401).json({ error: "auth" });
  res.redirect("/login");
});

app.get("/api/listings", async (_q, res) => {
  const { rows } = await pool.query("SELECT * FROM listings ORDER BY first_seen DESC");
  res.json(rows.map(toApi));
});
app.patch("/api/listings/:id", async (req, res) => {
  const { status, note } = req.body || {};
  if (status !== undefined && !["new", "contacted", "skip"].includes(status)) return res.status(400).end();
  const r = await pool.query(
    "UPDATE listings SET status=COALESCE($2,status), note=COALESCE($3,note) WHERE id=$1",
    [req.params.id, status ?? null, note === undefined ? null : String(note).slice(0, 2000)]);
  res.status(r.rowCount ? 200 : 404).json({ ok: !!r.rowCount });
});
app.get("/api/meta", async (_q, res) => res.json({ run: await kvGet("run"), sites: (await kvGet("sites")) || {}, running: isRunning() }));
app.post("/api/run", (_q, res) => { if (!isRunning()) runAll().catch((e) => console.error(e)); res.json({ started: !isRunning() }); });

app.get("/api/debug", async (req, res) => { try { res.json(await debugPage(String(req.query.site || "xe"), String(req.query.url), req.query.click ? String(req.query.click) : undefined)); } catch (e) { res.status(500).json({ error: String(e) }); } });

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

app.use(express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public")));

await init();
app.listen(process.env.PORT || 3000, () => console.log("listening"));

// Daily schedule: once a day at RUN_HOUR (Athens) — gentle on the sites.
const athensKey = () => new Date().toLocaleString("sv-SE", { timeZone: "Europe/Athens" });   // "YYYY-MM-DD HH:MM:SS"
setInterval(async () => {
  const k = athensKey(), day = k.slice(0, 10), hour = +k.slice(11, 13);
  if (hour < RUN_HOUR || isRunning()) return;
  const last = await kvGet("lastScheduledDay");
  if (last === day) return;
  await kvSet("lastScheduledDay", day);
  console.log("scheduled run", k);
  runAll().catch((e) => console.error(e));
}, 5 * 60 * 1000);
