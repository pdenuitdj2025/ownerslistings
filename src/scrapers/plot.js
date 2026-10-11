import { guardCaptcha } from "./indomio.js";
export async function scrapePlot(page) {
  await page.goto("https://www.plot.gr/search/?category=20007&location=46", { waitUntil: "domcontentloaded" });
  await guardCaptcha(page, "Plot");
  return page.evaluate(async () => {
    const out = [];
    const MUNI = { 46: "Αθήνα", 44: "Πειραιάς" };
    for (const l of [46, 32, 19, 62, 18, 44, 55, 34]) {
      const seen = new Set();
      for (let p = 1; p <= 3; p++) {
        const h = await (await fetch(`/search/?category=20007&location=${l}` + (p > 1 ? `&page=${p}` : ""))).text();
        const d = new DOMParser().parseFromString(h, "text/html");
        let added = 0;
        for (const t of d.querySelectorAll("h2.title")) {
          let c = t;
          for (let i = 0; i < 8 && c; i++) { c = c.parentElement; if (c.querySelector('a[href*="-tm-"]') && /€/.test(c.textContent)) break; }
          if (!c) continue;
          const href = c.querySelector('a[href*="-tm-"]')?.getAttribute("href") || "";
          if (/promotion/.test(href)) continue;
          const id = (href.match(/^\/(\d+)-/) || [])[1];
          if (!id || seen.has(id)) continue;
          seen.add(id); added++;
          const T = c.textContent.replace(/\s+/g, " ");
          if (!/Ιδιώτης/.test(T)) continue;
          const title = t.textContent.trim();
          const loc = (T.match(/(Αθήνα - [^»]+|Πειραιάς[^»]*|Αττική - Υπόλοιπο)\s*»\s*(.+?)(?:\s+\d+\s+(?:λεπτ|ώρ|ημέρ|μέρ)|\s+Προωθ|$)/) || []);
          const hood = (loc[2] || "").trim();
          out.push({
            id: "pl-" + id, source: "plot", url: "https://www.plot.gr" + href.split("?")[0],
            type: title.replace(/\s*[\d.]+\s*τ\.μ\..*$/, "").trim(), sqm: +((title.match(/([\d.]+)\s*τ\.μ\./) || [])[1] || "").replace(/\./g, "") || null,
            price: +((T.match(/([\d.]+)\s*€/) || [])[1] || "").replace(/\./g, "") || null,
            floor: (T.match(/τ\.μ\. (\d+ος|Ισόγειο|Ημιυπόγειο|Υπόγειο|Ημιώροφος|Υπερυψωμένο)/) || [])[1] || "",
            beds: +((T.match(/(\d+) υπνοδωμάτι/) || [])[1]) || null, year: +((T.match(/\b(19\d\d|20[0-3]\d)\b/) || [])[1]) || null,
            location: MUNI[l] && hood ? `${MUNI[l]} (${hood})` : hood, multi: false,
            posted: (T.match(/(\d+\s+(?:λεπτά|λεπτό|ώρα|ώρες|ημέρα|ημέρες|μέρες)\s+πριν)/) || [])[1] || "",
          });
        }
        if (!added) break;
        await new Promise((r) => setTimeout(r, 1200));
      }
    }
    return out;
  });
}
