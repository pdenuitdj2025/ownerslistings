// Indomio: server-rendered pages carry the ads in __NEXT_DATA__. Owner ads have advertiser.supervisor.label === "ιδιώτης".
export async function scrapeIndomio(page) {
  await page.goto("https://www.indomio.gr/pwlhsh-katoikies/kentro-athinas-perifereia/?criterio=dataModifica&ordine=desc", { waitUntil: "load", timeout: 45000 });
  await page.waitForTimeout(3000);
  await guardCaptcha(page, "Indomio");
  return page.evaluate(async () => {
    const out = [];
    for (const a of ["kentro-athinas", "athina-voreia-proastia", "athina-notia-proastia", "athina-dytika-proastia", "athina-anatolika-proastia", "peiraias", "proastia-peiraia", "ypoloipo-attikis"]) {
      for (let p = 1; p <= 3; p++) {
        const h = await (await fetch(`/pwlhsh-katoikies/${a}-perifereia/?criterio=dataModifica&ordine=desc` + (p > 1 ? `&pag=${p}` : ""))).text();
        const m = h.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
        if (!m) break;
        let q = null;
        (function w(o) { if (!o || typeof o !== "object" || q) return; if (Array.isArray(o.results) && o.results[0]?.realEstate) { q = o; return; } for (const k in o) w(o[k]); })(JSON.parse(m[1]));
        if (!q) break;
        for (const x of q.results) {
          const e = x.realEstate;
          if (e.advertiser?.agency || e.advertiser?.supervisor?.label !== "ιδιώτης") continue;
          const pr = e.properties[0] || {}, L = pr.location || {};
          let mu = L.city || ""; const ho = L.microzone || L.macrozone || "";
          if (a === "kentro-athinas") mu = "Αθήνα"; if (a === "peiraias") mu = "Πειραιάς";
          const fl = String(pr.floor?.abbreviation || "");
          out.push({
            id: "in-" + e.id, source: "indomio", url: "https://www.indomio.gr/aggelies/" + e.id + "/",
            type: (pr.typology?.name || "").trim(), sqm: parseInt(String(pr.surface || "").replace(/\D/g, "")) || null,
            price: e.price?.value ?? null, floor: fl === "R" ? "Ρετιρέ" : (/^\d+$/.test(fl) ? fl + "ος" : fl),
            beds: parseInt(pr.bedRoomsNumber) || null, year: null,
            location: ho && ho !== mu ? `${mu} (${ho})` : mu, multi: false, posted: "",
          });
        }
        await new Promise((r) => setTimeout(r, 1200));
      }
    }
    return out;
  });
}

export async function guardCaptcha(page, name) {
  const t = (await page.title()) + " " + (await page.locator("body").innerText().catch(() => "")).slice(0, 600);
  if (/captcha|are you a robot|verify you are human|just a moment|access denied/i.test(t) || (await page.locator('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="turnstile"]').count()) > 0) {
    const e = new Error(`${name} showed a bot check (CAPTCHA). Not bypassed.`); e.code = "captcha"; throw e;
  }
}
