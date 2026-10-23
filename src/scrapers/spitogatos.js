import { guardCaptcha } from "./indomio.js";
// Needs the paid login: ads with no agency link (/mesites/) are private owners.

export const AREAS = ["athina-kentro", "athina-voreia-proastia", "athina-notia-proastia", "athina-dytika-proastia", "athina-anatolika-proastia", "peiraias", "proastia-peiraia", "ypoloipo-attikis"];

// Runs INSIDE the page (same origin, logged-in cookies): reads list pages from..to of one area / filter and returns the owner ads found.
export async function readPages({ area, filter, from, to, delay, prevIds }) {
  const ATH = ["Αθήνα - Κέντρο", "Κολωνάκι - Λυκαβηττός", "Κολωνός - Κολοκυνθούς"], PIR = ["Κέντρο - Λιμάνι", "Καλλίπολη – Φρεαττύδα", "Πειραιάς"];
  const loc = (s) => {
    const m = s.match(/^(.*)\((.*)\)\s*$/); if (!m) return s;
    const h = m[1].trim(); let u = m[2].trim();
    if (ATH.includes(u)) u = "Αθήνα"; else if (PIR.includes(u)) u = "Πειραιάς";
    return (h === u || h.startsWith(u)) ? u : u + " (" + h + ")";
  };
  const out = []; const seen = new Set();
  let prev = prevIds || "", read = 0, ended = false, blocked = false, status = 200;
  for (let p = from; p <= to; p++) {
    const res = await fetch(`/pwliseis-katoikies/${area}/${filter}order_datemodified_desc` + (p > 1 ? `/selida_${p}` : ""), { credentials: "include" });
    status = res.status;
    if (!res.ok) { if (res.status === 404 || res.status === 410) ended = true; else blocked = true; break; }
    const d = new DOMParser().parseFromString(await res.text(), "text/html");
    const arts = [...d.querySelectorAll("article")];
    const ids = arts.map((c) => (c.querySelector('a[href*="/aggelia/"]')?.getAttribute("href") || "").match(/aggelia\/(\d+)/)?.[1] || "").filter(Boolean).join(",");
    if (!arts.length || ids === prev) { ended = true; break; }   // empty page, or the site repeated the last page
    prev = ids; read++;
    for (const c of arts) {
      if (c.querySelector('a[href*="/mesites/"]')) continue;
      const t = c.querySelector("h3.tile__title")?.textContent.trim();
      const id = (c.querySelector('a[href*="/aggelia/"]')?.getAttribute("href") || "").match(/aggelia\/(\d+)/)?.[1];
      if (!t || !id || seen.has(id)) continue;
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
    await new Promise((r) => setTimeout(r, delay + Math.random() * delay));
  }
  return { out, read, ended, blocked, status, lastIds: prev };
}

// Daily: (1) ads first published in the last 24 h, (2) every ad whose price was reduced (this also catches old ads that dropped their price).
export async function scrapeSpitogatos(page) {
  await page.goto("https://www.spitogatos.gr/pwliseis-katoikies/athina-kentro/prwti_dimosieusi_24wres/order_datemodified_desc", { waitUntil: "load", timeout: 45000 });
  await page.waitForTimeout(3000);
  await guardCaptcha(page, "Spitogatos");
  const byId = new Map();
  for (const [filter, cap] of [["prwti_dimosieusi_24wres/", 20], ["meiwmeni_timi/", 60]]) {
    for (const area of AREAS) {
      let from = 1, prevIds = "";
      while (from <= cap) {
        const r = await page.evaluate(readPages, { area, filter, from, to: Math.min(from + 19, cap), delay: 1200, prevIds });
        for (const a of r.out) if (!byId.has(a.id)) byId.set(a.id, a);
        if (r.blocked) throw Object.assign(new Error(`Spitogatos answered ${r.status} while reading ${area}`), { code: "error" });
        console.log(`[sg] ${filter || "all/"}${area}: ${from}-${from + r.read - 1}${r.ended ? " (end)" : ""}`);
        if (r.ended) break;
        from += 20; prevIds = r.lastIds;
      }
    }
  }
  return [...byId.values()];
}
