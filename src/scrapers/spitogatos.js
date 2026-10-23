import { guardCaptcha } from "./indomio.js";
// Needs the paid login: ads with no agency link (/mesites/) are private owners.
export async function scrapeSpitogatos(page) {
  await page.goto("https://www.spitogatos.gr/pwliseis-katoikies/athina-kentro/prwti_dimosieusi_24wres/order_datemodified_desc", { waitUntil: "load", timeout: 45000 });
  await page.waitForTimeout(3000);
  await guardCaptcha(page, "Spitogatos");
  page.on("console", (m) => { if (m.text().startsWith("[sg]")) console.log(m.text()); });
  // Recently updated ads: go back to today (evening run) or yesterday (morning run) by their "Ανανεώθηκε" date.
  const athens = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Athens" }));
  const days = athens.getHours() < 16 ? 2 : 1;
  const cut = new Date(athens); cut.setDate(cut.getDate() - (days - 1));
  const cutoff = `${cut.getFullYear()}-${String(cut.getMonth() + 1).padStart(2, "0")}-${String(cut.getDate()).padStart(2, "0")}`;
  return page.evaluate(async (cutoff) => {
    const out = [];
    const ATH = ["Αθήνα - Κέντρο", "Κολωνάκι - Λυκαβηττός", "Κολωνός - Κολοκυνθούς"], PIR = ["Κέντρο - Λιμάνι", "Καλλίπολη – Φρεαττύδα", "Πειραιάς"];
    const loc = (s) => {
      const m = s.match(/^(.*)\((.*)\)\s*$/); if (!m) return s;
      const h = m[1].trim(); let u = m[2].trim();
      if (ATH.includes(u)) u = "Αθήνα"; else if (PIR.includes(u)) u = "Πειραιάς";
      return (h === u || h.startsWith(u)) ? u : u + " (" + h + ")";
    };
    const seen = new Set();
    const iso = (t) => { const m = (t || "").match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : ""; };
    const read = (d) => {
      const arts = [...d.querySelectorAll("article")];
      const ids = [];
      let lastDate = "";
      for (const c of arts) {
        const id = (c.querySelector('a[href*="/aggelia/"]')?.getAttribute("href") || "").match(/aggelia\/(\d+)/)?.[1];
        if (id) ids.push(id);
        const dt = iso(c.querySelector("time")?.getAttribute("datetime") || c.querySelector("time")?.textContent); if (dt) lastDate = dt;
        if (c.querySelector('a[href*="/mesites/"]')) continue;
        const t = c.querySelector("h3.tile__title")?.textContent.trim(); if (!t || !id || seen.has(id)) continue;
        seen.add(id);
        const im = c.querySelector(".img__wrap img"); const src = im?.getAttribute("data-src") || im?.getAttribute("src") || "";
        const pr = (c.querySelector(".price__text")?.textContent || "").replace(/\D/g, "");
        out.push({
          id: "sg-" + id, source: "spitogatos", url: "https://www.spitogatos.gr/aggelia/" + id,
          type: t.split(",")[0].trim(), sqm: +((t.match(/([\d.]+)\s*τ\.μ\./) || [])[1] || "").replace(/\./g, "") || null,
          price: pr ? +pr : null, floor: (c.querySelector('[title="Όροφος"]')?.textContent || "").replace(/\s+/g, ""),
          beds: null, year: null, location: loc(c.querySelector("h3.tile__location")?.textContent.trim() || ""), multi: false,
          posted: c.querySelector("time")?.textContent.trim() || "", img: /spitogatos\.gr\/\d{5,}_/.test(src),
        });
      }
      return { n: arts.length, pageIds: ids.join(","), lastDate };
    };
    const AREAS = ["athina-kentro", "athina-voreia-proastia", "athina-notia-proastia", "athina-dytika-proastia", "athina-anatolika-proastia", "peiraias", "proastia-peiraia", "ypoloipo-attikis"];
    // 1) ads first published in the last 24 h   2) every ad renewed since the cutoff date (old ads that were edited, renewed or lowered their price)
    for (const [filter, maxPages, byDate] of [["prwti_dimosieusi_24wres/", 20, false], ["", 40, true]]) {
      for (const area of AREAS) {
        let prev = "";
        for (let p = 1; p <= maxPages; p++) {
          const res = await fetch(`/pwliseis-katoikies/${area}/${filter}order_datemodified_desc` + (p > 1 ? `/selida_${p}` : ""), { credentials: "include" });
          if (!res.ok) break;
          const { n, pageIds, lastDate } = read(new DOMParser().parseFromString(await res.text(), "text/html"));
          if (n === 0 || pageIds === prev) break;   // empty page, or the site repeated the last page
          prev = pageIds;
          if (byDate && lastDate && lastDate < cutoff) { console.log(`[sg] ${area}: ${p} pages back to ${lastDate}`); break; }
          if (byDate && p === maxPages) console.log(`[sg] ${area}: stopped at page cap, last date ${lastDate}`);
          await new Promise((r) => setTimeout(r, 1500));
        }
      }
    }
    return out;
  }, cutoff);
}
