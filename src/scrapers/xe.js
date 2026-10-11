import { guardCaptcha } from "./indomio.js";
// Needs the paid login. publication_origins[]=false is xe.gr's "Ιδιώτες" filter.
const URL = "https://www.xe.gr/property/results?item_type=residence&transaction_name=buy&publication_origins%5B%5D=false&country=GR&geo_place_ids%5B%5D=ChIJUwsYu2cPnxQRkIC54iy9AAE&sorting=publication_date_desc";
export async function scrapeXe(page) {
  const out = [];
  for (let p = 1; p <= 4; p++) {
    await page.goto(URL + "&page=" + p, { waitUntil: "domcontentloaded" });
    await guardCaptcha(page, "xe.gr");
    await page.waitForSelector(".common-ad", { timeout: 20000 }).catch(() => {});
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
