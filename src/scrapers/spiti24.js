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
          img: /spitogatos\.gr\/\d{5,}_/.test(r.querySelector("img")?.getAttribute("data-src") || r.querySelector("img")?.getAttribute("src") || ""), photo: (r.querySelector("img")?.getAttribute("data-src") || r.querySelector("img")?.getAttribute("src") || "").replace(/^http:/, "https:"),
        });
      }
      await new Promise((r) => setTimeout(r, 1200));
    }
    return out;
  });
}

// Land (οικόπεδα / αγροτεμάχια) from private owners, all of Greece. Region pages are discovered from the site itself.
// First run reads every page (backfill); later runs only the newest pages of each region (the list is sorted by last change).
export async function scrapeSpiti24Land(page, { maxPages = 3, maxMs = 20 * 60 * 1000, agency = false, start = 0 } = {}) {
  await page.goto("https://www.spiti24.gr/epaggelmatika-akinita", { waitUntil: "load", timeout: 45000 });
  await page.waitForTimeout(2500);
  await guardCaptcha(page, "Spiti24");
  const res = await page.evaluate(async ({ maxPages, maxMs, agency, start }) => {
    const t0 = Date.now(), out = [], seen = new Set(); let complete = true, next = 0;
    const sl = [...new Set([...document.querySelectorAll("a[href]")].map((a) => (a.getAttribute("href").match(/pwliseis\/epaggelmatika-akinita\/([a-z0-9-]+)\/?$/) || [])[1]).filter(Boolean))];
    next = sl.length;
    for (let si = start; si < sl.length; si++) {
      const slug = sl[si];
      if (Date.now() - t0 > maxMs) { complete = false; next = si; break; }
      for (let p = 1; p <= maxPages; p++) {
        if (Date.now() - t0 > maxMs) { complete = false; break; }
        let h; try { const r = await fetch(`/pwliseis/gi/${slug}${agency ? "" : "/apo-idiotes"}?sortBy=datemodified%7Cdesc` + (p > 1 ? "&page=" + p : "")); if (!r.ok) break; h = await r.text(); } catch { break; }
        const d = new DOMParser().parseFromString(h, "text/html");
        const rowsOnPage = [...d.querySelectorAll(".property[id^=result-row]")];
        if (!rowsOnPage.length) break;
        let fresh = 0;
        for (const r of rowsOnPage) {
          const isOwner = !!r.querySelector('[title="Αγγελία από ιδιώτη"]');
          if (isOwner === agency) continue;   // owner pass keeps owners, agency pass keeps everything else
          const id = (r.dataset.targeturl || "").match(/(\d{6,})/)?.[1]; if (!id || seen.has(id)) continue;
          seen.add(id); fresh++;
          const P = [...r.querySelectorAll(".property__title__parts li")].map((l) => l.textContent.replace(/\s+/g, " ").trim());
          const t = P[0] || "";
          const src = r.querySelector("img")?.getAttribute("data-src") || r.querySelector("img")?.getAttribute("src") || "";
          out.push({
            id: "s24-" + id, source: "spiti24", url: "https://www.spiti24.gr/" + id, category: "land", seller: agency ? "agency" : "owner",
            type: t.replace(/\s*[\d.]+\s*m2.*$/, "").replace(/\s*προς πώληση.*$/, "").trim(), sqm: +((t.match(/([\d.]+)\s*m2/) || [])[1] || "").replace(/\./g, "") || null,
            price: +(r.querySelector(".property__price")?.textContent || "").replace(/\D/g, "") || null, floor: "", beds: null, year: null,
            location: (P[1] || "").trim(), multi: false, posted: "", img: /spitogatos\.gr\/\d{5,}_/.test(src), photo: src.replace(/^http:/, "https:"),
          });
        }
        if (!fresh && p > 1) break;
        await new Promise((r) => setTimeout(r, 900));
      }
    }
    return { out, complete, next };
  }, { maxPages, maxMs, agency, start });
  res.out.complete = res.complete; res.out.next = res.next; return res.out;
}
