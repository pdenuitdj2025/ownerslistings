// Pulls extra facts from an ad page that is already open (Spiti24 / Spitogatos): dates, address, description, characteristics.
const clean = (s) => String(s || "").replace(/[ \t]+/g, " ").trim();
const LABELS = new Set(["Περιοχή", "Διεύθυνση", "Ζώνη", "Έτος κατασκευής", "Θέρμανση", "Σύστημα θέρμανσης", "Ενεργειακή κλάση", "Όροφος", "Επίπεδα", "Πάρκινγκ", "Κουζίνες", "Καθιστικά", "Σαλόνια", "Μπάνια", "WC", "Κατάσταση", "Κατασκευή", "Χρήση", "Εμβαδόν οικοπέδου", "Μεσιτική αμοιβή", "Διαθέσιμο από", "Τιμή ανά τ.μ.", "Εμβαδόν", "Κωδικός Συστήματος", "Δημοσίευση αγγελίας", "Τελευταία ενημέρωση", "Κωδικός ακινήτου"]);
const HEAD = new Set(["Εσωτερικό", "Εξωτερικά χαρακτηριστικά", "Περισσότερα στοιχεία", "Χαρακτηριστικά", "Λεπτομέρειες ακινήτου"]);
const date = (t, re) => (t.match(re) || [])[1] || "";

const MONTHS = { "Ιανουαρίου": 1, "Φεβρουαρίου": 2, "Μαρτίου": 3, "Απριλίου": 4, "Μαΐου": 5, "Ιουνίου": 6, "Ιουλίου": 7, "Ιουλίου ": 7, "Αυγούστου": 8, "Σεπτεμβρίου": 9, "Οκτωβρίου": 10, "Νοεμβρίου": 11, "Δεκεμβρίου": 12 };
export function xeDetails(text) {
  const flat = text.replace(/\s+/g, " ");
  const out = { published: "", updated: "", desc: "", address: "", facts: [], extras: [] };
  const d = flat.match(/Τελευταία δημοσίευση:\s*(\d{1,2}) (\S+) (\d{4})/);
  if (d && MONTHS[d[2]]) out.updated = `${String(d[1]).padStart(2, "0")}/${String(MONTHS[d[2]]).padStart(2, "0")}/${d[3]}`;
  const a = flat.match(/Τοποθεσία ακινήτου (.+?)(?: Χαρακτηριστικά αγγελίας| Πληροφορίες αγγελιοδότη|$)/);
  if (a) out.address = a[1].replace(/, Ελλάδα$/, "").slice(0, 120);
  const b = flat.match(/Βασικά χαρακτηριστικά(?: \d+ χαρακτηριστικά)? (.+?)(?: Δες όλα τα χαρακτηριστικά| Περιγραφή ακινήτου)/);
  if (b) {
    const labels = ["Όροφος", "Υπνοδωμάτια", "Μπάνια", "WC", "Έτος κατασκευής", "Έτος ανακαίνισης", "Ενεργειακή κλάση", "Θέρμανση", "Διαθέσιμο από", "Επίπεδα", "Κατάσταση", "Parking", "Πάρκινγκ"];
    const re = new RegExp("(" + labels.join("|") + "):\\s*(.+?)(?=\\s(?:" + labels.join("|") + "):|\\sΤιμή συζητήσιμη|$)", "g");
    for (const m of b[1].matchAll(re)) out.facts.push([m[1] === "Parking" ? "Πάρκινγκ" : m[1], m[2].trim()]);
  }
  return out.facts.length || out.address ? out : null;
}

export async function extractDetails(page, key) {
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
