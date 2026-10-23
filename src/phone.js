// Reads the owner's phone number from an ad page, the way a visitor would: press "Εμφάνιση τηλεφώνου" and read what appears.
// Spitogatos and Spiti24 only (xe.gr has no reveal button).
import { pool } from "./db.js";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GR = /(?:\+?30[\s.-]?)?(69\d[\s.-]?\d{3}[\s.-]?\d{4}|2\d{2,3}[\s.-]?\d{3}[\s.-]?\d{3,4})/;

export const cleanPhone = (s) => { const m = String(s || "").match(GR); return m ? m[1].replace(/\D/g, "") : null; };

// Page is already on the ad. Returns digits or null.
export async function revealPhone(page) {
  try {
    const grab = async () => {
      const tel = await page.locator('a[href^="tel:"]').evaluateAll((els) => els.map((e) => e.getAttribute("href")));
      for (const t of tel) { const p = cleanPhone(decodeURIComponent(t.slice(4))); if (p) return p; }
      return null;
    };
    for (const css of [".fc-cta-do-not-consent", ".fc-cta-consent"]) {   // Google consent banner (Spiti24)
      const c = page.locator(css).first();
      if (await c.isVisible().catch(() => false)) { await c.click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(1000); break; }
    }
    for (const re of [/Απόρριψη όλων|Απόρριψη|Reject all/i, /Αποδοχή όλων|Αποδοχή|Συμφωνώ|Accept/i]) {   // a cookie banner can cover the button; decline first
      const c = page.getByRole("button", { name: re }).first();
      if (await c.isVisible().catch(() => false)) { await c.click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(800); break; }
    }
    const already = await grab(); if (already) return already;
    const btns = page.getByText("Εμφάνιση τηλεφώνου");
    const n = await btns.count();
    for (let i = 0; i < n; i++) {
      const b = btns.nth(i);
      if (!(await b.isVisible().catch(() => false))) continue;
      await b.click({ timeout: 5000 }).catch(() => {});
      for (let k = 0; k < 6; k++) {
        await page.waitForTimeout(700);
        const p = await grab(); if (p) return p;
        const near = await b.locator("xpath=ancestor::*[self::li or self::div][1]").innerText({ timeout: 1500 }).catch(() => "");
        const q = cleanPhone(near); if (q) return q;
      }
    }
    const body = await page.locator("body").innerText().catch(() => "");
    const m = body.match(/(?:Τηλέφωνο|Κινητό|Τηλ\.?)\s*:?\s*([+\d][\d\s.-]{8,16})/);
    return m ? cleanPhone(m[1]) : null;
  } catch { return null; }
}

// Fill in numbers for listed ads that have none yet. Gentle: small pauses, capped per run.
export async function phoneSite(page, key, { limit = 60 } = {}) {
  if (key === "xe") return { checked: 0, found: 0 };
  const { rows } = await pool.query(
    `SELECT id, url FROM listings WHERE source=$1 AND gone_at IS NULL AND img IS NOT FALSE AND phone IS NULL AND phone_checked IS NULL
      ORDER BY first_seen DESC LIMIT $2`, [key, limit]);
  let found = 0, checked = 0, misses = 0;
  for (const r of rows) {
    try {
      const resp = await page.goto(r.url, { waitUntil: "domcontentloaded", timeout: 30000 });
      if (!resp || resp.status() !== 200) { checked++; await pool.query("UPDATE listings SET phone_checked=now() WHERE id=$1", [r.id]); continue; }
      await page.waitForTimeout(1500);
      const p = await revealPhone(page);
      checked++;
      if (p) { found++; misses = 0; await pool.query("UPDATE listings SET phone=$2, phone_checked=now() WHERE id=$1", [r.id, p]); }
      else { misses++; await pool.query("UPDATE listings SET phone_checked=now() WHERE id=$1", [r.id]); if (misses >= 12 && found === 0) break; }   // the button isn't working: stop instead of hammering the site
    } catch { /* try again next run */ }
    await sleep(1500 + Math.random() * 1500);
  }
  console.log(`[phones ${key}] checked ${checked}, found ${found}`);
  return { checked, found };
}
