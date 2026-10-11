import { kvGet, kvSet } from "./db.js";

// Sessions for the two paid sites are kept in the database so a login is only needed when the session expires.
export async function loadState(site) {
  const saved = await kvGet("session:" + site);
  if (saved) return saved;
  const raw = process.env[site.toUpperCase() + "_COOKIES"];           // optional: JSON array exported from a signed-in browser
  if (raw) { try { return { cookies: JSON.parse(raw), origins: [] }; } catch { /* ignore bad JSON */ } }
  return undefined;
}
export const saveState = async (site, context) => kvSet("session:" + site, await context.storageState());

const needsLogin = async (page) =>
  /login|signin|sign-in|auth|connect/i.test(new URL(page.url()).pathname + new URL(page.url()).search) ||
  (await page.locator('input[type="password"]:visible').count()) > 0;

export async function ensureLogin(page, context, { site, label, home, probe }) {
  await page.goto(probe, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  await captchaCheck(page, label);
  if (!(await needsLogin(page))) return "session";

  const user = process.env[site.toUpperCase() + "_USER"], pass = process.env[site.toUpperCase() + "_PASS"];
  if (!user || !pass) throw err("login", `${label}: signed out and no ${site.toUpperCase()}_USER / ${site.toUpperCase()}_PASS set in Railway variables.`);

  if ((await page.locator('input[type="password"]:visible').count()) === 0) {
    await page.goto(home, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /Σύνδεση|Είσοδος|Log ?in|Sign ?in/i }).first().click({ timeout: 8000 }).catch(() =>
      page.getByRole("link", { name: /Σύνδεση|Είσοδος|Log ?in|Sign ?in/i }).first().click({ timeout: 8000 }));
    await page.waitForTimeout(2000);
  }
  await captchaCheck(page, label);
  const pw = page.locator('input[type="password"]:visible').first();
  const email = page.locator('input[type="email"]:visible, input[name*="mail" i]:visible, input[name*="user" i]:visible, input[autocomplete="username"]:visible, input[type="text"]:visible').first();
  await email.fill(user, { timeout: 8000 });
  await pw.fill(pass, { timeout: 8000 });
  await pw.press("Enter");
  await page.waitForTimeout(5000);
  await captchaCheck(page, label);
  await page.goto(probe, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  if (await needsLogin(page)) throw err("login", `${label}: login did not work (wrong password, a login code was requested, or the form changed).`);
  await saveState(site, context);
  return "login";
}

async function captchaCheck(page, label) {
  if ((await page.locator('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="turnstile"], #challenge-form').count()) > 0)
    throw err("captcha", `${label}: bot check (CAPTCHA) appeared. Not bypassed. Refresh the session cookie in Railway.`);
}
const err = (code, message) => Object.assign(new Error(message), { code });
