// Pulls extra facts from an ad page that is already open (Spiti24 / Spitogatos): dates, address, description, characteristics.
const clean = (s) => String(s || "").replace(/[ \t]+/g, " ").trim();
const LABELS = new Set(["Περιοχή", "Διεύθυνση", "Ζώνη", "Έτος κατασκευής", "Θέρμανση", "Σύστημα θέρμανσης", "Ενεργειακή κλάση", "Όροφος", "Επίπεδα", "Πάρκινγκ", "Κουζίνες", "Καθιστικά", "Σαλόνια", "Μπάνια", "WC", "Κατάσταση", "Κατασκευή", "Χρήση", "Εμβαδόν οικοπέδου", "Μεσιτική αμοιβή", "Διαθέσιμο από", "Τιμή ανά τ.μ.", "Εμβαδόν", "Κωδικός Συστήματος", "Δημοσίευση αγγελίας", "Τελευταία ενημέρωση", "Κωδικός ακινήτου"]);
const HEAD = new Set(["Εσωτερικό", "Εξωτερικά χαρακτηριστικά", "Περισσότερα στοιχεία", "Χαρακτηριστικά", "Λεπτομέρειες ακινήτου"]);
const date = (t, re) => (t.match(re) || [])[1] || "";

const MONTHS = { "Ιανουαρίου": 1, "Φεβρουαρίου": 2, "Μαρτίου": 3, "Απριλίου": 4, "Μαΐου": 5, "Ιουνίου": 6, "Ιουλίου": 7, "Ιουλίου ": 7, "Αυγούστου": 8, "Σεπτεμβρίου": 9, "Οκτωβρίου": 10, "Νοεμβρίου": 11, "Δεκεμβρίου": 12 };
export function xeDetails(text) {
  const lines = String(text || "").split("\n").map(clean).filter(Boolean);
  const flat = lines.join(" ");
  const out = { published: "", updated: "", desc: "", address: "", facts: [], extras: [] };
  const d = flat.match(/Τελευταία δημοσίευση:\s*(\d{1,2}) (\S+) (\d{4})/);
  if (d && MONTHS[d[2]]) out.updated = `${String(d[1]).padStart(2, "0")}/${String(MONTHS[d[2]]).padStart(2, "0")}/${d[3]}`;
  const a = flat.match(/Τοποθεσία ακινήτου (.+?)(?: Χαρακτηριστικά αγγελίας| Πληροφορίες αγγελιοδότη|$)/);
  if (a && !/^Χαρακτηριστικά|δημοσίευση|Πληροφορίες/.test(a[1])) out.address = a[1].replace(/, Ελλάδα$/, "").slice(0, 120);
  const facts = new Map(), put = (k, v) => { if (v && !facts.has(k)) facts.set(k, v); };
  // the summary under the title: floor, bedrooms, bathrooms
  const top = lines.slice(0, Math.max(0, lines.findIndex((l) => /^Χαρακτηριστικά ακινήτου$/.test(l))));
  const fl = top.find((l) => /^(Υπόγ|Ημιυπ|Ισόγ|Ημιόρ|Ημιώρ|\d+ος)/.test(l) && l.length < 40); if (fl) put("Όροφος", fl);
  const bd = top.find((l) => /^\d+ υ\/δ$/.test(l)); if (bd) put("Υπνοδωμάτια", bd.replace(/\D/g, ""));
  const bt = top.find((l) => /^\d+ μπ\.$/.test(l)); if (bt) put("Μπάνια", bt.replace(/\D/g, ""));
  // every characteristics group (the page shows them one per line once "Δες όλα τα χαρακτηριστικά" is pressed)
  const i0 = lines.findIndex((l) => /^Βασικά χαρακτηριστικά$/.test(l));
  let i1 = lines.findIndex((l, i) => i > i0 && /^(Περιγραφή ακινήτου|Τοποθεσία ακινήτου|Χαρακτηριστικά αγγελίας)$/.test(l));
  if (i0 >= 0) {
    if (i1 < 0) i1 = Math.min(lines.length, i0 + 80);
    const blk = lines.slice(i0 + 1, i1);
    for (let i = 0; i < blk.length; i++) {
      const l = blk[i];
      if (/^\d+ χαρακτηριστικ/.test(l) || /^(Δες όλα|Λιγότερα) /.test(l) || /^\d+ χαρακτηριστικ/.test(blk[i + 1] || "")) continue;   // counters, the toggle and group titles
      const m = l.match(/^([^:]{2,40}):\s*(.+)$/);
      if (!m) { if (l.length < 40) out.extras.push(l); continue; }
      let k = m[1].trim(), v = m[2].trim();
      if (/^Τιμή/.test(k)) continue;
      if (/^Έτος (κατασκευής|ανακαίνισης)$/.test(k)) v = (v.match(/^\d{4}/) || [""])[0];
      else if (/^(Υπνοδωμάτια|Μπάνια|WC|Επίπεδα)$/.test(k)) v = (v.match(/^\d+/) || [""])[0];
      if (k === "Parking") k = "Πάρκινγκ";
      if (k === "Μέσο θέρμανσης") k = "Θέρμανση";
      put(k, v.slice(0, 80));
    }
  }
  out.facts = [...facts];
  out.extras = [...new Set(out.extras)].slice(0, 30);
  return out.facts.length || out.address ? out : null;
}

export async function extractDetails(page, key) {
  if (key === "xe") {   // a JS app: wait for the ad to draw, then open the full characteristics list
    await page.locator('[data-testid="property-summary"]').first().waitFor({ timeout: 8000 }).catch(() => {});
    const more = page.locator('[data-testid="show_all_characteristics_btn"]').first();
    if (await more.count().catch(() => 0)) { await more.click({ timeout: 3000, force: true }).catch(() => {}); await page.waitForTimeout(600); }
  }
  const text = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  if (!text) return null;
  if (key === "xe") return xeDetails(text);
  const lines = text.split("\n").map(clean).filter(Boolean);
  const idx = (re, from = 0) => { for (let i = from; i < lines.length; i++) if (re.test(lines[i])) return i; return -1; };
  const flat = lines.join("\n");
  const out = { published: date(flat, /Δημοσίευση αγγελίας:?\s*(\d\d\/\d\d\/\d{4})/), updated: date(flat, /Τελευταία [Εε]νημέρωση:?\s*(\d\d\/\d\d\/\d{4})/), desc: "", address: "", facts: [], extras: [] };
  let dStart, dEnd, fStart, fEnd;
  if (key === "spiti24") {
    const code = idx(/^Κωδικός ακινήτου/);
    dStart = code >= 0 ? code + 1 : idx(/^Περιγραφή$/) + 1;
    dEnd = idx(/^Λεπτομέρειες ακινήτου$/, dStart);
    fStart = dEnd + 1; fEnd = idx(/^Τοποθεσία$/, fStart);
  } else {
    dStart = idx(/^Περιγραφή$/) + 1;
    dEnd = idx(/^Χαρακτηριστικά$/, dStart);
    fStart = dEnd + 1; fEnd = idx(/^Τοποθεσία$/, fStart);
  }
  if (dStart > 0 && dEnd > dStart) out.desc = lines.slice(dStart, dEnd).filter((l) => !/^(Δημοσίευση αγγελίας|Τελευταία [Εε]νημέρωση|Κωδικός)/.test(l) && !/^[\d/]+$/.test(l)).join(" ").slice(0, 0);
  if (fStart > 0 && fEnd > fStart) {
    const blk = lines.slice(fStart, fEnd);
    for (let i = 0; i < blk.length; i++) {
      const l = blk[i];
      if (HEAD.has(l) || /^Τιμή( €|$)/.test(l)) { if (/^Τιμή/.test(l)) i++; continue; }
      if (LABELS.has(l) && blk[i + 1] !== undefined) { out.facts.push([l, blk[++i]]); continue; }
      const m = [...LABELS].find((x) => l.startsWith(x + " ") && l.length > x.length + 1);   // label and value on one line
      if (m) { out.facts.push([m, l.slice(m.length + 1)]); continue; }
      if (l.length < 40 && !/^[\d(]|%|Χρηματοδότησέ|^Τιμή/.test(l)) out.extras.push(l);
    }
    const a = out.facts.find(([k]) => k === "Διεύθυνση"); if (a) out.address = a[1];
    out.facts = out.facts.filter(([k]) => !["Διεύθυνση", "Δημοσίευση αγγελίας", "Τελευταία ενημέρωση", "Τιμή ανά τ.μ.", "Εμβαδόν", "Κωδικός Συστήματος", "Κωδικός ακινήτου"].includes(k));
  }
  if (!out.address && fEnd > 0) { const t = lines[fEnd + 1]; if (t && key === "spitogatos") out.address = lines[fEnd + 2] || ""; }
  out.extras = [...new Set(out.extras)].slice(0, 30);
  return out.facts.length || out.updated ? out : null;
}
