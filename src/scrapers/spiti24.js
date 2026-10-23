import { guardCaptcha } from "./indomio.js";
export async function scrapeSpiti24(page) {
  await page.goto("https://www.spiti24.gr/pwliseis/katoikies/attiki-nomos/apo-idiotes?sortBy=datemodified%7Cdesc", { waitUntil: "load", timeout: 45000 });
  await page.waitForTimeout(3000);
  await guardCaptcha(page, "Spiti24");
  return page.evaluate(async () => {
    const out = [];
    const ATH = ["Κυψέλη", "Αμπελόκηποι - Πεντάγωνο", "Λεωφόρος Πατησίων - Λεωφόρος Αχαρνών", "Ιλίσια", "Κολωνός - Κολοκυνθούς", "Παγκράτι", "Πετράλωνα", "Πολύγωνο - Τουρκοβούνια", "Νέος Κόσμος", "Μετς - Καλλιμάρμαρο", "Κουκάκι - Μακρυγιάννη", "Εξάρχεια - Νεάπολη", "Γκύζη - Πεδίον Άρεως", "Κολωνάκι - Λυκαβηττός", "Πατήσια", "Άνω Πατήσια", "Σεπόλια - Σκουζέ", "Γκάζι - Μεταξουργείο - Βοτανικός", "Κέντρο"];
    const PIR = ["Κέντρο - Λιμάνι", "Καστέλλα - Πασαλιμάνι", "Καλλίπολη – Φρεαττύδα", "Πειραϊκή - Χατζηκυριάκειο"];
    let prevFirst = "";
    for (let p = 1; p <= 25; p++) {
      const h = await (await fetch("/pwliseis/katoikies/attiki-nomos/apo-idiotes?sortBy=datemodified%7Cdesc" + (p > 1 ? "&page=" + p : ""))).text();
      const d = new DOMParser().parseFromString(h, "text/html");
      const rowsOnPage = d.querySelectorAll(".property[id^=result-row]");
      if (!rowsOnPage.length) break;
      const firstId = rowsOnPage[0].id; if (firstId === prevFirst) break;   // the site repeated the last page
      prevFirst = firstId;
      for (const r of rowsOnPage) {
        if (!r.querySelector('[title="Αγγελία από ιδιώτη"]')) continue;
        const id = (r.dataset.targeturl || "").match(/(\d{6,})/)?.[1]; if (!id) continue;
        const P = [...r.querySelectorAll(".property__title__parts li")].map((l) => l.textContent.replace(/\s+/g, " ").trim());
        const t = P[0] || "";
        const b = [...r.querySelectorAll("[title]")].find((e) => /Υπνοδωμάτι/.test(e.getAttribute("title")));
        let [mu, ...ho] = (P[1] || "").split(",").map((s) => s.trim());
        if (ATH.includes(mu)) mu = "Αθήνα"; else if (PIR.includes(mu)) mu = "Πειραιάς";
        out.push({
          id: "s24-" + id, source: "spiti24", url: "https://www.spiti24.gr/" + id,
          type: t.replace(/\s*[\d.]+\s*m2.*$/, "").trim(), sqm: +((t.match(/([\d.]+)\s*m2/) || [])[1] || "").replace(/\./g, "") || null,
          price: +(r.querySelector(".property__price")?.textContent || "").replace(/\D/g, "") || null, floor: "",
          beds: +b?.textContent.trim() || null, year: null, location: ho.length ? `${mu} (${ho.join(", ")})` : mu, multi: false, posted: "",
          img: /spitogatos\.gr\/\d{5,}_/.test(r.querySelector("img")?.getAttribute("data-src") || r.querySelector("img")?.getAttribute("src") || ""),
        });
      }
      await new Promise((r) => setTimeout(r, 1200));
    }
    return out;
  });
}
