import {
  parseGeneric,
  parseDate,
  extractCardEnding,
  normalizeDigitChars,
} from "./generic.js";

// Normalize whitespace
function normalize(t = "") {
  return String(t)
    .replace(/\u00A0/g, " ")
    .replace(/\r/g, "");
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
function valueOnSameOrNextLine(text, labelRegex, lookAhead = 3) {
  const lines = String(text).split(/\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!labelRegex.test(lines[i])) continue;
    const same = parseMoneyFromText(lines[i]);
    if (same != null) return same;
    for (let j = i + 1; j < Math.min(i + 1 + lookAhead, lines.length); j++) {
      const n = parseMoneyFromText(lines[j]);
      if (n != null) return n;
    }
    break;
  }
  return null;
}

// Date helpers
function firstDateToken(s) {
  const m =
    String(s || "").match(
      /(\d{1,2}[ \/\-](?:[A-Za-z]{3}|[01]?\d)[A-Za-z]*[ \/\-]\d{2,4})/
    ) || String(s || "").match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/);
  return m ? m[1] : null;
}
function valueOnSameOrNextLineDate(text, labelRegex, lookAhead = 3) {
  const lines = String(text).split(/\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!labelRegex.test(lines[i])) continue;
    const sameTok = firstDateToken(lines[i]);
    if (sameTok) return parseDate(sameTok);
    for (let j = i + 1; j < Math.min(i + 1 + lookAhead, lines.length); j++) {
      const tok = firstDateToken(lines[j]);
      if (tok) return parseDate(tok);
    }
    break;
  }
  return null;
}

// Strict masked-last4: capture only 4 digits AFTER a mask run
function extractMaskedLast4(text = "") {
  const header = normalize(text).slice(0, 20000);
  const cands = new Set();
  const push = (raw) => {
    const v = normalizeDigitChars(String(raw || "")).replace(/\D/g, "");
    if (/^\d{4}$/.test(v)) cands.add(v);
  };
  const MASK =
    "[xX\\*#\\u2022\\u2217\\u2731\\u25CF\\u00B7\\u25AA\\u25AB\\u25A0\\u25A1•●▪■✱∗]";
  const re1 = new RegExp(
    `(?:\\d{4,8}\\s*)?(?:${MASK}\\s*){3,}\\s*([0-9A-Za-z|]{4})\\b`,
    "g"
  );
  for (const m of header.matchAll(re1)) push(m[1]);
  const re2 = new RegExp(
    `(?:${MASK}{2,}[\\s\\-]*){2,}([0-9A-Za-z|]{4})\\b`,
    "g"
  );
  for (const m of header.matchAll(re2)) push(m[1]);
  const re3 = new RegExp(
    `card\\s*(?:no|number)?[^\\n]*?(?:${MASK}[\\s\\-]*){2,}([0-9A-Za-z|]{4})\\b`,
    "gi"
  );
  for (const m of header.matchAll(re3)) push(m[1]);

  if (!cands.size) {
    const maskLine = new RegExp(MASK);
    for (const line of header.split(/\n/)) {
      if (!maskLine.test(line)) continue;
      const digits = normalizeDigitChars(line).replace(/\D/g, "");
      if (digits.length >= 4) push(digits.slice(-4));
    }
  }

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
  for (const v of cands) if (!boring.has(v)) return v;
  return cands.size ? [...cands][0] : null;
}

// Owner name
function extractSbiOwnerName(text = "") {
  const h = normalize(text).slice(0, 40000);
  const lines = h
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const clean = (s) => s.replace(/\s{2,}/g, " ").trim();
  const stripTitle = (s) =>
    clean(String(s).replace(/\b(?:mr|mrs|ms|shri|smt|kumari)\.?\s+/i, ""));
  const STOP =
    /(SBI|STATE\s*BANK|ACCOUNT|SAVING|TRANSACTION|BALANCE|BRANCH|ADDRESS|EMAIL|PAN\b|KYC|SUMMARY|STATEMENT|PERIOD|DATE|AVAILABLE|CURRENT|CURRENCY|TOTAL|INTEREST|HOLDING|STATUS)/i;
  const looksLikeAddress = (s) =>
    /,/.test(s) ||
    /\b(ROAD|RD|FLOOR|FLR|BLDG|BUILDING|BLOCK|AREA|NAGAR|APARTMENT|APT|CITY|STATE|PIN|WEST|EAST|NORTH|SOUTH)\b/i.test(
      s
    );

  function isLikelyName(s) {
    if (!s) return false;
    if (STOP.test(s)) return false;
    if (/[0-9]/.test(s)) return false;
    if (/\./.test(s)) return false; // avoid initials like "I. P."
    if (looksLikeAddress(s)) return false;
    const cand = stripTitle(s);
    const toks = cand.split(/\s+/).filter(Boolean);
    if (toks.length < 2 || toks.length > 5) return false;
    const good = toks.filter((t) => /^[A-Z][A-Z'\-]{2,}$/.test(t)).length;
    return good >= 2 && cand.length <= 60;
  }

  // 1) Same-line after label
  for (const line of lines.slice(0, 120)) {
    const lab =
      line.match(/\bmy\s*name\b[:\-]?\s*(.+)$/i) ||
      line.match(/\bname\s+of\s+the\s+account\s+holder\b[:\-]?\s*(.+)$/i) ||
      line.match(/\baccount\s*holder\s*name\b[:\-]?\s*(.+)$/i);
    if (lab) {
      const cand = stripTitle(clean(lab[1]));
      if (isLikelyName(cand)) return cand;
    }
  }

  // 2) Label line, value on next 1–2 lines
  for (let i = 0; i < Math.min(200, lines.length); i++) {
    if (
      /\bmy\s*name\b/i.test(lines[i]) ||
      /\bname\s+of\s+the\s+account\s+holder\b/i.test(lines[i]) ||
      /\baccount\s*holder\s*name\b/i.test(lines[i])
    ) {
      for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
        const cand = stripTitle(lines[j]);
        if (isLikelyName(cand)) return cand;
      }
    }
  }

  // 3) Anchor above "My Address"
  const addrIdx = lines.findIndex((l) => /\bmy\s*address\b/i.test(l));
  if (addrIdx > 0) {
    for (let k = Math.max(0, addrIdx - 8); k < addrIdx; k++) {
      const cand = stripTitle(lines[k]);
      if (isLikelyName(cand)) return cand;
    }
  }

  // 4) Anchor above "Email ID"
  const emailIdx = lines.findIndex((l) => /\bemail\b/i.test(l));
  if (emailIdx > 0) {
    for (let k = Math.max(0, emailIdx - 8); k < emailIdx; k++) {
      const cand = stripTitle(lines[k]);
      if (isLikelyName(cand)) return cand;
    }
  }

  // 5) Fallback: best candidate near the top
  let best = null;
  for (const s of lines.slice(0, 150)) {
    if (!isLikelyName(s)) continue;
    const score = Math.min(30, s.length) + 3 * s.split(/\s+/).length;
    if (!best || score > best.score) best = { val: stripTitle(s), score };
  }
  return best ? best.val : null;
}

// Strong totals/due-date
function extractTotalAmount(text) {
  const h = normalize(text).slice(0, 20000);
  return (
    valueOnSameOrNextLine(h, /total\s*(?:amount\s*)?due\b/i, 4) ??
    valueOnSameOrNextLine(h, /amount\s*payable\b/i, 4) ??
    null
  );
}
function extractDueDate(text) {
  const h = normalize(text).slice(0, 20000);
  return (
    valueOnSameOrNextLineDate(h, /payment\s*due\s*date\b/i, 4) ??
    valueOnSameOrNextLineDate(h, /\bdue\s*date\b/i, 4) ??
    null
  );
}

// Transactions
function parseTransactions(text) {
  const lines = normalize(text)
    .split(/\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const tx = [];
  const dateAtStart =
    /^(\d{1,2}[\/\- ](?:[A-Za-z]{3}|[01]?\d)[A-Za-z]*[\/\- ]\d{2,4})\s+(.+)$/i;
  const isCRToken = (s) => /\b(CR|CREDIT)\b/i.test(s);
  const isDRToken = (s) => /\b(DR|DEBIT)\b/i.test(s);
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
  return tx;
}

export function parseSbi(text) {
  const base = parseGeneric(text);

  // Owner name
  if (!base.cardOwnerName) {
    const owner = extractSbiOwnerName(text);
    if (owner) base.cardOwnerName = owner;
  }

  // Card ending
  const last4 = extractMaskedLast4(text) || extractCardEnding(text);
  if (last4) base.cardEnding = last4;

  // Totals / due date
  const n = extractTotalAmount(text);
  if (n != null) base.totalAmountDue = n;
  const d = extractDueDate(text);
  if (d) base.paymentDueDate = d;

  // Transactions
  const tx = parseTransactions(text);
  if (tx.length) base.transactions = tx;

  return base;
}
