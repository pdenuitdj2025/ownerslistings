import { guardCaptcha } from "./indomio.js";
// Needs the paid login: ads with no agency link (/mesites/) are private owners.
export async function scrapeSpitogatos(page) {
  await page.goto("https://www.spitogatos.gr/pwliseis-katoikies/athina-kentro/prwti_dimosieusi_24wres/order_datemodified_desc", { waitUntil: "load", timeout: 45000 });
  await page.waitForTimeout(3000);
  await guardCaptcha(page, "Spitogatos");
  return page.evaluate(async () => {
    const out = [];
    const ATH = ["Αθήνα - Κέντρο", "Κολωνάκι - Λυκαβηττός", "Κολωνός - Κολοκυνθούς"], PIR = ["Κέντρο - Λιμάνι", "Καλλίπολη – Φρεαττύδα", "Πειραιάς"];
    const loc = (s) => {
      const m = s.match(/^(.*)\((.*)\)\s*$/); if (!m) return s;
      const h = m[1].trim(); let u = m[2].trim();
      if (ATH.includes(u)) u = "Αθήνα"; else if (PIR.includes(u)) u = "Πειραιάς";
      return (h === u || h.startsWith(u)) ? u : u + " (" + h + ")";
    };
    for (const area of ["athina-kentro", "athina-voreia-proastia", "athina-notia-proastia", "athina-dytika-proastia", "athina-anatolika-proastia", "peiraias", "proastia-peiraia", "ypoloipo-attikis"]) {
      for (let p = 1; p <= 20; p++) {
        const res = await fetch(`/pwliseis-katoikies/${area}/prwti_dimosieusi_24wres/order_datemodified_desc` + (p > 1 ? `/selida_${p}` : ""), { credentials: "include" });
        if (!res.ok) break;
        const d = new DOMParser().parseFromString(await res.text(), "text/html");
        const arts = [...d.querySelectorAll("article")];
        for (const c of arts) {
          if (c.querySelector('a[href*="/mesites/"]')) continue;
          const t = c.querySelector("h3.tile__title")?.textContent.trim(); if (!t) continue;
          const id = (c.querySelector('a[href*="/aggelia/"]')?.getAttribute("href") || "").match(/aggelia\/(\d+)/)?.[1]; if (!id) continue;
          const pr = (c.querySelector(".price__text")?.textContent || "").replace(/\D/g, "");
          out.push({
            id: "sg-" + id, source: "spitogatos", url: "https://www.spitogatos.gr/aggelia/" + id,
            type: t.split(",")[0].trim(), sqm: +((t.match(/([\d.]+)\s*τ\.μ\./) || [])[1] || "").replace(/\./g, "") || null,
            price: pr ? +pr : null, floor: (c.querySelector('[title="Όροφος"]')?.textContent || "").replace(/\s+/g, ""),
            beds: null, year: null, location: loc(c.querySelector("h3.tile__location")?.textContent.trim() || ""), multi: false,
            posted: c.querySelector("time")?.textContent.trim() || "",
          });
        }
        if (arts.length < 30) break;
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    return out;
  });
}
