import express from "express";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { init, pool, kvGet, kvSet, toApi } from "./db.js";
import { runAll, isRunning } from "./runner.js";

const PASSWORD = process.env.TEAM_PASSWORD;
if (!PASSWORD) { console.error("Set TEAM_PASSWORD in Railway variables (the shared password for your team)."); process.exit(1); }
const RUN_HOUR = +(process.env.RUN_HOUR_ATHENS ?? 7);   // one scrape per day, Athens time

const app = express();
app.use(express.json({ limit: "10mb" }));
app.get("/healthz", (_q, r) => r.send("ok"));

// One shared password for the team (any username).
app.use((req, res, next) => {
  const [u, p] = Buffer.from((req.headers.authorization || "").replace(/^Basic /, ""), "base64").toString().split(/:(.*)/s);
  if (p === PASSWORD) return next();
  res.set("WWW-Authenticate", 'Basic realm="Sabbianco owner listings"').status(401).send("Password required");
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
