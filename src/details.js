// Pulls extra facts from an ad page that is already open (Spiti24 / Spitogatos): dates, address, description, characteristics.
const clean = (s) => String(s || "").replace(/[ \t]+/g, " ").trim();
const LABELS = new Set(["Περιοχή", "Διεύθυνση", "Ζώνη", "Έτος κατασκευής", "Θέρμανση", "Σύστημα θέρμανσης", "Ενεργειακή κλάση", "Όροφος", "Επίπεδα", "Πάρκινγκ", "Κουζίνες", "Καθιστικά", "Σαλόνια", "Μπάνια", "WC", "Κατάσταση", "Κατασκευή", "Χρήση", "Εμβαδόν οικοπέδου", "Μεσιτική αμοιβή", "Διαθέσιμο από", "Τιμή ανά τ.μ."]);
const HEAD = new Set(["Εσωτερικό", "Εξωτερικά χαρακτηριστικά", "Περισσότερα στοιχεία", "Χαρακτηριστικά", "Λεπτομέρειες ακινήτου"]);
const date = (t, re) => (t.match(re) || [])[1] || "";

export async function extractDetails(page, key) {
  const text = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  if (!text) return null;
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
  if (dStart > 0 && dEnd > dStart) out.desc = lines.slice(dStart, dEnd).filter((l) => !/^(Δημοσίευση αγγελίας|Τελευταία [Εε]νημέρωση|Κωδικός)/.test(l)).join(" ").slice(0, 700);
  if (fStart > 0 && fEnd > fStart) {
    const blk = lines.slice(fStart, fEnd);
    for (let i = 0; i < blk.length; i++) {
      const l = blk[i];
      if (HEAD.has(l) || /^Τιμή( €|$)/.test(l)) { if (/^Τιμή/.test(l)) i++; continue; }
      if (LABELS.has(l) && blk[i + 1] !== undefined) { out.facts.push([l, blk[++i]]); continue; }
      const m = [...LABELS].find((x) => l.startsWith(x + " ") && l.length > x.length + 1);   // label and value on one line
      if (m) { out.facts.push([m, l.slice(m.length + 1)]); continue; }
      if (l.length < 40) out.extras.push(l);
    }
    const a = out.facts.find(([k]) => k === "Διεύθυνση"); if (a) out.address = a[1];
    out.facts = out.facts.filter(([k]) => !["Διεύθυνση", "Διαθέσιμο από", "Δημοσίευση αγγελίας", "Τελευταία ενημέρωση", "Τιμή ανά τ.μ."].includes(k));
  }
  if (!out.address && fEnd > 0) { const t = lines[fEnd + 1]; if (t && key === "spitogatos") out.address = lines[fEnd + 2] || ""; }
  out.extras = [...new Set(out.extras)].slice(0, 30);
  return out.desc || out.facts.length || out.updated ? out : null;
}
