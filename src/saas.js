// Accounts, offices (one workspace per brokerage), Stripe subscriptions and the public pages.
import crypto from "node:crypto";
import express from "express";
import { pool, kvGet, kvSet } from "./db.js";

export const BRAND = process.env.BRAND || "vresakinita";
// Only a brokerage office subscribes (the price covers the office and its lead broker). Each agent is an extra paid seat, added afterwards from the account page.
const BASE = { month: Number(process.env.PRICE_MONTH_CENTS || 4999), year: Number(process.env.PRICE_YEAR_CENTS || 47988) };
const SEAT = { month: Number(process.env.PRICE_SEAT_MONTH_CENTS || 1499), year: Number(process.env.PRICE_SEAT_YEAR_CENTS || 14388) };
const GOOGLE = { id: process.env.GOOGLE_CLIENT_ID || "", secret: process.env.GOOGLE_CLIENT_SECRET || "" };
const APPLE = { id: process.env.APPLE_CLIENT_ID || "", team: process.env.APPLE_TEAM_ID || "", kid: process.env.APPLE_KEY_ID || "", key: (process.env.APPLE_PRIVATE_KEY || "").replace(/\\n/g, "\n") };
const SOCIAL = { google: !!(GOOGLE.id && GOOGLE.secret), apple: !!(APPLE.id && APPLE.team && APPLE.kid && APPLE.key) };
let SECRET = "";
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY || "";
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
    CREATE TABLE IF NOT EXISTS contact_messages (id serial PRIMARY KEY, name text NOT NULL, email text NOT NULL, message text NOT NULL, forwarded text, created timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS org_marks (org_id integer NOT NULL, listing_id text NOT NULL, status text NOT NULL DEFAULT 'new', note text NOT NULL DEFAULT '', PRIMARY KEY (org_id, listing_id));
  `);
  // Office 1 is the house team (the shared team password); its existing statuses and notes move into its own workspace once.
  await pool.query("INSERT INTO orgs(id, name, invite, comp) VALUES (1, 'Team', $1, true) ON CONFLICT (id) DO NOTHING", [rand(12)]);
  await pool.query("SELECT setval(pg_get_serial_sequence('orgs','id'), GREATEST((SELECT max(id) FROM orgs), 1))");
  if (!(await kvGet("marksMigrated"))) {
    await pool.query("INSERT INTO org_marks(org_id, listing_id, status, note) SELECT 1, id, status, note FROM listings WHERE status <> 'new' OR note <> '' ON CONFLICT DO NOTHING");
    await kvSet("marksMigrated", true);
  }
  // Test brokerage (abllicense@gmail.com): free access, skips payment. If he already signed in before, his existing office is made free.
  if (!(await kvGet("testOffice2"))) {
    const ex = (await pool.query("SELECT org_id FROM users WHERE email='abllicense@gmail.com'")).rows[0];
    if (ex) { if (ex.org_id !== 1) await pool.query("UPDATE orgs SET comp=true WHERE id=$1", [ex.org_id]); }
    else {
      const o = (await pool.query("INSERT INTO orgs(name, invite, comp) VALUES ('Test Brokerage', $1, true) RETURNING id", [rand(12)])).rows[0];
      await pool.query("INSERT INTO users(org_id, email, name, pass, role) VALUES ($1, 'abllicense@gmail.com', 'Test Brokerage', '', 'owner')", [o.id]);
    }
    await kvSet("testOffice2", true);
  }
  await pool.query("DELETE FROM sessions WHERE expires < now(); DELETE FROM resets WHERE expires < now()");
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login timestamptz; ALTER TABLE users ADD COLUMN IF NOT EXISTS logins integer NOT NULL DEFAULT 0; ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub text; ALTER TABLE users ADD COLUMN IF NOT EXISTS apple_sub text; ALTER TABLE orgs ADD COLUMN IF NOT EXISTS tier text NOT NULL DEFAULT 'office'; ALTER TABLE orgs ADD COLUMN IF NOT EXISTS seats integer NOT NULL DEFAULT 0");
  SECRET = (await kvGet("authSecret")) || rand(32); await kvSet("authSecret", SECRET);
}

const rand = (n = 32) => crypto.randomBytes(n).toString("base64url");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const hashPass = (p) => { const salt = crypto.randomBytes(16); return "s1$" + salt.toString("base64url") + "$" + crypto.scryptSync(p, salt, 32).toString("base64url"); };
const checkPass = (p, stored) => { const [, salt, h] = String(stored).split("$"); if (!salt || !h || !p) return false; const a = crypto.scryptSync(p, Buffer.from(salt, "base64url"), 32), b = Buffer.from(h, "base64url"); return a.length === b.length && crypto.timingSafeEqual(a, b); };
const eq = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const cookieOf = (req, name) => (req.headers.cookie || "").split(/;\s*/).map((c) => c.split("=")).find(([k]) => k === name)?.[1] || "";
const setCookie = (res, name, val, days) => res.append("Set-Cookie", `${name}=${val}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${Math.round(days * 86400)}`);
// Google accounts that open the admin side (the same access as the team password). Add more with ADMIN_EMAILS=a@x.com,b@y.com
const ADMIN_EMAILS = new Set(["djsmikec@gmail.com", ...String(process.env.ADMIN_EMAILS || "").split(",")].map((e) => e.trim().toLowerCase()).filter(Boolean));
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
const seatItem = (sub) => (sub.items?.data || []).find((i) => i.metadata?.kind === "seat");
async function saveSub(orgId, sub, customer) {
  const base = (sub.items?.data || []).find((i) => i.metadata?.kind !== "seat") || sub.items?.data?.[0], seat = seatItem(sub);
  const end = sub.current_period_end || base?.current_period_end || null;
  const interval = base?.price?.recurring?.interval || sub.plan?.interval || null;
  await pool.query("UPDATE orgs SET stripe_sub=$2, stripe_customer=COALESCE($3, stripe_customer), sub_status=$4, sub_until=to_timestamp($5), sub_cancels=$6, plan=COALESCE($7, plan), seats=$8, sub_checked=now(), pending_session=NULL WHERE id=$1",
    [orgId, sub.id, customer || (typeof sub.customer === "string" ? sub.customer : null), sub.status, end, !!sub.cancel_at_period_end, interval, seat ? seat.quantity : 0]);
}
// Agent seats live on the same subscription as a second line. More seats are charged at once (pro-rated to the renewal date); fewer seats are credited on the next invoice.
async function setSeats(org, n) {
  const sub = await stripe("GET", "subscriptions/" + encodeURIComponent(org.stripe_sub));
  const base = sub.items.data.find((i) => i.metadata?.kind !== "seat"), seat = seatItem(sub), interval = base.price.recurring.interval;
  if (seat && n === 0) await stripe("DELETE", "subscription_items/" + seat.id, { proration_behavior: "create_prorations" });
  else if (seat) await stripe("POST", "subscription_items/" + seat.id, { quantity: String(n), proration_behavior: n > seat.quantity ? "always_invoice" : "create_prorations" });
  else if (n > 0) {
    let product = await kvGet("seatProduct");
    if (!product) { product = (await stripe("POST", "products", { name: `${BRAND} · θέση συνεργάτη` })).id; await kvSet("seatProduct", product); }
    await stripe("POST", "subscription_items", { subscription: sub.id, quantity: String(n), "price_data[currency]": "eur", "price_data[product]": product, "price_data[unit_amount]": String(SEAT[interval]), "price_data[recurring][interval]": interval, "metadata[kind]": "seat", proration_behavior: "always_invoice" });
  }
  await saveSub(org.id, await stripe("GET", "subscriptions/" + encodeURIComponent(org.stripe_sub)));
}
const hasRoom = async (org) => org.comp || (await pool.query("SELECT count(*)::int AS n FROM users WHERE org_id=$1", [org.id])).rows[0].n < 1 + (org.seats || 0);
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
  const sid = cookieOf(req, "sid");
  if (!sid) return null;
  const { rows } = await pool.query("SELECT u.id AS uid, u.email, u.name AS uname, u.role, o.* FROM sessions s JOIN users u ON u.id=s.user_id JOIN orgs o ON o.id=u.org_id WHERE s.token=$1 AND s.expires > now()", [sid]);
  if (!rows[0]) return null;
  const r = rows[0];
  if (r.id === 1) return { admin: true, orgId: 1, user: { id: r.uid, email: r.email, name: r.uname, role: r.role }, org: r };   // the house office = the admin console
  return { admin: false, orgId: r.id, user: { id: r.uid, email: r.email, name: r.uname, role: r.role }, org: r };
}
async function startSession(res, userId) { await pool.query("UPDATE users SET last_login=now(), logins=COALESCE(logins,0)+1 WHERE id=$1", [userId]).catch(() => {}); const t = rand(); await pool.query("INSERT INTO sessions(token, user_id, expires) VALUES ($1,$2, now() + interval '30 days')", [t, userId]); setCookie(res, "sid", t, 30); }

// ---- pages ----
const shell = (title, body) => `<!doctype html><html lang="el"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · ${esc(BRAND)}</title>
<link rel="icon" href="/favicon.png"><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap">
<style>:root{--bg:#F3F6FA;--ink:#0C2C52;--mut:#566884;--line:#D9E2EE;--card:#fff;--blue:#0B5C9B;--sky:#3FA0DC;--soft:#E6F1FA;--err:#a3261c}
*{box-sizing:border-box}body{margin:0;font-family:Manrope,system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--bg);color:var(--ink);line-height:1.5;-webkit-font-smoothing:antialiased}
a{color:var(--blue)}.top{display:flex;justify-content:space-between;align-items:center;padding:18px 24px;max-width:1040px;margin:0 auto}.logo{display:flex;align-items:center;gap:10px;font-weight:800;text-decoration:none;font-size:1.25rem;color:var(--ink);letter-spacing:-.01em}.logo img{height:38px;width:auto}
main{max-width:460px;margin:20px auto 64px;padding:0 16px}main.wide{max-width:780px}.card{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:30px;box-shadow:0 10px 40px rgba(12,44,82,.07)}
h1{font-size:1.65rem;line-height:1.2;margin:0 0 6px;font-weight:800;letter-spacing:-.01em}h2{font-size:1.1rem;margin:30px 0 8px}p{margin:8px 0}.mut{color:var(--mut);font-size:.95rem}
label{display:block;font-weight:600;font-size:.9rem;margin-top:14px}input[type=text],input[type=email],input[type=password],input[type=number]{width:100%;padding:12px 14px;font:inherit;border:1px solid #c5d2e3;border-radius:12px;background:#fff;margin-top:6px;color:var(--ink)}
input:focus-visible,button:focus-visible,a:focus-visible{outline:3px solid var(--sky);outline-offset:2px}
.sbtn{display:flex;align-items:center;justify-content:center;gap:12px;width:100%;height:52px;box-sizing:border-box;margin:12px 0 0;padding:0 16px;border-radius:12px;font:inherit;font-size:16px;font-weight:600;line-height:1;text-decoration:none;cursor:pointer}.sbtn img{height:22px;width:auto;display:block}.sbtn.g{background:#fff;color:#1f1f1f;border:1px solid #c9d3e0}.sbtn.a{background:#000;color:#fff;border:1px solid #000}.btn{display:inline-block;width:100%;padding:13px 18px;font:inherit;font-weight:700;border:0;border-radius:12px;background:var(--ink);color:#fff;cursor:pointer;text-align:center;text-decoration:none;margin-top:16px}.btn.alt{background:linear-gradient(135deg,#0B5C9B,#0C3F78);color:#fff}.btn.ghost{background:#fff;color:var(--ink);border:1px solid #b9c8dc}.btn.sm{width:auto;padding:7px 12px;font-size:.85rem;margin:0}
.err{color:var(--err);font-weight:600;margin-top:12px}.ok{color:#17663d;font-weight:700}.chk{display:flex;gap:10px;align-items:flex-start;font-weight:400;font-size:.9rem}.chk input{margin-top:4px}
.plans{display:grid;gap:14px;grid-template-columns:1fr 1fr;margin-top:14px}@media(max-width:560px){.plans{grid-template-columns:1fr}}.plan{border:1px solid var(--line);border-radius:16px;padding:20px;background:#fff}.plan.best{border:2px solid var(--blue);background:var(--soft)}.plan form{margin:0}.tag{display:inline-block;background:var(--blue);color:#fff;font-weight:800;font-size:.72rem;letter-spacing:.06em;padding:3px 9px;border-radius:99px}.big{font-size:1.8rem;font-weight:800;margin:6px 0 0}
.box{background:var(--soft);border-radius:14px;padding:16px 18px;margin-top:10px}.rowf{display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap}.rowf label{margin:0;flex:1;min-width:150px}.rowf .btn{width:auto;margin:0}
ul.team{list-style:none;padding:0;margin:10px 0}ul.team li{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 0;border-top:1px solid var(--line)}ul.team form{margin:0}
code{background:var(--soft);padding:4px 8px;border-radius:8px;word-break:break-all;font-size:.9rem}footer{max-width:1040px;margin:0 auto;padding:24px;color:var(--mut);font-size:.85rem}footer a{color:var(--mut)}</style><script src="/i18n.js?v=6" defer></script></head>
<body><div class="top"><a class="logo" href="/"><img src="/logo.png" alt="">${esc(BRAND)}</a><a href="/" class="mut">Αρχική</a></div>${body}
<footer>© ${new Date().getFullYear()} Touslemonde LLC · <a href="/terms">Όροι</a> · <a href="/privacy">Απόρρητο</a> · <a href="/contact">Επικοινωνία</a></footer></body></html>`;

const NOTE_OFF = "Η σύνδεση ενεργοποιείται σύντομα.";
const GBTN = `<img src="/icon-google.png?v=1" alt=""><span>Συνέχεια με Google</span>`;
const ABTN = `<img src="/icon-apple.png?v=1" alt=""><span>Συνέχεια με Apple</span>`;
const socialButtons = (q = "") => `<a class="sbtn g" href="/auth/google${q}">${GBTN}</a>` + (SOCIAL.apple ? `<a class="sbtn g" href="/auth/apple${q}">${ABTN}</a>` : "");
const loginPage = (msg = "", email = "") => shell("Σύνδεση", `<main><div class="card"><h1>Σύνδεση</h1><p class="mut">${SOCIAL.apple ? "Συνδεθείτε με τον λογαριασμό Google ή Apple σας." : "Συνδεθείτε με τον λογαριασμό Google σας."}</p>${socialButtons()}
<p class="mut" style="margin:18px 0 0;text-align:center">ή με email και κωδικό</p>
<form method="post" action="/login"><label for="e">Email (όνομα χρήστη)</label><input id="e" type="email" name="email" value="${esc(email)}" autocomplete="username" required>
<label for="p">Κωδικός</label><input id="p" type="password" name="password" autocomplete="current-password" required>${msg ? `<p class="err" role="alert">${esc(msg)}</p>` : ""}
<button class="btn alt">Σύνδεση</button></form>
<p class="mut" style="margin-top:16px">Είστε μεσιτικό γραφείο χωρίς λογαριασμό; <a href="/signup">Εγγραφή γραφείου</a></p>
<p class="mut">Είστε συνεργάτης; Ζητήστε τον σύνδεσμο πρόσκλησης από το γραφείο σας.</p></div></main>`);

const signupPage = ({ msg = "", v = {}, invite = "", orgName = "", plan = "", full = false } = {}) => shell(orgName ? "Συμμετοχή" : "Εγγραφή γραφείου", `<main><div class="card"><h1>${orgName ? "Συμμετοχή στο γραφείο " + esc(orgName) : "Εγγραφή γραφείου"}</h1>
${full ? `<p class="err" role="alert">Το γραφείο δεν έχει ελεύθερη θέση συνεργάτη αυτή τη στιγμή. Ζητήστε από τον υπεύθυνο του γραφείου να προσθέσει μία θέση και ανοίξτε ξανά τον σύνδεσμο.</p></div></main>` : `
<p class="mut">${orgName ? "Θα δουλεύετε στην ίδια λίστα με τους συναδέλφους σας. Η θέση σας έχει ήδη καλυφθεί από το γραφείο." : "Τη συνδρομή την ανοίγει το μεσιτικό γραφείο. Μετά προσθέτετε τους συνεργάτες σας, έναν έναν, από τον λογαριασμό σας."}</p>
<form method="get" action="/auth/google"><input type="hidden" name="invite" value="${esc(invite)}"><input type="hidden" name="plan" value="${esc(plan)}">
${orgName ? "" : `<label for="o">Επωνυμία γραφείου</label><input id="o" type="text" name="office" maxlength="120" autocomplete="organization" required>`}
<label class="chk"><input type="checkbox" name="terms" value="1" required><span>Αποδέχομαι τους <a href="/terms" target="_blank" rel="noopener">όρους χρήσης</a> και την <a href="/privacy" target="_blank" rel="noopener">πολιτική απορρήτου</a>.</span></label>
<button type="submit" class="sbtn g">${GBTN}</button>${SOCIAL.apple ? `<button type="submit" formaction="/auth/apple" class="sbtn g">${ABTN}</button>` : ""}</form>
<details style="margin-top:18px"${msg ? " open" : ""}><summary class="mut" style="cursor:pointer">Ή εγγραφή με email και κωδικό</summary>
<form method="post" action="/signup"><input type="hidden" name="invite" value="${esc(invite)}"><input type="hidden" name="plan" value="${esc(plan)}">
${orgName ? "" : `<label for="o2">Επωνυμία γραφείου</label><input id="o2" type="text" name="office" value="${esc(v.office)}" maxlength="120" autocomplete="organization" required>`}
<label for="n">Ονοματεπώνυμο</label><input id="n" type="text" name="name" value="${esc(v.name)}" maxlength="120" autocomplete="name" required>
<label for="e">Email (όνομα χρήστη)</label><input id="e" type="email" name="email" value="${esc(v.email)}" maxlength="200" autocomplete="username" required>
<label for="pw">Κωδικός (τουλάχιστον 8 χαρακτήρες)</label><input id="pw" type="password" name="password" minlength="8" autocomplete="new-password" required>
<label class="chk"><input type="checkbox" name="terms" value="1" required><span>Αποδέχομαι τους <a href="/terms" target="_blank" rel="noopener">όρους χρήσης</a> και την <a href="/privacy" target="_blank" rel="noopener">πολιτική απορρήτου</a>.</span></label>
${msg ? `<p class="err" role="alert">${esc(msg)}</p>` : ""}<button class="btn alt">Εγγραφή</button></form></details>
<p class="mut" style="margin-top:16px">Έχετε ήδη λογαριασμό; <a href="/login">Σύνδεση</a></p></div></main>`}`);

function accountPage(req, who, org, team, note = "") {
  const active = paid(org), owner = who.user.role === "owner", until = org.sub_until ? new Date(org.sub_until).toLocaleDateString("el-GR", { day: "numeric", month: "long", year: "numeric" }) : "";
  const link = `${origin(req)}/signup?invite=${org.invite}`, iv = org.plan === "month" ? "month" : "year", agents = team.length - 1, free = org.comp ? null : Math.max(0, (org.seats || 0) - agents);
  const save = BASE.month * 12 - BASE.year, pct = Math.round((save / (BASE.month * 12)) * 100);
  const status = org.comp ? `<p class="ok">Η πρόσβασή σας είναι ενεργή.</p>` : active
    ? `<p class="ok">Η συνδρομή του γραφείου είναι ενεργή (${iv === "year" ? "ετήσια" : "μηνιαία"}).</p><p class="mut">${org.sub_cancels ? "Έχει ακυρωθεί και λήγει στις " : "Επόμενη ανανέωση στις "}${until}.${org.sub_status === "past_due" ? " Η τελευταία χρέωση απέτυχε· ενημερώστε την κάρτα σας." : ""}</p>`
    : owner ? `<p><b>Δεν υπάρχει ενεργή συνδρομή.</b> Ξεκινήστε τη συνδρομή του γραφείου για να ανοίξετε το εργαλείο.</p>` : `<p><b>Η συνδρομή του γραφείου δεν είναι ενεργή.</b> Επικοινωνήστε με τον υπεύθυνο του γραφείου σας.</p>`;
  const plans = org.comp || active || !owner ? "" : `<div class="plans">
<div class="plan best"><span class="tag">ΕΚΠΤΩΣΗ ${pct}%</span><p style="margin:8px 0 0;font-weight:800">Ετήσια</p><p class="big">€${eur(Math.round(BASE.year / 12))} <span class="mut" style="font-size:.9rem;font-weight:500">/ μήνα</span></p><p class="mut">€${eur(BASE.year)} με μία χρέωση τον χρόνο. Κερδίζετε €${eur(save)}.</p><form method="post" action="/billing/checkout"><input type="hidden" name="plan" value="year"><button class="btn alt">Ετήσια συνδρομή</button></form></div>
<div class="plan"><p style="margin:27px 0 0;font-weight:800">Μηνιαία</p><p class="big">€${eur(BASE.month)} <span class="mut" style="font-size:.9rem;font-weight:500">/ μήνα</span></p><p class="mut">Χρέωση κάθε μήνα. €${eur(BASE.month * 12)} τον χρόνο.</p><form method="post" action="/billing/checkout"><input type="hidden" name="plan" value="month"><button class="btn ghost">Μηνιαία συνδρομή</button></form></div></div>
<p class="mut">Η συνδρομή περιλαμβάνει τον υπεύθυνο του γραφείου. Κάθε συνεργάτης προστίθεται μετά με €${eur(SEAT.year)} τον χρόνο ή €${eur(SEAT.month)} τον μήνα. Πληρωμή με ασφάλεια μέσω Stripe.</p>`;
  const seatBox = !owner || org.comp || !active ? "" : `<div class="box"><p style="margin:0"><b>Θέσεις συνεργατών: ${org.seats || 0}</b> · σε χρήση ${agents} · ελεύθερες ${free}</p>
<p class="mut" style="margin:4px 0 10px">Κάθε θέση κοστίζει €${eur(SEAT[iv])} ${iv === "year" ? "τον χρόνο" : "τον μήνα"}. Όταν προσθέτετε θέση, χρεώνεται αμέσως η αναλογία μέχρι την επόμενη ανανέωση.</p>
<form method="post" action="/billing/seats" class="rowf"><label for="seats">Συνολικές θέσεις συνεργατών<input id="seats" type="number" name="seats" min="${agents}" max="200" value="${Math.max(org.seats || 0, agents)}" required></label><button class="btn alt">Ενημέρωση θέσεων</button></form></div>`;
  const teamBox = `<h2>Η ομάδα</h2>${owner ? (org.comp || active ? `<p class="mut">${free === 0 ? "Προσθέστε πρώτα μία θέση συνεργάτη. Μετά στείλτε" : "Στείλτε"} αυτόν τον σύνδεσμο στον συνεργάτη σας. Όποιος εγγραφεί με αυτόν μπαίνει στη λίστα του γραφείου και πιάνει μία θέση.</p><p><code>${esc(link)}</code></p>` : "") : ""}${seatBox}
<ul class="team">${team.map((u) => `<li><span>${esc(u.name)} · ${esc(u.email)}${u.role === "owner" ? " · υπεύθυνος γραφείου" : ""}</span>${owner && u.role !== "owner" ? `<form method="post" action="/account/remove"><input type="hidden" name="user" value="${u.id}"><button class="btn ghost sm">Αφαίρεση</button></form>` : ""}</li>`).join("")}</ul>`;
  return shell("Λογαριασμός", `<main class="wide"><div class="card"><h1>${esc(org.name)}</h1><p class="mut">${esc(who.user.name)} · ${esc(who.user.email)}</p>
${note ? `<p class="err" role="alert">${esc(note)}</p>` : ""}${status}${active ? `<a class="btn alt" href="/app">Άνοιγμα εργαλείου</a>` : ""}${plans}
${owner && org.stripe_customer ? `<form method="post" action="/billing/portal"><button class="btn ghost">Διαχείριση συνδρομής (κάρτα, τιμολόγια, ακύρωση)</button></form>` : ""}
${teamBox}
${owner ? `<h2>Επωνυμία</h2><form method="post" action="/account/name" class="rowf"><label for="on">Όνομα γραφείου<input id="on" type="text" name="name" value="${esc(org.name)}" maxlength="120" required></label><button class="btn ghost">Αποθήκευση</button></form>` : ""}
<form method="post" action="/logout"><button class="btn ghost">Αποσύνδεση</button></form></div></main>`);
}

// ---- Google / Apple sign-in (authorization-code flow; the state travels signed, so no cookie is needed on the way back) ----
const b64 = (o) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");
const signState = (o) => { const p = b64({ ...o, t: Date.now() }); return p + "." + crypto.createHmac("sha256", SECRET).update(p).digest("base64url"); };
const readState = (s) => { const [p, sig] = String(s || "").split("."); if (!p || !sig) return null; const good = crypto.createHmac("sha256", SECRET).update(p).digest("base64url"); if (!eq(sig, good)) return null; try { const o = JSON.parse(Buffer.from(p, "base64url").toString()); return Date.now() - o.t < 15 * 60e3 ? o : null; } catch { return null; } };
const jwtBody = (t) => { try { return JSON.parse(Buffer.from(String(t).split(".")[1], "base64url").toString()); } catch { return {}; } };
const appleSecret = () => { const now = Math.floor(Date.now() / 1000), head = b64({ alg: "ES256", kid: APPLE.kid }), body = b64({ iss: APPLE.team, iat: now, exp: now + 300, aud: "https://appleid.apple.com", sub: APPLE.id }); return `${head}.${body}.` + crypto.sign("sha256", Buffer.from(`${head}.${body}`), { key: APPLE.key, dsaEncoding: "ieee-p1363" }).toString("base64url"); };
async function tokenExchange(url, params) { const r = await fetch(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params), signal: AbortSignal.timeout(20000) }); const j = await r.json(); if (!r.ok || !j.id_token) throw new Error(j.error_description || j.error || "token " + r.status); return jwtBody(j.id_token); }
// Signs the person in: an existing account (by provider id, then by verified email) or a new one.
async function socialLogin(res, col, { sub, email, name }, st) {
  let u = (await pool.query(`SELECT id FROM users WHERE ${col}=$1`, [sub])).rows[0];
  if (!u && email) { u = (await pool.query("SELECT id FROM users WHERE email=$1", [email])).rows[0]; if (u) await pool.query(`UPDATE users SET ${col}=$2 WHERE id=$1`, [u.id, sub]); }
  if (u) { await startSession(res, u.id); return res.redirect("/app"); }
  if (!email) return res.status(400).send(loginPage("Ο πάροχος δεν μας έδωσε email. Δοκιμάστε ξανά."));
  const org = st.invite ? (await pool.query("SELECT * FROM orgs WHERE invite=$1 AND id <> 1", [st.invite])).rows[0] : null;
  if (org && !(await hasRoom(org))) return res.status(409).send(signupPage({ orgName: org.name, full: true }));
  const shown = (name || email.split("@")[0]).slice(0, 120), officeName = (st.office || "").trim().slice(0, 120) || shown;
  const orgId = org ? org.id : (await pool.query("INSERT INTO orgs(name, invite) VALUES ($1,$2) RETURNING id", [officeName, rand(12)])).rows[0].id;
  const nu = await pool.query(`INSERT INTO users(org_id, email, name, pass, role, ${col}) VALUES ($1,$2,$3,'',$4,$5) RETURNING id`, [orgId, email, shown, org ? "member" : "owner", sub]);
  await startSession(res, nu.rows[0].id);
  res.redirect(org ? "/app" : `/billing/checkout?plan=${st.plan === "month" ? "month" : "year"}`);
}

export function mountSaas(app, { appFile, publicDir }) {
  app.set("trust proxy", true);
  app.use(express.urlencoded({ extended: false, limit: "20kb" }));
  const page = (f) => (_q, res) => res.sendFile(f, { root: publicDir });
  app.get("/", page("landing.html"));
  app.get("/terms", page("terms.html"));
  app.get("/privacy", page("privacy.html"));
  app.get("/i18n.js", (_q, res) => res.sendFile("i18n.js", { root: publicDir, maxAge: "5m" }));
  for (const f of ["logo.png", "logo-white.png", "favicon.png", "icon-google.png", "icon-apple.png"]) app.get("/" + f, (_q, res) => res.sendFile(f, { root: publicDir, maxAge: "7d" }));
  // ---- contact form: every message is kept, then forwarded to the owner's inbox ----
  const sentBy = new Map();
  async function forward(m, site) {
    const to = process.env.CONTACT_TO; if (!to) return "no-recipient";
    const subject = `${BRAND}: μήνυμα από ${m.name}`;
    if (process.env.RESEND_API_KEY) {
      const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: "Bearer " + process.env.RESEND_API_KEY, "content-type": "application/json" }, signal: AbortSignal.timeout(15000),
        body: JSON.stringify({ from: process.env.CONTACT_FROM || `${BRAND} <onboarding@resend.dev>`, to: [to], reply_to: m.email, subject, text: `${m.name} <${m.email}>\n\n${m.message}` }) });
      return r.ok ? "sent" : "resend " + r.status;
    }
    const r = await fetch("https://formsubmit.co/ajax/" + encodeURIComponent(to), { method: "POST", headers: { "content-type": "application/json", Accept: "application/json", Origin: site, Referer: site + "/contact" }, signal: AbortSignal.timeout(15000),
      body: JSON.stringify({ name: m.name, email: m.email, message: m.message, _subject: subject, _replyto: m.email, _template: "table", _captcha: "false" }) });
    const j = await r.json().catch(() => ({}));
    return r.ok && String(j.success) === "true" ? "sent" : "formsubmit " + r.status + " " + String(j.message || "").slice(0, 120);
  }
  app.post("/api/contact", async (req, res) => {
    const b = req.body || {}, name = String(b.name || "").trim().slice(0, 120), email = String(b.email || "").trim().slice(0, 200), message = String(b.message || "").trim().slice(0, 4000);
    if (b.website) return res.json({ ok: true });   // the hidden field only robots fill in
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || message.length < 10) return res.status(400).json({ ok: false, error: "invalid" });
    const t = sentBy.get(req.ip) || [], recent = t.filter((x) => Date.now() - x < 36e5);
    if (recent.length >= 5) return res.status(429).json({ ok: false, error: "many" });
    sentBy.set(req.ip, [...recent, Date.now()]);
    try {
      const { rows } = await pool.query("INSERT INTO contact_messages(name, email, message) VALUES ($1,$2,$3) RETURNING id", [name, email, message]);
      const state = await forward({ name, email, message }, origin(req)).catch((e) => "error " + e.message);
      if (state !== "sent") console.error("contact forward:", state);
      await pool.query("UPDATE contact_messages SET forwarded=$2 WHERE id=$1", [rows[0].id, state]);
      res.json({ ok: true });
    } catch (e) { console.error("contact", e.message); res.status(500).json({ ok: false, error: "server" }); }
  });
  app.get("/contact", (_q, res) => res.send(shell("Επικοινωνία", `<main><div class="card"><h1>Επικοινωνία</h1><p class="mut">Απαντάμε με email. Έχετε ερώτηση για τη συνδρομή σας, μια πληρωμή, τα δεδομένα σας ή το εργαλείο; Γράψτε μας εδώ.</p>
<form id="cf" novalidate><label for="cn">Το όνομά σας</label><input id="cn" type="text" name="name" autocomplete="name" maxlength="120" required>
<label for="ce">Το email σας</label><input id="ce" type="email" name="email" autocomplete="email" maxlength="200" required>
<label for="cm">Το μήνυμά σας</label><textarea id="cm" name="message" maxlength="4000" rows="6" required style="width:100%;padding:12px;font:inherit;border:1px solid #c5d2e2;border-radius:10px;background:#fff;margin-top:6px;resize:vertical"></textarea>
<label style="position:absolute;left:-9999px" aria-hidden="true">Αφήστε αυτό το πεδίο κενό<input type="text" name="website" tabindex="-1" autocomplete="off"></label>
<p id="cmsg" role="status" hidden></p><button class="btn">Αποστολή μηνύματος</button></form></div></main>
<script>(function(){var f=document.getElementById("cf"),m=document.getElementById("cmsg"),b=f.querySelector("button");function say(k,t){m.hidden=false;m.className=k;m.textContent=t}
f.addEventListener("submit",function(e){e.preventDefault();var n=f.elements.name.value.trim(),em=f.elements.email.value.trim(),ms=f.elements.message.value.trim();
if(!n||!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(em)||ms.length<10){say("err","Συμπληρώστε όνομα, έγκυρο email και μήνυμα τουλάχιστον 10 χαρακτήρων.");return}
b.disabled=true;b.textContent="Αποστολή…";m.hidden=true;
fetch("/api/contact",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:n,email:em,message:ms,website:f.elements.website.value})})
.then(function(r){return r.json().then(function(j){j.status=r.status;return j})}).then(function(j){b.disabled=false;b.textContent="Αποστολή μηνύματος";
if(j.ok){f.reset();say("ok","Το μήνυμά σας στάλθηκε. Θα σας απαντήσουμε με email.")}else say("err",j.status===429?"Στείλατε πολλά μηνύματα. Δοκιμάστε ξανά αργότερα.":j.error==="invalid"?"Ελέγξτε τα πεδία και δοκιμάστε ξανά.":"Το μήνυμα δεν στάλθηκε. Δοκιμάστε ξανά σε λίγο.")})
.catch(function(){b.disabled=false;b.textContent="Αποστολή μηνύματος";say("err","Το μήνυμα δεν στάλθηκε. Δοκιμάστε ξανά σε λίγο.")})})})();</script>`)));

  app.get("/api/public", async (_q, res) => {
    const { rows } = await pool.query("SELECT seller, category, count(*)::int AS n FROM listings WHERE img IS NOT FALSE AND gone_at IS NULL GROUP BY 1,2");
    const run = (await kvGet("run")) || {};
    res.set("Cache-Control", "public, max-age=600").json({ counts: Object.fromEntries(rows.map((r) => [r.seller + "/" + r.category, r.n])), lastCheck: run.lastCheck || null, base: BASE, seat: SEAT });
  });

  // A small, anonymised taste of the real list for the landing page: area, size and price only. No links, photos, sources or contact details.
  let peek = { at: 0, data: null };
  app.get("/api/public/preview", async (_q, res) => {
    if (Date.now() - peek.at > 30 * 60e3) {
      const out = {};
      for (const [seller, category] of [["owner", "home"], ["owner", "land"], ["agency", "home"], ["agency", "land"], ["agency", "hotel"]]) {
        const { rows } = await pool.query("SELECT type, sqm, price, currency, floor, beds, location, first_seen FROM listings WHERE img IS NOT FALSE AND gone_at IS NULL AND seller=$1 AND category=$2 AND price > 20000 AND location <> '' ORDER BY first_seen DESC LIMIT 6", [seller, category]);
        out[seller + "/" + category] = rows.map((r) => ({ type: r.type || "", sqm: r.sqm, price: Math.round(r.price / 1000) * 1000, currency: r.currency || "EUR", floor: r.floor || "", beds: r.beds, area: String(r.location).split(/[,(]/)[0].trim().slice(0, 40), seen: r.first_seen }));
      }
      peek = { at: Date.now(), data: out };
    }
    res.set("Cache-Control", "public, max-age=900").json(peek.data);
  });

  {
    app.get("/auth/google", (req, res) => !SOCIAL.google ? res.status(503).send(loginPage(NOTE_OFF)) : res.redirect("https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({ client_id: GOOGLE.id, redirect_uri: origin(req) + "/auth/google/callback", response_type: "code", scope: "openid email profile", prompt: "select_account", state: signState({ invite: String(req.query.invite || ""), plan: String(req.query.plan || ""), office: String(req.query.office || "").slice(0, 120) }) })));
    app.get("/auth/google/callback", async (req, res) => {
      const st = readState(req.query.state); if (!st || !req.query.code) return res.status(400).send(loginPage("Η σύνδεση δεν ολοκληρώθηκε. Δοκιμάστε ξανά."));
      try { const t = await tokenExchange("https://oauth2.googleapis.com/token", { code: String(req.query.code), client_id: GOOGLE.id, client_secret: GOOGLE.secret, redirect_uri: origin(req) + "/auth/google/callback", grant_type: "authorization_code" });
        if (!t.sub || !t.email || t.email_verified === false) throw new Error("no verified email");
        if (ADMIN_EMAILS.has(String(t.email).toLowerCase())) {   // admin console: a verified Google account listed in ADMIN_EMAILS, no password
          const em = String(t.email).toLowerCase();
          let u = (await pool.query("SELECT id FROM users WHERE email=$1", [em])).rows[0];
          if (u) await pool.query("UPDATE users SET org_id=1, role='owner', pass='', google_sub=$2 WHERE id=$1", [u.id, t.sub]);
          else u = (await pool.query("INSERT INTO users(org_id, email, name, pass, role, google_sub) VALUES (1,$1,$2,'','owner',$3) RETURNING id", [em, t.name || em.split("@")[0], t.sub])).rows[0];
          await startSession(res, u.id); return res.redirect("/admin");
        }
        await socialLogin(res, "google_sub", { sub: t.sub, email: String(t.email).toLowerCase(), name: t.name || "" }, st);
      } catch (e) { console.error("google sign-in", e.message); res.status(400).send(loginPage("Η σύνδεση με Google απέτυχε. Δοκιμάστε ξανά.")); }
    });
  }
  {
    app.get("/auth/apple", (req, res) => !SOCIAL.apple ? res.status(503).send(loginPage(NOTE_OFF)) : res.redirect("https://appleid.apple.com/auth/authorize?" + new URLSearchParams({ client_id: APPLE.id, redirect_uri: origin(req) + "/auth/apple/callback", response_type: "code", response_mode: "form_post", scope: "name email", state: signState({ invite: String(req.query.invite || ""), plan: String(req.query.plan || ""), office: String(req.query.office || "").slice(0, 120) }) })));
    app.post("/auth/apple/callback", async (req, res) => {
      const st = readState(req.body.state); if (!st || !req.body.code) return res.status(400).send(loginPage("Η σύνδεση δεν ολοκληρώθηκε. Δοκιμάστε ξανά."));
      try { const t = await tokenExchange("https://appleid.apple.com/auth/token", { code: String(req.body.code), client_id: APPLE.id, client_secret: appleSecret(), redirect_uri: origin(req) + "/auth/apple/callback", grant_type: "authorization_code" });
        if (!t.sub) throw new Error("no subject");
        let name = ""; try { const u = JSON.parse(req.body.user || "{}"); name = [u.name?.firstName, u.name?.lastName].filter(Boolean).join(" "); } catch {}
        if (t.email && ADMIN_EMAILS.has(String(t.email).toLowerCase())) return res.status(403).send(loginPage("Ο διαχειριστής συνδέεται μόνο με Google."));   // the admin console stays Google-only
        await socialLogin(res, "apple_sub", { sub: t.sub, email: t.email ? String(t.email).toLowerCase() : "", name }, st);
      } catch (e) { console.error("apple sign-in", e.message); res.status(400).send(loginPage("Η σύνδεση με Apple απέτυχε. Δοκιμάστε ξανά.")); }
    });
  }

  app.get("/login", async (req, res) => { const who = await identify(req); if (who) return res.redirect(who.admin ? "/admin" : "/account"); res.send(loginPage()); });
  app.post("/login", async (req, res) => {
    const email = String(req.body.email || "").trim().toLowerCase(), pw = String(req.body.password || "");
    if (throttled(req.ip)) return res.status(429).send(loginPage("Πολλές προσπάθειες. Δοκιμάστε ξανά σε 15 λεπτά.", email));
    if (ADMIN_EMAILS.has(email)) { failed(req.ip); return res.status(401).send(loginPage("Αυτός ο λογαριασμός συνδέεται μόνο με Google.", email)); }
    const { rows } = await pool.query("SELECT id, pass FROM users WHERE email=$1", [email]);
    if (!rows[0] || !rows[0].pass || !checkPass(pw, rows[0].pass)) { failed(req.ip); return res.status(401).send(loginPage("Λάθος email ή κωδικός.", email)); }
    await startSession(res, rows[0].id); res.redirect("/account");
  });
  app.post("/logout", async (req, res) => { const sid = cookieOf(req, "sid"); if (sid) await pool.query("DELETE FROM sessions WHERE token=$1", [sid]); setCookie(res, "sid", "", 0); setCookie(res, "auth", "", 0); res.redirect("/"); });

  const inviteOrg = async (code) => code ? (await pool.query("SELECT * FROM orgs WHERE invite=$1 AND id <> 1", [code])).rows[0] : null;
  app.get("/signup", async (req, res) => {
    const invite = String(req.query.invite || ""), org = await inviteOrg(invite);
    res.send(signupPage({ invite: org ? invite : "", orgName: org?.name || "", plan: req.query.plan === "month" ? "month" : "year", full: !!org && !(await hasRoom(org)) }));
  });
  app.post("/signup", async (req, res) => {
    const b = req.body || {}, email = String(b.email || "").trim().toLowerCase(), name = String(b.name || "").trim().slice(0, 120), office = String(b.office || "").trim().slice(0, 120), pw = String(b.password || "");
    const invite = String(b.invite || ""), org = await inviteOrg(invite), plan = b.plan === "month" ? "month" : "year";
    const back = (msg) => res.status(400).send(signupPage({ msg, v: { email, name, office }, invite: org ? invite : "", orgName: org?.name || "", plan }));
    if (throttled(req.ip)) return back("Πολλές προσπάθειες. Δοκιμάστε ξανά σε λίγο.");
    if (org && !(await hasRoom(org))) return res.status(409).send(signupPage({ orgName: org.name, full: true }));
    if (ADMIN_EMAILS.has(email)) return back("Αυτό το email δεν μπορεί να χρησιμοποιηθεί.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 200) return back("Γράψτε ένα έγκυρο email.");
    if (pw.length < 8) return back("Ο κωδικός χρειάζεται τουλάχιστον 8 χαρακτήρες.");
    if (!name || (!org && !office)) return back("Συμπληρώστε όλα τα πεδία.");
    if (b.terms !== "1") return back("Χρειάζεται η αποδοχή των όρων.");
    if ((await pool.query("SELECT 1 FROM users WHERE email=$1", [email])).rowCount) { failed(req.ip); return back("Υπάρχει ήδη λογαριασμός με αυτό το email. Συνδεθείτε."); }
    const orgId = org ? org.id : (await pool.query("INSERT INTO orgs(name, invite) VALUES ($1,$2) RETURNING id", [office, rand(12)])).rows[0].id;
    const u = await pool.query("INSERT INTO users(org_id, email, name, pass, role) VALUES ($1,$2,$3,$4,$5) RETURNING id", [orgId, email, name, hashPass(pw), org ? "member" : "owner"]);
    await startSession(res, u.rows[0].id);
    res.redirect(org ? "/app" : `/billing/checkout?plan=${plan}`);
  });
  const needUser = async (req, res, next) => { try { const who = await identify(req); if (!who) return res.redirect("/login"); if (who.admin) return res.redirect("/app"); req.who = who; next(); } catch (e) { next(e); } };
  const NOTES = { off: "Οι πληρωμές ενεργοποιούνται σύντομα. Δοκιμάστε ξανά σε λίγο.", err: "Η ενέργεια δεν ολοκληρώθηκε. Δοκιμάστε ξανά.", seats: "Αφαιρέστε πρώτα συνεργάτες: οι θέσεις δεν μπορούν να είναι λιγότερες από τους συνεργάτες που έχετε." };
  app.get("/account", needUser, async (req, res) => {
    const org = await freshOrg(req.who.org);
    const team = (await pool.query("SELECT id, name, email, role FROM users WHERE org_id=$1 ORDER BY id", [org.id])).rows;
    res.send(accountPage(req, req.who, org, team, NOTES[req.query.pay] || ""));
  });
  const ownerOnly = (req, res, next) => (req.who.user.role === "owner" ? next() : res.redirect("/account"));
  app.post("/account/name", needUser, ownerOnly, async (req, res) => { const n = String(req.body.name || "").trim().slice(0, 120); if (n) await pool.query("UPDATE orgs SET name=$2 WHERE id=$1", [req.who.org.id, n]); res.redirect("/account"); });
  app.post("/account/remove", needUser, ownerOnly, async (req, res) => { await pool.query("DELETE FROM users WHERE id=$1 AND org_id=$2 AND role <> 'owner'", [Number(req.body.user) || 0, req.who.org.id]); res.redirect("/account"); });
  const checkout = async (req, res) => {   // POST from the account page, GET right after sign-up
    const org = await freshOrg(req.who.org), q = { ...req.query, ...req.body };
    if (paid(org) || req.who.user.role !== "owner") return res.redirect("/account");
    const year = q.plan !== "month";
    try {
      const p = { mode: "subscription", client_reference_id: String(org.id), locale: "el", allow_promotion_codes: "true",
        success_url: `${origin(req)}/billing/done?session_id={CHECKOUT_SESSION_ID}`, cancel_url: `${origin(req)}/account`,
        "line_items[0][quantity]": "1", "line_items[0][price_data][currency]": "eur", "line_items[0][price_data][unit_amount]": String(year ? BASE.year : BASE.month),
        "line_items[0][price_data][recurring][interval]": year ? "year" : "month", "line_items[0][price_data][product_data][name]": `${BRAND} · ${year ? "ετήσια" : "μηνιαία"} συνδρομή γραφείου`,
        "subscription_data[metadata][org]": String(org.id), "metadata[org]": String(org.id) };
      if (org.stripe_customer) p.customer = org.stripe_customer; else p.customer_email = req.who.user.email;
      const s = await stripe("POST", "checkout/sessions", p);
      await pool.query("UPDATE orgs SET pending_session=$2, stripe_sub=NULL WHERE id=$1", [org.id, s.id]);
      res.redirect(303, s.url);
    } catch (e) { if (e.message !== "stripe-not-configured") console.error("checkout", e.message); res.redirect("/account?pay=" + (e.message === "stripe-not-configured" ? "off" : "err")); }
  };
  app.post("/billing/checkout", needUser, checkout);
  app.get("/billing/checkout", needUser, checkout);
  app.post("/billing/seats", needUser, ownerOnly, async (req, res) => {
    const org = await freshOrg(req.who.org), n = Math.floor(Number(req.body.seats));
    if (!paid(org) || org.comp || !org.stripe_sub || !(n >= 0 && n <= 200)) return res.redirect("/account?pay=err");
    const agents = (await pool.query("SELECT count(*)::int AS n FROM users WHERE org_id=$1 AND role <> 'owner'", [org.id])).rows[0].n;
    if (n < agents) return res.redirect("/account?pay=seats");
    try { if (n !== (org.seats || 0)) await setSeats(org, n); res.redirect("/account"); }
    catch (e) { console.error("seats", e.message); res.redirect("/account?pay=" + (e.message === "stripe-not-configured" ? "off" : "err")); }
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
  app.get("/api/admin/messages", async (_q, res) => res.json((await pool.query("SELECT * FROM contact_messages ORDER BY id DESC LIMIT 200")).rows));
  app.get("/api/admin/orgs", async (_q, res) => res.json((await pool.query("SELECT o.id, o.name, o.comp, o.plan, o.sub_status, o.sub_until, o.created, (SELECT json_agg(json_build_object('email', u.email, 'name', u.name, 'role', u.role)) FROM users u WHERE u.org_id=o.id) AS users FROM orgs o ORDER BY o.id")).rows));
  // ---- admin console: customers ----
  const custRows = async () => (await pool.query(`SELECT u.id, u.email, u.name, u.role, u.created, u.last_login, u.logins, (u.google_sub IS NOT NULL) AS google, o.id AS org_id, o.name AS org, o.comp, o.plan, o.seats, o.sub_status, o.sub_until, o.sub_cancels, o.stripe_sub
    FROM users u JOIN orgs o ON o.id=u.org_id WHERE o.id <> 1 ORDER BY u.created DESC`)).rows;
  const custStatus = (r) => r.comp ? "free" : !r.sub_status ? "none" : r.sub_status === "canceled" || r.sub_status === "incomplete_expired" ? "cancelled" : r.sub_cancels ? "ending" : r.sub_status === "past_due" || r.sub_status === "unpaid" ? "past_due" : ["active", "trialing"].includes(r.sub_status) ? "active" : "none";
  app.get("/api/admin/customers", async (_q, res) => {
    const rows = (await custRows()).map((r) => ({ ...r, status: custStatus(r), signin: r.google ? "google" : "email" }));
    const orgs = new Map(); for (const r of rows) if (!orgs.has(r.org_id)) orgs.set(r.org_id, r);
    const live = [...orgs.values()].filter((r) => ["active", "ending", "past_due"].includes(r.status) && !r.comp);
    const mrr = live.reduce((n, r) => n + (r.plan === "year" ? BASE.year / 12 + (r.seats || 0) * SEAT.year / 12 : BASE.month + (r.seats || 0) * SEAT.month), 0);
    res.json({ rows, stats: { users: rows.length, offices: orgs.size, active: live.length, yearly: live.filter((r) => r.plan === "year").length, monthly: live.filter((r) => r.plan !== "year").length, cancelled: [...orgs.values()].filter((r) => r.status === "cancelled" || r.status === "ending").length, none: [...orgs.values()].filter((r) => r.status === "none").length, week: rows.filter((r) => Date.now() - new Date(r.created).getTime() < 7 * 864e5).length, mrr_cents: Math.round(mrr) } });
  });
  app.get("/api/admin/customers.csv", async (_q, res) => {
    const q = (v) => '"' + String(v ?? "").replace(/"/g, '""') + '"';
    const out = [["email", "name", "office", "role", "signed_in_with", "status", "plan", "seats", "paid_until", "joined", "last_login", "logins"].join(",")];
    for (const r of await custRows()) out.push([r.email, r.name, r.org, r.role, r.google ? "google" : "email", custStatus(r), r.plan || "", r.seats || 0, r.sub_until ? new Date(r.sub_until).toISOString() : "", new Date(r.created).toISOString(), r.last_login ? new Date(r.last_login).toISOString() : "", r.logins || 0].map(q).join(","));
    res.type("text/csv; charset=utf-8").set("Content-Disposition", 'attachment; filename="customers.csv"').send("﻿" + out.join("\n"));
  });
  app.post("/api/admin/users/:id/reset", async (req, res) => {
    const id = Number(req.params.id) || 0;
    const u = (await pool.query("SELECT u.id, u.pass FROM users u WHERE u.id=$1 AND u.org_id <> 1", [id])).rows[0];
    if (!u) return res.status(404).json({ error: "Δεν βρέθηκε ο χρήστης." });
    if (!u.pass) return res.status(400).json({ error: "Αυτός ο χρήστης συνδέεται με Google και δεν έχει κωδικό." });
    const pw = rand(9);
    await pool.query("UPDATE users SET pass=$2 WHERE id=$1", [id, hashPass(pw)]);
    await pool.query("DELETE FROM sessions WHERE user_id=$1", [id]);
    res.json({ ok: true, password: pw });
  });
  app.post("/api/admin/users/:id/delete", async (req, res) => {
    const id = Number(req.params.id) || 0, cancel = req.body?.cancelStripe === true || req.body?.cancelStripe === "1";
    const u = (await pool.query("SELECT u.id, u.org_id, o.stripe_sub, o.sub_status, o.sub_cancels FROM users u JOIN orgs o ON o.id=u.org_id WHERE u.id=$1 AND u.org_id <> 1", [id])).rows[0];
    if (!u) return res.status(404).json({ error: "Δεν βρέθηκε ο χρήστης." });
    const others = (await pool.query("SELECT count(*)::int AS n FROM users WHERE org_id=$1 AND id <> $2", [u.org_id, id])).rows[0].n;
    const live = !others && u.stripe_sub && ["active", "trialing", "past_due"].includes(u.sub_status) && !u.sub_cancels;
    if (live && !cancel) return res.status(409).json({ error: "Το γραφείο έχει ενεργή συνδρομή. Τσεκάρετε «Ακύρωση και της συνδρομής στο Stripe» ή ακυρώστε την πρώτα στο Stripe." });
    if (live && cancel) { try { await stripe("DELETE", "subscriptions/" + encodeURIComponent(u.stripe_sub)); } catch (e) { return res.status(502).json({ error: "Η ακύρωση στο Stripe απέτυχε: " + e.message }); } }
    await pool.query("DELETE FROM users WHERE id=$1", [id]);
    let officeDeleted = false;
    if (!others) { await pool.query("DELETE FROM org_marks WHERE org_id=$1", [u.org_id]); await pool.query("DELETE FROM orgs WHERE id=$1 AND id <> 1", [u.org_id]); officeDeleted = true; }
    res.json({ ok: true, officeDeleted });
  });
  app.post("/api/admin/test-user", async (req, res) => {
    const email = String(req.body?.email || "").trim().toLowerCase(), pw = String(req.body?.password || "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 200) return res.status(400).json({ error: "Γράψτε ένα έγκυρο email." });
    if (pw.length < 8) return res.status(400).json({ error: "Ο κωδικός χρειάζεται τουλάχιστον 8 χαρακτήρες." });
    if (ADMIN_EMAILS.has(email)) return res.status(400).json({ error: "Αυτό το email είναι διαχειριστής." });
    if ((await pool.query("SELECT 1 FROM users WHERE email=$1", [email])).rowCount) return res.status(409).json({ error: "Υπάρχει ήδη χρήστης με αυτό το email." });
    const o = (await pool.query("INSERT INTO orgs(name, invite, comp) VALUES ($1,$2,true) RETURNING id", ["Δοκιμαστικό: " + email, rand(12)])).rows[0];
    const u = (await pool.query("INSERT INTO users(org_id, email, name, pass, role) VALUES ($1,$2,$3,$4,'owner') RETURNING id", [o.id, email, "Δοκιμαστικός χρήστης", hashPass(pw)])).rows[0];
    res.json({ ok: true, id: u.id });
  });
  app.get("/api/admin/users/:id", async (req, res) => {
    const r = (await custRows()).find((x) => x.id === Number(req.params.id));
    if (!r) return res.status(404).json({ error: "Δεν βρέθηκε ο χρήστης." });
    res.json({ ...r, status: custStatus(r), signin: r.google ? "google" : "email" });
  });
  app.get("/admin/user/:id", needAccess, (req, res) => {
    if (!req.who.admin) return res.redirect("/");
    res.send(shell("Χρήστης", `<main style="max-width:760px"><p><a href="/admin">← Όλοι οι χρήστες</a></p><h1 id="em">…</h1><p class="mut">Διαχείριση αυτού του λογαριασμού.</p>
<div id="info" style="background:#fff;border:1px solid var(--line);border-radius:14px;padding:18px 20px;margin:16px 0"></div>
<div style="background:#fff;border:1px solid var(--line);border-radius:14px;padding:18px 20px;margin:16px 0"><h2 style="margin-top:0">Κωδικός</h2><div id="pwbox"></div></div>
<div style="background:#fff;border:1px solid var(--line);border-radius:14px;padding:18px 20px;margin:16px 0"><h2 style="margin-top:0">Διαγραφή λογαριασμού</h2><p class="mut">Αφαιρεί τον χρήστη και τον αποσυνδέει. Αν είναι ο τελευταίος χρήστης του γραφείου, διαγράφεται και το γραφείο με τις σημειώσεις του. Δεν αναιρείται.</p>
<label class="chk"><input type="checkbox" id="cs"><span>Ακύρωση και της συνδρομής στο Stripe</span></label><label class="chk"><input type="checkbox" id="ok"><span>Καταλαβαίνω ότι δεν αναιρείται</span></label>
<p class="err" id="err" role="alert" hidden></p><button class="btn" id="del" type="button" style="background:#8f2a22">Διαγραφή λογαριασμού</button></div>
<script>
const id=location.pathname.split("/").pop();
const e=s=>String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const d=s=>s?new Date(s).toLocaleString("el-GR",{dateStyle:"medium",timeStyle:"short"}):"—";
const ST={active:"Ενεργή",ending:"Λήγει (ακυρώθηκε)",past_due:"Καθυστέρηση",cancelled:"Ακυρωμένη",none:"Χωρίς πλάνο",free:"Δωρεάν"},PL={month:"Μηνιαίο",year:"Ετήσιο"};
fetch("/api/admin/users/"+id).then(r=>r.json()).then(u=>{
 if(u.error){document.getElementById("em").textContent=u.error;return;}
 document.getElementById("em").textContent=u.email;
 const row=(a,b)=>"<tr><td style='padding:6px 24px 6px 0;color:#566884'>"+a+"</td><td>"+b+"</td></tr>";
 document.getElementById("info").innerHTML="<table>"+row("Γραφείο",e(u.org))+row("Σύνδεση με",e(u.signin))+row("Κατάσταση",e(ST[u.status]))+row("Πλάνο",e(PL[u.plan]||"—")+(u.seats?" +"+u.seats+" θέσεις":""))+row("Ισχύει έως",u.sub_until?d(u.sub_until):"—")+row("Εγγραφή",d(u.created))+row("Τελευταία σύνδεση",d(u.last_login))+row("Συνδέσεις",u.logins||0)+"</table>";
 document.getElementById("pwbox").innerHTML=u.signin==="email"?"<button class='btn ghost sm' id='rs' type='button'>Νέος κωδικός</button>":"<p class='mut' style='margin:0'>Ο χρήστης συνδέεται με Google, δεν υπάρχει κωδικός για επαναφορά.</p>";
 const rs=document.getElementById("rs"); if(rs)rs.onclick=async()=>{if(!confirm("Να δημιουργηθεί νέος προσωρινός κωδικός; Ο χρήστης αποσυνδέεται παντού."))return;const j=await (await fetch("/api/admin/users/"+id+"/reset",{method:"POST"})).json();if(j.ok)prompt("Νέος κωδικός (αντιγράψτε τον και δώστε τον στον χρήστη):",j.password);else alert(j.error||"Σφάλμα");};
 document.getElementById("del").onclick=async()=>{const er=document.getElementById("err");er.hidden=true;if(!document.getElementById("ok").checked){er.textContent="Τσεκάρετε ότι καταλαβαίνετε ότι δεν αναιρείται.";er.hidden=false;return;}
  const r=await fetch("/api/admin/users/"+id+"/delete",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({cancelStripe:document.getElementById("cs").checked})});const j=await r.json();
  if(j.ok)location.href="/admin";else{er.textContent=j.error||"Σφάλμα";er.hidden=false;}};
});
</script></main>`));
  });
  app.post("/api/admin/refresh", async (_q, res) => {
    const orgs = (await pool.query("SELECT * FROM orgs WHERE id <> 1 AND (stripe_sub IS NOT NULL OR pending_session IS NOT NULL)")).rows;
    for (const o of orgs) await syncOrg(o);
    res.json({ ok: true, refreshed: orgs.length });
  });
  app.get("/customers", (_q, res) => res.redirect("/admin"));
  app.get("/admin", needAccess, (req, res) => {
    if (!req.who.admin) return res.redirect("/");
    res.send(shell("Διαχείριση", `<main style="max-width:1100px"><div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap"><h1 style="margin:0">Διαχείριση</h1><span><a class="btn sm" href="/app">Άνοιγμα εργαλείου</a> <form method="post" action="/logout" style="display:inline"><button class="btn ghost sm">Αποσύνδεση</button></form></span></div><p class="mut">Όλοι όσοι έχουν συνδεθεί, με την κατάσταση της συνδρομής τους από το Stripe.</p>
<div id="tiles" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:18px 0"></div>
<div style="background:#fff;border:1px solid var(--line);border-radius:14px;padding:18px 20px;margin-bottom:18px"><h2 style="margin:0 0 6px">Προσθήκη δοκιμαστικού χρήστη</h2><p class="mut" style="margin:0 0 12px">Δημιουργεί λογαριασμό με κωδικό, πλήρη πρόσβαση στο εργαλείο και χωρίς πληρωμή. Δεν στέλνεται email: δώστε τον κωδικό εσείς.</p>
<div style="display:flex;gap:10px;flex-wrap:wrap"><input id="tu_e" type="email" placeholder="Email" autocomplete="off" style="flex:1;min-width:200px;padding:11px 14px;border:1px solid var(--line);border-radius:10px;font:inherit"><input id="tu_p" type="text" placeholder="Κωδικός (8+ χαρακτήρες)" autocomplete="off" style="flex:1;min-width:200px;padding:11px 14px;border:1px solid var(--line);border-radius:10px;font:inherit"><button class="btn ghost sm" id="tu_g" type="button">Δημιουργία κωδικού</button><button class="btn sm" id="tu_c" type="button">Δημιουργία</button></div><p class="err" id="tu_err" role="alert" hidden></p></div>
<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px"><input id="q" type="search" placeholder="Αναζήτηση email, γραφείο, κατάσταση, πλάνο" style="flex:1;min-width:220px;padding:11px 14px;border:1px solid var(--line);border-radius:10px;font:inherit"><button class="btn sm" id="rf" type="button">Ανανέωση από Stripe</button><a class="btn ghost sm" href="/api/admin/customers.csv">Λήψη CSV</a></div>
<div style="overflow:auto;background:#fff;border:1px solid var(--line);border-radius:14px"><table id="t" style="width:100%;border-collapse:collapse;font-size:.92rem"></table></div>
<script>
const e=s=>String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const d=s=>s?new Date(s).toLocaleString("el-GR",{dateStyle:"short",timeStyle:"short"}):"—";
const ST={active:"Ενεργή",ending:"Λήγει (ακυρώθηκε)",past_due:"Καθυστέρηση",cancelled:"Ακυρωμένη",none:"Χωρίς πλάνο",free:"Δωρεάν"};
const PL={month:"Μηνιαίο",year:"Ετήσιο"};
let DATA=[];
function draw(){const k=document.getElementById("q").value.toLowerCase();
 const rows=DATA.filter(r=>!k||[r.email,r.name,r.org,ST[r.status],PL[r.plan]].join(" ").toLowerCase().includes(k));
 document.getElementById("t").innerHTML="<tr style='text-align:left;color:#566884;font-size:.78rem;text-transform:uppercase'><th style='padding:12px 14px'>Email</th><th>Γραφείο</th><th>Σύνδεση με</th><th>Κατάσταση</th><th>Πλάνο</th><th>Ισχύει έως</th><th>Εγγραφή</th><th>Τελευταία σύνδεση</th><th>Συνδέσεις</th><th></th></tr>"+
 (rows.map(r=>"<tr style='border-top:1px solid #e3e9f2'><td style='padding:12px 14px'>"+e(r.email)+(r.role==="owner"?" ★":"")+"</td><td>"+e(r.org)+"</td><td>"+e(r.signin)+"</td><td><span style='background:#eef2f7;border-radius:999px;padding:3px 10px;font-weight:700;font-size:.8rem'>"+e(ST[r.status])+"</span></td><td>"+e(PL[r.plan]||"—")+(r.seats?" +"+r.seats+" θέσ.":"")+"</td><td>"+(r.sub_until?d(r.sub_until).split(",")[0]:"—")+"</td><td>"+d(r.created)+"</td><td>"+d(r.last_login)+"</td><td>"+(r.logins||0)+"</td><td style='white-space:nowrap;padding-right:12px'><a class='btn ghost sm' href='/admin/user/"+r.id+"'>Διαχείριση</a></td></tr>").join("")||"<tr><td style='padding:18px 14px' colspan='10'>Κανένας πελάτης ακόμη.</td></tr>");}
async function load(){const j=await (await fetch("/api/admin/customers")).json();DATA=j.rows;const st=j.stats;
 const tl=[["Χρήστες",st.users],["Γραφεία",st.offices],["Ενεργές συνδρομές",st.active],["Ετήσιες",st.yearly],["Μηνιαίες",st.monthly],["Ακυρωμένες",st.cancelled],["Χωρίς πλάνο ακόμη",st.none],["Νέοι, 7 ημέρες",st.week],["Μηνιαία επαναλαμβανόμενα έσοδα","€"+(st.mrr_cents/100).toLocaleString("el-GR",{minimumFractionDigits:2,maximumFractionDigits:2})]];
 document.getElementById("tiles").innerHTML=tl.map(x=>"<div style='background:#fff;border:1px solid var(--line);border-radius:14px;padding:14px 16px'><div style='font-size:1.7rem;font-weight:800'>"+e(x[1])+"</div><div class='mut' style='font-size:.85rem'>"+e(x[0])+"</div></div>").join("");draw();}
document.getElementById("q").addEventListener("input",draw);

document.getElementById("rf").addEventListener("click",async b=>{const el=b.target;el.disabled=true;el.textContent="Ανανέωση…";try{await fetch("/api/admin/refresh",{method:"POST"});await load();}finally{el.disabled=false;el.textContent="Ανανέωση από Stripe";}});
document.getElementById("tu_g").onclick=()=>{const a="abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";let p="";for(let i=0;i<12;i++)p+=a[crypto.getRandomValues(new Uint32Array(1))[0]%a.length];document.getElementById("tu_p").value=p;};
document.getElementById("tu_c").onclick=async()=>{const er=document.getElementById("tu_err");er.hidden=true;const email=document.getElementById("tu_e").value,pw=document.getElementById("tu_p").value;
 const j=await (await fetch("/api/admin/test-user",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,password:pw})})).json();
 if(j.ok){alert("Δημιουργήθηκε. Email: "+email+"\\nΚωδικός: "+pw+"\\n\\nΣυνδεθείτε στο /login με email και κωδικό.");document.getElementById("tu_e").value="";document.getElementById("tu_p").value="";load();}else{er.textContent=j.error||"Σφάλμα";er.hidden=false;}};
load();
</script></main>`));
  });
  app.post("/api/admin/comp", async (req, res) => { const r = await pool.query("UPDATE orgs SET comp=$2 WHERE id=$1 AND id <> 1", [Number(req.body.org), !!req.body.comp]); res.json({ ok: !!r.rowCount }); });
  // Removal request from an advertiser: the ad (by link) or every ad with that phone number stops showing, and stays hidden if it is read again.
  app.post("/api/admin/block", async (req, res) => {
    const key = String(req.body.key || "").trim(); if (key.length < 6) return res.status(400).json({ error: "key = listing url or phone" });
    await pool.query("INSERT INTO blocked(key) VALUES ($1) ON CONFLICT DO NOTHING", [key]);
    const r = await pool.query("SELECT count(*)::int AS n FROM listings WHERE url=$1 OR phone=$1", [key]);
    res.json({ ok: true, hidden: r.rows[0].n });
  });

}
