import {
  parseGeneric,
  parseDate,
  extractCardEnding,
  normalizeDigitChars,
} from "./generic.js";


function normalize(t = "") {
  return String(t).replace(/\u00A0/g, " ").replace(/\r/g, "");
}

// Amount helpers
function lastNumTok(s) {
  const m = [...String(s || "").matchAll(/\d[\d,]*\.\d{2}/g)];
  return m.length ? m[m.length - 1][0] : null;
}
function parseMoneyFromText(s) {
  const tok = lastNumTok(s);
  if (!tok) return null;
  const n = parseFloat(tok.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}
function valueOnSameOrNextLine(text, labelRegex) {
  const lines = String(text).split(/\n/);
  for (let i = 0; i < lines.length; i++) {
    if (labelRegex.test(lines[i])) {
      const same = parseMoneyFromText(lines[i]);
      if (same != null) return same;
      for (let j = i + 1; j <= Math.min(i + 2, lines.length - 1); j++) {
        const n = parseMoneyFromText(lines[j]);
        if (n != null) return n;
      }
      break;
    }
  }
  return null;
}

// Date helpers
function firstDateToken(s) {
  const m =
    String(s || "").match(/(\d{1,2}[ \/\-](?:[A-Za-z]{3}|[01]?\d)[A-Za-z]*[ \/\-]\d{2,4})/) ||
    String(s || "").match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/);
  return m ? m[1] : null;
}
function valueOnSameOrNextLineDate(text, labelRegex) {
  const lines = String(text).split(/\n/);
  for (let i = 0; i < lines.length; i++) {
    if (labelRegex.test(lines[i])) {
      const sameTok = firstDateToken(lines[i]);
      if (sameTok) return parseDate(sameTok);
      for (let j = i + 1; j <= Math.min(i + 2, lines.length - 1); j++) {
        const tok = firstDateToken(lines[j]);
        if (tok) return parseDate(tok);
      }
      break;
    }
  }
  return null;
}


function extractAxisTotalAmount(text) {
  const h = normalize(text).slice(0, 20000);


  let m = h.match(/total\s*payment\s*due[^\n]*?(\d[\d,]*\.\d{2})/i);
  if (m) {
    const n = parseFloat(m[1].replace(/,/g, ""));
    if (Number.isFinite(n)) return n;
  }


  const n1 = valueOnSameOrNextLine(h, /total\s*payment\s*due\b/i);
  if (n1 != null) return n1;


  const n2 = valueOnSameOrNextLine(h, /total\s*(?:amount\s*)?due\b/i);
  if (n2 != null) return n2;

  const n3 = valueOnSameOrNextLine(h, /amount\s*payable\b/i);
  if (n3 != null) return n3;

  return null;
}


function extractAxisDueDate(text) {
  const h = normalize(text).slice(0, 20000);


  const d1 =
    valueOnSameOrNextLineDate(h, /payment\s*due\s*date\b/i) ||
    valueOnSameOrNextLineDate(h, /\bdue\s*date\b/i) ||
    valueOnSameOrNextLineDate(h, /pay\s*by\b/i);
  if (d1) return d1;


  const m = h.match(/payment\s*due\s*date[^\n]*?(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i);
  if (m) {
    const d = parseDate(m[1]);
    if (d) return d;
  }
  return null;
}

function addDaysISO(isoDate, days) {
  if (!isoDate) return null;
  const dt = new Date(isoDate + "T00:00:00Z");
  if (isNaN(dt)) return null;
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}


function computeFallbackTotalFromTx(tx = []) {
  if (!Array.isArray(tx) || !tx.length) return null;
  let drSum = 0;
  for (const t of tx) {
    const a = Number(t?.amount);
    if (!Number.isFinite(a)) continue;
    if (a < 0) drSum += Math.abs(a); // our parser stores debits as negative
  }
  return +drSum.toFixed(2);
}

function findMaskedLast4Everywhere(text = "") {
  const t = text.slice(0, 20000);

  const patterns = [
    /(?:[xX\*\u2022•]{2,}[\s\-]*){2,}([0-9A-Za-z|]{4})\b/g, 
    /(?:\d{4}[^\d]{1,3}){3}([0-9A-Za-z|]{4})\b/g, 
    /(?:ending|ends?\s*with|last\s*4)\s*[:\-]?\s*([0-9A-Za-z|]{4})\b/gi, 
    /card\s*(?:number|no\.?)\s*[:\-]?[^\n]*?([0-9A-Za-z|]{4})\b/gi, 
  ];

  const counts = new Map();
  const boring = new Set([
    "0000",
    "1111",
    "2222",
    "3333",
    "4444",
    "5555",
    "6666",
    "7777",
    "8888",
    "9999",
  ]);

  for (const re of patterns) {
    let m;
    while ((m = re.exec(t))) {
      const raw = m[1] || "";
      const norm = normalizeDigitChars(raw).replace(/\D/g, "");
      if (/^\d{4}$/.test(norm) && !boring.has(norm)) {
        counts.set(norm, (counts.get(norm) || 0) + 1);
      }
    }
  }

  let best = null,
    bestCnt = 0;
  for (const [val, cnt] of counts) {
    if (cnt > bestCnt) {
      best = val;
      bestCnt = cnt;
    }
  }
  return best;
}

function extractCardEndingAxis(text) {

  const g = extractCardEnding(text);
  if (g) return g;


  return findMaskedLast4Everywhere(text) || null;
}

// Strict: capture last‑4 only when it appears AFTER a masked run (handles *, x, •, ●, #, ∗, etc., with spaces)
function extractAxisMaskedLast4(text = "") {
  const header = normalize(text).slice(0, 20000);
  const cands = new Set();

  const push = (raw) => {
    const v = normalizeDigitChars(String(raw || "")).replace(/\D/g, "");
    if (/^\d{4}$/.test(v)) cands.add(v);
  };


  const MASK = "[xX\\*#\\u2022\\u2217\\u2731\\u25CF\\u00B7\\u25AA\\u25AB\\u25A0\\u25A1•●▪■✱∗]";


  const re1 = new RegExp(`(?:\\d{4,8}\\s*)?(?:${MASK}\\s*){3,}\\s*([0-9A-Za-z|]{4})\\b`, "g");
  for (const m of header.matchAll(re1)) push(m[1]);


  const re2 = new RegExp(`(?:${MASK}{2,}[\\s\\-]*){2,}([0-9A-Za-z|]{4})\\b`, "g");
  for (const m of header.matchAll(re2)) push(m[1]);


  const re3 = new RegExp(`card\\s*(?:no|number)?[^\\n]*?(?:${MASK}[\\s\\-]*){2,}([0-9A-Za-z|]{4})\\b`, "gi");
  for (const m of header.matchAll(re3)) push(m[1]);


  if (cands.size === 0) {
    const maskLine = new RegExp(MASK);
    for (const line of header.split(/\n/)) {
      if (!maskLine.test(line)) continue;
      const digits = normalizeDigitChars(line).replace(/\D/g, "");
      if (digits.length >= 4) push(digits.slice(-4));
    }
  }


  const boring = new Set(["0000","1111","2222","3333","4444","5555","6666","7777","8888","9999"]);
  for (const v of cands) if (!boring.has(v)) return v;
  return cands.size ? [...cands][0] : null;
}


function extractAxisOwnerName(text = "") {
  const lines = normalize(text).slice(0, 25000).split(/\n/).map(l => l.trim()).filter(Boolean);

  const clean = (s) => s.replace(/\s{2,}/g, " ").trim();
  const STOP = /(AXIS|BANK|CREDIT|CARD|PAYMENT|SUMMARY|ACCOUNT|STATEMENT|PERIOD|DATE|DUE|MINIMUM|LIMIT|AVAILABLE|CASH|AMOUNT|GSTIN|HSN|ADDRESS|EMAIL|PHONE|STATEMENT\s*PERIOD)/i;
  const isUpperName = (s) =>
    /^[A-Z][A-Z .'\-]{5,60}$/.test(s) && /\s/.test(s) && !STOP.test(s);


  for (const line of lines.slice(0, 200)) {
    const m = line.match(/\bname\b[:\-]?\s+([A-Z][A-Z .'\-]{5,})/i);
    if (m && isUpperName(m[1])) return clean(m[1]);
  }


  const pinIdx = lines.findIndex((l) => /\b\d{6}\b/.test(l));
  if (pinIdx > 0) {
    for (let k = Math.max(0, pinIdx - 4); k < pinIdx; k++) {
      const s = lines[k];
      if (isUpperName(s)) return clean(s);
    }
  }


  for (let i = 0; i < Math.min(120, lines.length); i++) {
    if (/(card\s*(?:member|holder| owner)?\s*name|customer\s*name)\b/i.test(lines[i])) {
      for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
        const s = lines[j];
        if (isUpperName(s)) return clean(s);
      }
      break;
    }
  }


  for (const s of lines.slice(0, 80)) {
    if (isUpperName(s)) return clean(s);
  }

  return null;
}

export function parseAxis(text) {
  const base = parseGeneric(text);


  if (!base.cardOwnerName) {
    const owner = extractAxisOwnerName(text);
    if (owner) base.cardOwnerName = owner;
  }


  const axisLast4 =
    extractAxisMaskedLast4(text) ||
    (typeof extractCardEndingAxis === "function" && extractCardEndingAxis(text)) ||
    extractCardEnding(text);
  if (axisLast4 && (!base.cardEnding || base.cardEnding === "0000" || base.cardEnding === "0011")) {
    base.cardEnding = axisLast4;
  }


  if (base.totalAmountDue == null) {
    const n = extractAxisTotalAmount(text);
    if (n != null) base.totalAmountDue = n;
  }
  if (!base.paymentDueDate) {
    // Axis due date is typically ~20 days after statement end, but prefer header
    const d = extractAxisDueDate(text) || (base.statementPeriod?.to ? addDaysISO(base.statementPeriod.to, 20) : null);
    if (d) base.paymentDueDate = d;
  }


  const lines = (text || "")
    .replace(/\u00A0/g, " ")
    .split(/\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const tx = [];
  const dateAtStart =
    /^(\d{1,2}[\/\- ](?:[A-Za-z]{3}|[01]?\d)[A-Za-z]*[\/\- ]\d{2,4})\s+(.+)$/i;

  const isCRToken = (s) => /\b(CR|CREDIT)\b/i.test(s);
  const isDRToken = (s) =>
    /\b(DR|DEBIT)\b/i.test(s) || /(?:^|[^A-Z])([0O]r|Or|o\.|d\.)\s*$/i.test(s);

  for (const line of lines) {
    const m = line.match(dateAtStart);
    if (!m) continue;
    const dISO = parseDate(m[1]);
    const rest = m[2];
    const amtMatch = [...rest.matchAll(/\d[\d,]*\.\d{2}/g)];
    if (!amtMatch.length) continue;
    const amtTok = amtMatch[amtMatch.length - 1][0];
    let amt = parseFloat(amtTok.replace(/,/g, ""));
    if (isNaN(amt)) continue;
    if (isDRToken(line) && !isCRToken(line)) amt = -amt;
    const cutIdx = rest.lastIndexOf(amtTok);
    const desc = (cutIdx > 0 ? rest.slice(0, cutIdx) : rest)
      .replace(/\s{2,}/g, " ")
      .trim();
    tx.push({ date: dISO, description: desc || null, amount: amt });
  }

  if (tx.length) base.transactions = tx;


  if (base.totalAmountDue == null && Array.isArray(base.transactions)) {
    const calc = computeFallbackTotalFromTx(base.transactions);
    if (calc != null) base.totalAmountDue = calc;
  }

  return base;
}
