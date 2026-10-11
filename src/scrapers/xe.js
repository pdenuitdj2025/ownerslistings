import { guardCaptcha } from "./indomio.js";

// Cookie banner: choose the most privacy-preserving option (reject non-essential).
export async function dismissConsent(page) {
  const btn = page.getByText("ΔΙΑΦΩΝΩ", { exact: true }).first();
  if (await btn.waitFor({ state: "visible", timeout: 12000 }).then(() => true).catch(() => false)) {
    await btn.click({ timeout: 5000, force: true }).catch(() => {});
    await page.waitForTimeout(2500);
    if ((await page.getByText("ΔΙΑΦΩΝΩ", { exact: true }).count()) === 0) return true;
    await btn.dispatchEvent("click").catch(() => {});
    await page.waitForTimeout(2000);
    return true;
  }
  for (const name of [/ΔΙΑΦΩΝΩ|Απόρριψη όλων|Απόρριψη|Reject all|Μόνο τα απαραίτητα|Μόνο απαραίτητα|Αρνούμαι|Disagree/i, /Διαχείριση|Ρυθμίσεις|Settings|Options/i]) {
    const b = page.getByRole("button", { name }).first();
    if (await b.isVisible({ timeout: 2500 }).catch(() => false)) {
      await b.click({ timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(1200);
      // if we opened a settings dialog, look for a confirm/reject-all control inside it
      const save = page.getByRole("button", { name: /Απόρριψη όλων|Reject all|Αποθήκευση|Save|Confirm|Επιβεβαίωση/i }).first();
      if (await save.isVisible({ timeout: 1500 }).catch(() => false)) await save.click({ timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(800);
      return true;
    }
  }
  return false;
}
// Needs the paid login. publication_origins[]=false is xe.gr's "Ιδιώτες" filter.
const URL = "https://www.xe.gr/property/results?item_type=residence&transaction_name=buy&publication_origins%5B%5D=false&country=GR&geo_place_ids%5B%5D=ChIJUwsYu2cPnxQRkIC54iy9AAE&sorting=publication_date_desc";
export async function scrapeXe(page) {
  const out = [];
  for (let p = 1; p <= 4; p++) {
    await page.goto(URL + "&page=" + p, { waitUntil: "domcontentloaded" });
    await guardCaptcha(page, "xe.gr");
    await dismissConsent(page);
    await page.waitForSelector(".common-ad", { timeout: 20000 }).catch(() => {});
    console.log("[xe] page", p, "common-ad:", await page.locator(".common-ad").count(), "| consent still shown:", await page.getByText("ΔΙΑΦΩΝΩ").count());
    for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, 1500); await page.waitForTimeout(350); }
    const ads = await page.evaluate(() => [...document.querySelectorAll(".common-ad")].map((c) => {
      const a = c.querySelector('a[data-testid="property-ad-url"]') || c.querySelector('a[href*="/property/"]');
      const lines = c.innerText.split("\n").map((s) => s.trim()).filter(Boolean);
      const title = lines.find((l) => /τ\.μ\./.test(l)) || "";
      const price = (lines.find((l) => /€/.test(l)) || "").replace(/[^\d]/g, "");
      const flag = lines.find((l) => /Αγγελία ιδιώτη|Πολλαπλές αγγελίες/.test(l)) || "";
      const fi = lines.indexOf(flag);
      return {
        id: c.id, source: "xe", url: a ? new window.URL(a.getAttribute("href"), location.origin).href.split("?")[0] : "",
        type: title.replace(/\s*[\d.]+\s*τ\.μ\./, "").trim(),
        sqm: +((title.match(/([\d.]+)\s*τ\.μ\./) || [])[1] || "").replace(/\./g, "") || null,
        price: price ? +price : null,
        floor: lines.find((l) => /^(\d+ος|Ισόγ\.|Υπόγ\.|Ημιυπ\.|Ημιόρ\.)/.test(l)) || "",
        beds: +(lines.find((l) => /υ\/δ/.test(l)) || "").replace(/\D/g, "") || null,
        year: +(lines.find((l) => /^(19|20)\d\d$/.test(l)) || 0) || null,
        location: fi > 0 ? lines[fi - 1] : "", multi: /Πολλαπλές/.test(flag),
        posted: lines.find((l) => /^Πριν|Σήμερα|Χθες/.test(l)) || "",
      };
    }).filter((x) => x.id && x.price));
    out.push(...ads);
    if (!ads.length) break;
  }
  return out;
}
