// Accounts, offices (one workspace per brokerage), Stripe subscriptions and the public pages.
import crypto from "node:crypto";
import express from "express";
import { pool, kvGet, kvSet } from "./db.js";

export const BRAND = process.env.BRAND || "Property Radar";
export const CONTACT = process.env.CONTACT_EMAIL || "info@propertyradar.gr";
const PRICE_MONTH = Number(process.env.PRICE_MONTH_CENTS || 4900), PRICE_YEAR = Number(process.env.PRICE_YEAR_CENTS || 49900);
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY || "";
const TEAM_PASSWORD = process.env.TEAM_PASSWORD || "";
const DAY = 864e5;

export async function initSaas() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orgs (
      id serial PRIMARY KEY, name text NOT NULL, invite text UNIQUE NOT NULL, comp boolean NOT NULL DEFAULT false,
      stripe_customer text, stripe_sub text, pending_session text, plan text, sub_status text, sub_until timestamptz, sub_cancels boolean DEFAULT false, sub_checked timestamptz,
      created timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS users (
      id serial PRIMARY KEY, org_id integer NOT NULL REFERENCES orgs(id), email text UNIQUE NOT NULL, name text NOT NULL DEFAULT '', pass text NOT NULL, role text NOT NULL DEFAULT 'member',
      created timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS sessions (token text PRIMARY KEY, user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires timestamptz NOT NULL);
    CREATE TABLE IF NOT EXISTS resets (token text PRIMARY KEY, user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires timestamptz NOT NULL);
    CREATE TABLE IF NOT EXISTS blocked (key text PRIMARY KEY, created timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS org_marks (org_id integer NOT NULL, listing_id text NOT NULL, status text NOT NULL DEFAULT 'new', note text NOT NULL DEFAULT '', PRIMARY KEY (org_id, listing_id));
  `);
  // Office 1 is the house team (the shared team password); its existing statuses and notes move into its own workspace once.
  await pool.query("INSERT INTO orgs(id, name, invite, comp) VALUES (1, 'Team', $1, true) ON CONFLICT (id) DO NOTHING", [rand(12)]);
  await pool.query("SELECT setval(pg_get_serial_sequence('orgs','id'), GREATEST((SELECT max(id) FROM orgs), 1))");
  if (!(await kvGet("marksMigrated"))) {
    await pool.query("INSERT INTO org_marks(org_id, listing_id, status, note) SELECT 1, id, status, note FROM listings WHERE status <> 'new' OR note <> '' ON CONFLICT DO NOTHING");
    await kvSet("marksMigrated", true);
  }
  await pool.query("DELETE FROM sessions WHERE expires < now(); DELETE FROM resets WHERE expires < now()");
}

const rand = (n = 32) => crypto.randomBytes(n).toString("base64url");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const hashPass = (p) => { const salt = crypto.randomBytes(16); return "s1$" + salt.toString("base64url") + "$" + crypto.scryptSync(p, salt, 32).toString("base64url"); };
const checkPass = (p, stored) => { const [, salt, h] = String(stored).split("$"); if (!salt || !h) return false; const a = crypto.scryptSync(p, Buffer.from(salt, "base64url"), 32), b = Buffer.from(h, "base64url"); return a.length === b.length && crypto.timingSafeEqual(a, b); };
const eq = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const cookieOf = (req, name) => (req.headers.cookie || "").split(/;\s*/).map((c) => c.split("=")).find(([k]) => k === name)?.[1] || "";
const setCookie = (res, name, val, days) => res.append("Set-Cookie", `${name}=${val}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${Math.round(days * 86400)}`);
const TEAM_TOKEN = TEAM_PASSWORD ? crypto.createHmac("sha256", TEAM_PASSWORD).update("owner-listings-session").digest("hex") : "";
const origin = (req) => process.env.PUBLIC_URL || `https://${req.headers["x-forwarded-host"] || req.headers.host}`;
const eur = (cents) => (cents / 100).toLocaleString("el-GR", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 });

// Too many wrong passwords from one address: wait a little.
const tries = new Map();
const throttled = (ip) => { const t = tries.get(ip); return t && t.n >= 10 && Date.now() - t.at < 15 * 60e3; };
const failed = (ip) => { const t = tries.get(ip); tries.set(ip, t && Date.now() - t.at < 15 * 60e3 ? { n: t.n + 1, at: t.at } : { n: 1, at: Date.now() }); };

// ---- Stripe (plain HTTPS, no SDK) ----
async function stripe(method, path, params) {
  if (!STRIPE_KEY) throw new Error("stripe-not-configured");
  const r = await fetch("https://api.stripe.com/v1/" + path, { method, headers: { Authorization: "Bearer " + STRIPE_KEY, "content-type": "application/x-www-form-urlencoded" }, body: params ? new URLSearchParams(params) : undefined, signal: AbortSignal.timeout(20000) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || "stripe " + r.status);
  return j;
}
async function saveSub(orgId, sub, customer) {
  const end = sub.current_period_end || sub.items?.data?.[0]?.current_period_end || null;
  const interval = sub.items?.data?.[0]?.price?.recurring?.interval || sub.plan?.interval || null;
  await pool.query("UPDATE orgs SET stripe_sub=$2, stripe_customer=COALESCE($3, stripe_customer), sub_status=$4, sub_until=to_timestamp($5), sub_cancels=$6, plan=COALESCE($7, plan), sub_checked=now(), pending_session=NULL WHERE id=$1",
    [orgId, sub.id, customer || (typeof sub.customer === "string" ? sub.customer : null), sub.status, end, !!sub.cancel_at_period_end, interval]);
}
async function syncOrg(org) {   // ask Stripe where the subscription stands (after checkout, and a few times a day)
  try {
    if (org.pending_session && !org.stripe_sub) {
      const s = await stripe("GET", `checkout/sessions/${encodeURIComponent(org.pending_session)}?expand[]=subscription`);
      if (String(s.client_reference_id) === String(org.id) && s.subscription && typeof s.subscription === "object") await saveSub(org.id, s.subscription, typeof s.customer === "string" ? s.customer : null);
      else if (s.status === "expired") await pool.query("UPDATE orgs SET pending_session=NULL WHERE id=$1", [org.id]);
    } else if (org.stripe_sub) {
      await saveSub(org.id, await stripe("GET", "subscriptions/" + encodeURIComponent(org.stripe_sub)));
    }
  } catch (e) { if (e.message !== "stripe-not-configured") console.error("stripe sync", org.id, e.message); await pool.query("UPDATE orgs SET sub_checked=now() WHERE id=$1", [org.id]).catch(() => {}); }
  return (await pool.query("SELECT * FROM orgs WHERE id=$1", [org.id])).rows[0];
}
const paid = (org) => org.comp || (["active", "trialing", "past_due"].includes(org.sub_status) && org.sub_until && new Date(org.sub_until).getTime() + DAY > Date.now());
async function freshOrg(org) {
  if (org.comp) return org;
  const stale = !org.sub_checked || Date.now() - new Date(org.sub_checked).getTime() > 6 * 36e5;
  const lapsed = org.stripe_sub && org.sub_until && new Date(org.sub_until).getTime() < Date.now();
  if ((org.pending_session && !org.stripe_sub) || (org.stripe_sub && (stale || lapsed) && (!org.sub_checked || Date.now() - new Date(org.sub_checked).getTime() > 60e3))) return syncOrg(org);
  return org;
}

// ---- who is asking ----
async function identify(req) {
  if (TEAM_TOKEN) {
    if (eq(cookieOf(req, "auth"), TEAM_TOKEN)) return { admin: true, orgId: 1 };
    const [, p] = Buffer.from((req.headers.authorization || "").replace(/^Basic /, ""), "base64").toString().split(/:(.*)/s);
    if (p && eq(p, TEAM_PASSWORD)) return { admin: true, orgId: 1 };
  }
  const sid = cookieOf(req, "sid");
  if (!sid) return null;
  const { rows } = await pool.query("SELECT u.id AS uid, u.email, u.name AS uname, u.role, o.* FROM sessions s JOIN users u ON u.id=s.user_id JOIN orgs o ON o.id=u.org_id WHERE s.token=$1 AND s.expires > now()", [sid]);
  if (!rows[0]) return null;
  const r = rows[0];
  return { admin: false, orgId: r.id, user: { id: r.uid, email: r.email, name: r.uname, role: r.role }, org: r };
}
async function startSession(res, userId) { const t = rand(); await pool.query("INSERT INTO sessions(token, user_id, expires) VALUES ($1,$2, now() + interval '30 days')", [t, userId]); setCookie(res, "sid", t, 30); }

// ---- pages ----
const shell = (title, body) => `<!doctype html><html lang="el"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · ${esc(BRAND)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap">
<style>:root{--bg:#F6F4EE;--ink:#0F1B2D;--mut:#55617a;--line:#DDD8CB;--card:#FFFDF8;--amber:#E5A823;--amber-ink:#8A5F00;--err:#a3261c}
*{box-sizing:border-box}body{margin:0;font-family:Manrope,system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--bg);color:var(--ink);line-height:1.5}
a{color:var(--ink)}.top{display:flex;justify-content:space-between;align-items:center;padding:20px 24px;max-width:1040px;margin:0 auto}.logo{font-weight:800;letter-spacing:.02em;text-decoration:none;font-size:1.1rem}.logo i{color:var(--amber-ink);font-style:normal}
main{max-width:460px;margin:24px auto 64px;padding:0 16px}main.wide{max-width:760px}.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:28px}
h1{font-size:1.6rem;line-height:1.2;margin:0 0 6px;font-weight:800}h2{font-size:1.1rem;margin:28px 0 8px}p{margin:8px 0}.mut{color:var(--mut);font-size:.95rem}
label{display:block;font-weight:600;font-size:.9rem;margin-top:14px}input[type=text],input[type=email],input[type=password]{width:100%;padding:12px;font:inherit;border:1px solid #c9c3b4;border-radius:10px;background:#fff;margin-top:6px}
input:focus-visible,button:focus-visible,a:focus-visible{outline:3px solid var(--amber);outline-offset:2px}
.btn{display:inline-block;width:100%;padding:13px 18px;font:inherit;font-weight:700;border:0;border-radius:10px;background:var(--ink);color:#F6F4EE;cursor:pointer;text-align:center;text-decoration:none;margin-top:18px}.btn.alt{background:var(--amber);color:var(--ink)}.btn.ghost{background:transparent;color:var(--ink);border:1px solid var(--ink)}
.err{color:var(--err);font-weight:600;margin-top:12px}.ok{color:#1c6b3f;font-weight:600}.chk{display:flex;gap:10px;align-items:flex-start;font-weight:400;font-size:.9rem}.chk input{margin-top:4px}
.plans{display:grid;gap:14px;grid-template-columns:1fr 1fr;margin-top:14px}@media(max-width:560px){.plans{grid-template-columns:1fr}}.plan{border:1px solid var(--line);border-radius:14px;padding:18px;background:#fff}.plan.best{border:2px solid var(--ink)}.tag{display:inline-block;background:var(--amber);font-weight:800;font-size:.72rem;letter-spacing:.06em;padding:3px 8px;border-radius:99px}.big{font-size:1.7rem;font-weight:800}
code{background:#ece8dc;padding:3px 6px;border-radius:6px;word-break:break-all}ul{padding-left:1.2em}footer{max-width:1040px;margin:0 auto;padding:24px;color:var(--mut);font-size:.85rem}</style></head>
<body><div class="top"><a class="logo" href="/">PROPERTY<i>RADAR</i></a><a href="/" class="mut">Αρχική</a></div>${body}
<footer>© ${new Date().getFullYear()} Touslemonde LLC · <a href="/terms">Όροι</a> · <a href="/privacy">Απόρρητο</a> · <a href="mailto:${esc(CONTACT)}">${esc(CONTACT)}</a></footer></body></html>`;

const loginPage = (msg = "", email = "") => shell("Σύνδεση", `<main><div class="card"><h1>Σύνδεση</h1><p class="mut">Συνδεθείτε στον λογαριασμό του γραφείου σας.</p>
<form method="post" action="/login"><label for="e">Email</label><input id="e" type="email" name="email" value="${esc(email)}" autocomplete="email" required autofocus>
<label for="p">Κωδικός</label><input id="p" type="password" name="password" autocomplete="current-password" required>${msg ? `<p class="err" role="alert">${esc(msg)}</p>` : ""}
<button class="btn">Σύνδεση</button></form><p class="mut" style="margin-top:16px">Δεν έχετε λογαριασμό; <a href="/signup">Δημιουργία λογαριασμού</a></p>
<p class="mut">Ξεχάσατε τον κωδικό; Γράψτε μας στο <a href="mailto:${esc(CONTACT)}">${esc(CONTACT)}</a> και θα σας στείλουμε σύνδεσμο επαναφοράς.</p></div></main>`);

const signupPage = ({ msg = "", v = {}, invite = "", orgName = "", plan = "" } = {}) => shell("Δημιουργία λογαριασμού", `<main><div class="card"><h1>${orgName ? "Συμμετοχή στο γραφείο " + esc(orgName) : "Δημιουργία λογαριασμού"}</h1>
<p class="mut">${orgName ? "Θα δουλεύετε στην ίδια λίστα με τους συναδέλφους σας." : "Ένας λογαριασμός για όλο το γραφείο. Προσκαλείτε τους συνεργάτες σας μετά, χωρίς επιπλέον χρέωση."}</p>
<form method="post" action="/signup"><input type="hidden" name="invite" value="${esc(invite)}"><input type="hidden" name="plan" value="${esc(plan)}">
${orgName ? "" : `<label for="o">Επωνυμία γραφείου</label><input id="o" type="text" name="office" value="${esc(v.office)}" maxlength="120" autocomplete="organization" required>`}
<label for="n">Ονοματεπώνυμο</label><input id="n" type="text" name="name" value="${esc(v.name)}" maxlength="120" autocomplete="name" required>
<label for="e">Email</label><input id="e" type="email" name="email" value="${esc(v.email)}" maxlength="200" autocomplete="email" required>
<label for="p">Κωδικός (τουλάχιστον 8 χαρακτήρες)</label><input id="p" type="password" name="password" minlength="8" maxlength="200" autocomplete="new-password" required>
<label class="chk"><input type="checkbox" name="terms" value="1" required><span>Αποδέχομαι τους <a href="/terms" target="_blank" rel="noopener">όρους χρήσης</a> και την <a href="/privacy" target="_blank" rel="noopener">πολιτική απορρήτου</a>.</span></label>
${msg ? `<p class="err" role="alert">${esc(msg)}</p>` : ""}<button class="btn alt">${orgName ? "Συμμετοχή" : "Συνέχεια στην πληρωμή"}</button></form>
<p class="mut" style="margin-top:16px">Έχετε ήδη λογαριασμό; <a href="/login">Σύνδεση</a></p></div></main>`);

function accountPage(req, who, org, team, note = "") {
  const active = paid(org), until = org.sub_until ? new Date(org.sub_until).toLocaleDateString("el-GR", { day: "numeric", month: "long", year: "numeric" }) : "";
  const save = PRICE_MONTH * 12 - PRICE_YEAR, pct = Math.round((save / (PRICE_MONTH * 12)) * 100);
  const link = `${origin(req)}/signup?invite=${org.invite}`;
  const status = org.comp ? `<p class="ok">Η πρόσβασή σας είναι ενεργή.</p>` : active
    ? `<p class="ok">Η συνδρομή σας είναι ενεργή (${org.plan === "year" ? "ετήσια" : "μηνιαία"}).</p><p class="mut">${org.sub_cancels ? "Έχει ακυρωθεί και λήγει στις " : "Επόμενη ανανέωση στις "}${until}.${org.sub_status === "past_due" ? " Η τελευταία χρέωση απέτυχε· ενημερώστε την κάρτα σας." : ""}</p>`
    : `<p><b>Δεν υπάρχει ενεργή συνδρομή.</b> Διαλέξτε πρόγραμμα για να ανοίξετε το εργαλείο.</p>`;
  const plans = org.comp || active ? "" : `<div class="plans">
<form class="plan best" method="post" action="/billing/checkout"><input type="hidden" name="plan" value="year"><span class="tag">ΕΚΠΤΩΣΗ ${pct}%</span><p style="margin:8px 0 0;font-weight:700">Ετήσιο</p><p class="big">€${eur(Math.round(PRICE_YEAR / 12))} <span class="mut" style="font-size:.9rem;font-weight:500">/ μήνα</span></p><p class="mut">€${eur(PRICE_YEAR)} με μία χρέωση τον χρόνο. Κερδίζετε €${eur(save)}.</p><button class="btn alt">Ετήσια συνδρομή</button></form>
<form class="plan" method="post" action="/billing/checkout"><input type="hidden" name="plan" value="month"><p style="margin:26px 0 0;font-weight:700">Μηνιαίο</p><p class="big">€${eur(PRICE_MONTH)} <span class="mut" style="font-size:.9rem;font-weight:500">/ μήνα</span></p><p class="mut">Χρέωση κάθε μήνα. €${eur(PRICE_MONTH * 12)} τον χρόνο.</p><button class="btn ghost">Μηνιαία συνδρομή</button></form></div>
<p class="mut">Η πληρωμή γίνεται με ασφάλεια μέσω Stripe. Ακύρωση όποτε θέλετε.</p>`;
  return shell("Λογαριασμός", `<main class="wide"><div class="card"><h1>${esc(org.name)}</h1><p class="mut">${esc(who.user.name)} · ${esc(who.user.email)}</p>
${note ? `<p class="err" role="alert">${esc(note)}</p>` : ""}${status}${active ? `<a class="btn alt" href="/app">Άνοιγμα εργαλείου</a>` : ""}${plans}
${org.stripe_customer ? `<form method="post" action="/billing/portal"><button class="btn ghost">Διαχείριση συνδρομής (κάρτα, τιμολόγια, ακύρωση)</button></form>` : ""}
<h2>Η ομάδα σας</h2><p class="mut">Στείλτε αυτόν τον σύνδεσμο στους συνεργάτες του γραφείου σας. Όποιος εγγραφεί με αυτόν μπαίνει στην ίδια λίστα, χωρίς επιπλέον χρέωση.</p><p><code>${esc(link)}</code></p>
<ul>${team.map((u) => `<li>${esc(u.name)} · ${esc(u.email)}${u.role === "owner" ? " · διαχειριστής" : ""}</li>`).join("")}</ul>
<form method="post" action="/logout"><button class="btn ghost">Αποσύνδεση</button></form></div></main>`);
}

export function mountSaas(app, { appFile, publicDir }) {
  app.set("trust proxy", true);
  app.use(express.urlencoded({ extended: false, limit: "20kb" }));
  const page = (f) => (_q, res) => res.sendFile(f, { root: publicDir });
  app.get("/", page("landing.html"));
  app.get("/terms", page("terms.html"));
  app.get("/privacy", page("privacy.html"));
  app.get("/api/public", async (_q, res) => {
    const { rows } = await pool.query("SELECT seller, category, count(*)::int AS n FROM listings WHERE img IS NOT FALSE AND gone_at IS NULL GROUP BY 1,2");
    const run = (await kvGet("run")) || {};
    res.set("Cache-Control", "public, max-age=600").json({ counts: Object.fromEntries(rows.map((r) => [r.seller + "/" + r.category, r.n])), lastCheck: run.lastCheck || null, month: PRICE_MONTH, year: PRICE_YEAR, contact: CONTACT });
  });

  // House team: the shared password still opens everything (office 1, no subscription needed).
  const teamPage = (msg = "") => shell("Ομάδα", `<main><div class="card"><h1>Είσοδος ομάδας</h1><form method="post" action="/team"><label for="p">Κωδικός ομάδας</label><input id="p" type="password" name="password" required autofocus>${msg ? `<p class="err" role="alert">${esc(msg)}</p>` : ""}<button class="btn">Σύνδεση</button></form></div></main>`);
  app.get("/team", (_q, res) => res.send(teamPage()));
  app.post("/team", (req, res) => {
    if (!TEAM_PASSWORD || throttled(req.ip) || !eq(String(req.body.password || ""), TEAM_PASSWORD)) { failed(req.ip); return res.status(401).send(teamPage("Λάθος κωδικός")); }
    setCookie(res, "auth", TEAM_TOKEN, 90); res.redirect("/app");
  });

  app.get("/login", async (req, res) => { const who = await identify(req); if (who) return res.redirect(who.admin ? "/app" : "/account"); res.send(loginPage()); });
  app.post("/login", async (req, res) => {
    const email = String(req.body.email || "").trim().toLowerCase(), pw = String(req.body.password || "");
    if (throttled(req.ip)) return res.status(429).send(loginPage("Πολλές προσπάθειες. Δοκιμάστε ξανά σε 15 λεπτά.", email));
    const { rows } = await pool.query("SELECT id, pass FROM users WHERE email=$1", [email]);
    if (!rows[0] || !checkPass(pw, rows[0].pass)) { failed(req.ip); return res.status(401).send(loginPage("Λάθος email ή κωδικός.", email)); }
    await startSession(res, rows[0].id); res.redirect("/app");
  });
  app.post("/logout", async (req, res) => { const sid = cookieOf(req, "sid"); if (sid) await pool.query("DELETE FROM sessions WHERE token=$1", [sid]); setCookie(res, "sid", "", 0); setCookie(res, "auth", "", 0); res.redirect("/"); });

  const inviteOrg = async (code) => code ? (await pool.query("SELECT id, name FROM orgs WHERE invite=$1 AND id <> 1", [code])).rows[0] : null;
  app.get("/signup", async (req, res) => {
    const invite = String(req.query.invite || ""), org = await inviteOrg(invite);
    res.send(signupPage({ invite: org ? invite : "", orgName: org?.name || "", plan: req.query.plan === "month" ? "month" : "year" }));
  });
  app.post("/signup", async (req, res) => {
    const b = req.body || {}, email = String(b.email || "").trim().toLowerCase(), name = String(b.name || "").trim().slice(0, 120), office = String(b.office || "").trim().slice(0, 120), pw = String(b.password || "");
    const invite = String(b.invite || ""), org = await inviteOrg(invite), plan = b.plan === "month" ? "month" : "year";
    const back = (msg) => res.status(400).send(signupPage({ msg, v: { email, name, office }, invite: org ? invite : "", orgName: org?.name || "", plan }));
    if (throttled(req.ip)) return back("Πολλές προσπάθειες. Δοκιμάστε ξανά σε λίγο.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 200) return back("Γράψτε ένα έγκυρο email.");
    if (pw.length < 8) return back("Ο κωδικός χρειάζεται τουλάχιστον 8 χαρακτήρες.");
    if (!name || (!org && !office)) return back("Συμπληρώστε όλα τα πεδία.");
    if (b.terms !== "1") return back("Χρειάζεται η αποδοχή των όρων.");
    if ((await pool.query("SELECT 1 FROM users WHERE email=$1", [email])).rowCount) { failed(req.ip); return back("Υπάρχει ήδη λογαριασμός με αυτό το email. Συνδεθείτε."); }
    const orgId = org ? org.id : (await pool.query("INSERT INTO orgs(name, invite) VALUES ($1,$2) RETURNING id", [office, rand(12)])).rows[0].id;
    const u = await pool.query("INSERT INTO users(org_id, email, name, pass, role) VALUES ($1,$2,$3,$4,$5) RETURNING id", [orgId, email, name, hashPass(pw), org ? "member" : "owner"]);
    await startSession(res, u.rows[0].id);
    res.redirect(org ? "/app" : "/account?plan=" + plan);
  });

  // Password reset: the house team creates a one-time link and sends it to the person who asked.
  const resetPage = (token, msg = "") => shell("Νέος κωδικός", `<main><div class="card"><h1>Νέος κωδικός</h1><form method="post" action="/reset/${esc(token)}"><label for="p">Νέος κωδικός (τουλάχιστον 8 χαρακτήρες)</label><input id="p" type="password" name="password" minlength="8" autocomplete="new-password" required autofocus>${msg ? `<p class="err" role="alert">${esc(msg)}</p>` : ""}<button class="btn">Αποθήκευση</button></form></div></main>`);
  app.get("/reset/:token", async (req, res) => { const ok = (await pool.query("SELECT 1 FROM resets WHERE token=$1 AND expires > now()", [req.params.token])).rowCount; res.status(ok ? 200 : 404).send(ok ? resetPage(req.params.token) : shell("Νέος κωδικός", `<main><div class="card"><h1>Ο σύνδεσμος έληξε</h1><p>Ζητήστε νέο σύνδεσμο στο <a href="mailto:${esc(CONTACT)}">${esc(CONTACT)}</a>.</p></div></main>`)); });
  app.post("/reset/:token", async (req, res) => {
    const pw = String(req.body.password || "");
    if (pw.length < 8) return res.status(400).send(resetPage(req.params.token, "Ο κωδικός χρειάζεται τουλάχιστον 8 χαρακτήρες."));
    const { rows } = await pool.query("DELETE FROM resets WHERE token=$1 AND expires > now() RETURNING user_id", [req.params.token]);
    if (!rows[0]) return res.redirect("/reset/" + encodeURIComponent(req.params.token));
    await pool.query("UPDATE users SET pass=$2 WHERE id=$1", [rows[0].user_id, hashPass(pw)]);
    await pool.query("DELETE FROM sessions WHERE user_id=$1", [rows[0].user_id]);
    await startSession(res, rows[0].user_id); res.redirect("/app");
  });

  // ---- signed-in pages ----
  const needUser = async (req, res, next) => { try { const who = await identify(req); if (!who) return res.redirect("/login"); if (who.admin) return res.redirect("/app"); req.who = who; next(); } catch (e) { next(e); } };
  app.get("/account", needUser, async (req, res) => {
    const org = await freshOrg(req.who.org);
    const team = (await pool.query("SELECT name, email, role FROM users WHERE org_id=$1 ORDER BY id", [org.id])).rows;
    res.send(accountPage(req, req.who, org, team, req.query.pay === "off" ? "Οι πληρωμές ενεργοποιούνται σύντομα. Δοκιμάστε ξανά σε λίγο." : req.query.pay === "err" ? "Η πληρωμή δεν ξεκίνησε. Δοκιμάστε ξανά." : ""));
  });
  app.post("/billing/checkout", needUser, async (req, res) => {
    const org = await freshOrg(req.who.org);
    if (paid(org)) return res.redirect("/account");
    const year = req.body.plan !== "month";
    try {
      const p = { mode: "subscription", client_reference_id: String(org.id), locale: "el", allow_promotion_codes: "true",
        success_url: `${origin(req)}/billing/done?session_id={CHECKOUT_SESSION_ID}`, cancel_url: `${origin(req)}/account`,
        "line_items[0][quantity]": "1", "line_items[0][price_data][currency]": "eur", "line_items[0][price_data][unit_amount]": String(year ? PRICE_YEAR : PRICE_MONTH),
        "line_items[0][price_data][recurring][interval]": year ? "year" : "month", "line_items[0][price_data][product_data][name]": `${BRAND} · ${year ? "ετήσια" : "μηνιαία"} συνδρομή γραφείου`,
        "subscription_data[metadata][org]": String(org.id), "metadata[org]": String(org.id) };
      if (org.stripe_customer) p.customer = org.stripe_customer; else p.customer_email = req.who.user.email;
      const s = await stripe("POST", "checkout/sessions", p);
      await pool.query("UPDATE orgs SET pending_session=$2, stripe_sub=NULL WHERE id=$1", [org.id, s.id]);
      res.redirect(303, s.url);
    } catch (e) { if (e.message !== "stripe-not-configured") console.error("checkout", e.message); res.redirect("/account?pay=" + (e.message === "stripe-not-configured" ? "off" : "err")); }
  });
  app.get("/billing/done", needUser, async (req, res) => {
    const id = String(req.query.session_id || "");
    if (id && id === req.who.org.pending_session) await syncOrg(req.who.org);
    const org = (await pool.query("SELECT * FROM orgs WHERE id=$1", [req.who.org.id])).rows[0];
    res.redirect(paid(org) ? "/app" : "/account");
  });
  app.post("/billing/portal", needUser, async (req, res) => {
    try { const s = await stripe("POST", "billing_portal/sessions", { customer: req.who.org.stripe_customer, return_url: `${origin(req)}/account` }); res.redirect(303, s.url); }
    catch (e) { console.error("portal", e.message); res.redirect("/account?pay=err"); }
  });

  // ---- the tool itself: a paid office or the house team ----
  const needAccess = async (req, res, next) => {
    try {
      const who = await identify(req), api = req.originalUrl.startsWith("/api/");
      if (!who) return api ? res.status(401).json({ error: "auth" }) : res.redirect("/login");
      if (!who.admin) { who.org = await freshOrg(who.org); if (!paid(who.org)) return api ? res.status(402).json({ error: "subscription" }) : res.redirect("/account"); }
      req.who = who; next();
    } catch (e) { next(e); }
  };
  app.get("/app", needAccess, (_q, res) => res.sendFile(appFile));
  app.use("/api", needAccess);
  const adminOnly = (req, res, next) => (req.who.admin ? next() : res.status(403).json({ error: "forbidden" }));
  for (const p of ["/api/hidden", "/api/scan", "/api/phones", "/api/enrich", "/api/sweep", "/api/run", "/api/debug", "/api/ingest", "/api/import", "/api/admin"]) app.use(p, adminOnly);
  app.get("/api/me", (req, res) => res.json(req.who.admin ? { admin: true, org: "Team" } : { admin: false, org: req.who.org.name, name: req.who.user.name }));
  app.get("/api/admin/orgs", async (_q, res) => res.json((await pool.query("SELECT o.id, o.name, o.comp, o.plan, o.sub_status, o.sub_until, o.created, (SELECT json_agg(json_build_object('email', u.email, 'name', u.name, 'role', u.role)) FROM users u WHERE u.org_id=o.id) AS users FROM orgs o ORDER BY o.id")).rows));
  app.post("/api/admin/comp", async (req, res) => { const r = await pool.query("UPDATE orgs SET comp=$2 WHERE id=$1 AND id <> 1", [Number(req.body.org), !!req.body.comp]); res.json({ ok: !!r.rowCount }); });
  // Removal request from an advertiser: the ad (by link) or every ad with that phone number stops showing, and stays hidden if it is read again.
  app.post("/api/admin/block", async (req, res) => {
    const key = String(req.body.key || "").trim(); if (key.length < 6) return res.status(400).json({ error: "key = listing url or phone" });
    await pool.query("INSERT INTO blocked(key) VALUES ($1) ON CONFLICT DO NOTHING", [key]);
    const r = await pool.query("SELECT count(*)::int AS n FROM listings WHERE url=$1 OR phone=$1", [key]);
    res.json({ ok: true, hidden: r.rows[0].n });
  });
  app.post("/api/admin/reset-link", async (req, res) => {
    const { rows } = await pool.query("SELECT id FROM users WHERE email=$1", [String(req.body.email || "").trim().toLowerCase()]);
    if (!rows[0]) return res.status(404).json({ error: "no such user" });
    const t = rand(); await pool.query("INSERT INTO resets(token, user_id, expires) VALUES ($1,$2, now() + interval '2 days')", [t, rows[0].id]);
    res.json({ link: `${origin(req)}/reset/${t}` });
  });
}
