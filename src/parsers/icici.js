import {
  parseGeneric,
  parseDate,
  extractCardEnding,
  normalizeDigitChars,
} from "./generic.js";

function normalize(t = "") {
  return String(t)
    .replace(/\u00A0/g, " ")
    .replace(/\r/g, "");
}


function lastNumTok(s) {
  const m = [...String(s || "").matchAll(/\d[\d,]*\.\d{2}/g)];
  return m.length ? m[m.length - 1][0] : null;
}
function firstNumTok(s) {
  const m = String(s || "").match(/\d[\d,]*\.\d{2}/);
  return m ? m[0] : null;
}
function parseMoneyFromText(s) {
  const tok = firstNumTok(s) || lastNumTok(s);
  if (!tok) return null;
  const n = parseFloat(tok.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}
function valueOnSameOrNextLine(text, re, look = 3) {
  const lines = String(text).split(/\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!re.test(lines[i])) continue;
    const same = parseMoneyFromText(lines[i]);
    if (same != null) return same;
    for (let j = i + 1; j < Math.min(i + 1 + look, lines.length); j++) {
      const n = parseMoneyFromText(lines[j]);
      if (n != null) return n;
    }
    break;
  }
  return null;
}

function amountsAfterLabel(text, re, look = 4) {
  const lines = String(text).split(/\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!re.test(lines[i])) continue;
    const vals = [];
    for (let j = i; j < Math.min(i + 1 + look, lines.length); j++) {
      for (const m of lines[j].matchAll(/\d[\d,]*\.\d{2}/g)) {
        const v = parseFloat(m[0].replace(/,/g, ""));
        if (Number.isFinite(v)) vals.push(v);
      }
    }

    const cand = vals
      .filter((v) => v >= 500 && v <= 500000)
      .sort((a, b) => b - a);
    if (cand.length) return cand[0];

    // Fallback: pick the largest positive <= 1,000,000
    const fallback = vals
      .filter((v) => v > 0 && v <= 1000000)
      .sort((a, b) => b - a);
    return fallback.length ? fallback[0] : null;
  }
  return null;
}

function firstDateToken(s) {
  const str = String(s || "");
  const m =
    str.match(
      /(\d{1,2}[ \/\-](?:[A-Za-z]{3}|[01]?\d)[A-Za-z]*[ \/\-]\d{2,4})/
    ) ||
    str.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/) ||
    str.match(
      /((?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+\d{2,4})/i
    );
  return m ? m[1] : null;
}
function valueOnSameOrNextLineDate(text, re, look = 3) {
  const lines = String(text).split(/\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!re.test(lines[i])) continue;
    const same = firstDateToken(lines[i]);
    if (same) return parseDate(same);
    for (let j = i + 1; j < Math.min(i + 1 + look, lines.length); j++) {
      const tok = firstDateToken(lines[j]);
      if (tok) return parseDate(tok);
    }
    break;
  }
  return null;
}

// ---------- ICICI specific extraction ----------
function extractMaskedLast4(text = "") {
  const header = normalize(text).slice(0, 20000);
  const c = new Set();
  const push = (raw) => {
    const v = normalizeDigitChars(String(raw || "")).replace(/\D/g, "");
    if (/^\d{4}$/.test(v)) c.add(v);
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
  if (!c.size) {
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
  for (const v of c) if (!boring.has(v)) return v;
  return c.size ? [...c][0] : null;
}

function extractTotalAmount(text) {
  const h = normalize(text).slice(0, 20000);
  // 1) Strong: same/next line of the label
  const direct = valueOnSameOrNextLine(h, /\btotal\s*(?:amount\s*)?due\b/i, 2);
  if (direct != null) return direct;

  // 2) Windowed heuristic near the label (filters tiny/huge noise)
  const win = amountsAfterLabel(h, /\btotal\s*(?:amount\s*)?due\b/i, 6);
  if (win != null) return win;

  // 3) Alternate phrasing
  return valueOnSameOrNextLine(h, /amount\s*payable\b/i, 3);
}

function extractDueDate(text) {
  const h = normalize(text).slice(0, 20000);
  return (
    valueOnSameOrNextLineDate(h, /payment\s*due\s*date\b/i, 6) ??
    valueOnSameOrNextLineDate(h, /\bdue\s*date\b/i, 6) ??
    null
  );
}

function extractStatementDate(text) {
  const h = normalize(text).slice(0, 20000);
  return (
    valueOnSameOrNextLineDate(h, /statement\s*date\b/i, 6) ??
    valueOnSameOrNextLineDate(h, /billing\s*date\b/i, 6) ??
    null
  );
}

function parseTransactions(text) {
  const lines = normalize(text)
    .split(/\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const tx = [];
  const dateAtStart =
    /^(\d{1,2}[\/\- ](?:[A-Za-z]{3}|[01]?\d)[A-Za-z]*[\/\- ]\d{2,4}|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+\d{2,4})\b\s+(.+)$/i;
  const isCR = (s) => /\b(CR|CREDIT)\b/i.test(s);
  const isDR = (s) => /\b(DR|DEBIT)\b/i.test(s);
  for (const line of lines) {
    const m = line.match(dateAtStart);
    if (!m) continue;
    const dISO = parseDate(m[1]);
    if (!dISO) continue;
    const rest = m[2];
    const amtMatch = [...rest.matchAll(/\d[\d,]*\.\d{2}/g)];
    if (!amtMatch.length) continue;
    const amtTok = amtMatch[amtMatch.length - 1][0];
    let amt = parseFloat(amtTok.replace(/,/g, ""));
    if (!Number.isFinite(amt)) continue;
    if (isDR(line) && !isCR(line)) amt = -amt;
    const cutIdx = rest.lastIndexOf(amtTok);
    const desc = (cutIdx > 0 ? rest.slice(0, cutIdx) : rest)
      .replace(/\s{2,}/g, " ")
      .trim();
    tx.push({ date: dISO, description: desc || null, amount: amt });
  }
  return tx;
}

// Owner name: restrict search to header, but also fallback to global anchors if needed
function extractIciciOwnerName(text = "") {
  const allLines = normalize(text)
    .slice(0, 30000)
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const clean = (s) => s.replace(/\s{2,}/g, " ").trim();
  const stripTitle = (s) =>
    clean(String(s).replace(/\b(?:mr|mrs|ms|shri|smt)\.?\s+/i, ""));
  const STOP =
    /(ICICI|BANK|CREDIT|CARD|PAYMENT|SUMMARY|STATEMENT|PERIOD|DATE|DUE|MINIMUM|LIMIT|AVAILABLE|CASH|GSTIN|HSN|EMAIL|ADDRESS|STATEMENT\s*DATE|PAYMENT\s*DUE\s*DATE|STATEMENT\s*SUMMARY|CREDIT\s*SUMMARY)/i;
  const TX_WORDS =
    /\b(RETAIL|AUTODEBIT|PAYMENT|UPI|AMAZON|FLIPKART|APPLE|RECHARGE|CROMA|WALLET|FUEL|EMI|LOAN|MERCHANT|ONLINE|POS|CR|DR|CREDIT|DEBIT)\b/i;
  const looksLikeAddress = (s) =>
    /,/.test(s) ||
    /\b(ROAD|RD|FLOOR|FLR|BLDG|BUILDING|BLOCK|AREA|NAGAR|APARTMENT|APT|CITY|STATE|PIN|WEST|EAST|NORTH|SOUTH|MUMBAI|MAHARASHTRA)\b/i.test(
      s
    );

  function isLikelyName(s) {
    if (!s) return false;
    if (STOP.test(s)) return false;
    if (TX_WORDS.test(s)) return false;
    if (/[0-9]/.test(s)) return false;
    if (/\./.test(s)) return false;
    if (looksLikeAddress(s)) return false;
    const cand = stripTitle(s);
    const toks = cand.split(/\s+/).filter(Boolean);
    if (toks.length < 2 || toks.length > 5) return false;
    const good = toks.filter((t) => /^[A-Z][A-Z'\-]{2,}$/.test(t)).length;
    return good >= 2 && cand.length <= 60;
  }

  // Pass 1: limit search to header region (before summaries)
  const sumIdx = allLines.findIndex((l) =>
    /(statement\s*summary|credit\s*summary)/i.test(l)
  );
  const header = sumIdx > 0 ? allLines.slice(0, sumIdx) : allLines;

  // 1a) Label on same line
  for (const line of header.slice(0, 200)) {
    const m = line.match(
      /\b(card(?:member|holder)?\s*name|customer\s*name|name)\b[:\-]?\s+([A-Z][A-Z '\-]{5,})/i
    );
    if (m && isLikelyName(m[2])) return stripTitle(clean(m[2]));
  }
  // 1b) Label then next line
  for (let i = 0; i < Math.min(200, header.length); i++) {
    if (
      /\b(card(?:member|holder)?\s*name|customer\s*name|name)\b/i.test(
        header[i]
      )
    ) {
      for (let j = i + 1; j < Math.min(i + 3, header.length); j++) {
        const s = stripTitle(header[j]);
        if (isLikelyName(s)) return s;
      }
      break;
    }
  }
  // 1c) Header-only scan
  for (const s of header.slice(0, 150)) {
    const cand = stripTitle(s);
    if (isLikelyName(cand)) return cand;
  }

  // Pass 2: Global anchors (handles PDFs whose reading order places “summary” first)
  const pinIdx = allLines.findIndex((l) => /\b\d{6}\b/.test(l));
  if (pinIdx > 0) {
    for (let k = Math.max(0, pinIdx - 8); k < pinIdx; k++) {
      const s = stripTitle(allLines[k]);
      if (isLikelyName(s)) return s;
    }
  }
  const emailIdx = allLines.findIndex((l) => /\bemail\b/i.test(l));
  if (emailIdx > 0) {
    for (let k = Math.max(0, emailIdx - 10); k < emailIdx; k++) {
      const s = stripTitle(allLines[k]);
      if (isLikelyName(s)) return s;
    }
  }
  const sdIdx = allLines.findIndex((l) => /\bstatement\s*date\b/i.test(l));
  if (sdIdx > 0) {
    for (let k = Math.max(0, sdIdx - 10); k < sdIdx; k++) {
      const s = stripTitle(allLines[k]);
      if (isLikelyName(s)) return s;
    }
  }

  // Pass 3: very top of document (last resort)
  for (const s of allLines.slice(0, 120)) {
    const cand = stripTitle(s);
    if (isLikelyName(cand)) return cand;
  }
  return null;
}

// Statement period: explicit label else tx-min to statement date (only if SD present)
function extractIciciStatementPeriod(text, tx = []) {
  const h = normalize(text).slice(0, 25000);
  const m =
    h.match(
      /(statement|billing)\s*period[^\n]*?(\d{1,2}[^\n]*?\d{2,4})\s*(?:to|–|-|—|→)\s*(\d{1,2}[^\n]*?\d{2,4})/i
    ) || null;
  if (m) {
    const from = parseDate(firstDateToken(m[2]) || "");
    const to = parseDate(firstDateToken(m[3]) || "");
    if (from && to) return { from, to };
  }

  const sd = extractStatementDate(text);
  if (!sd) return null; // don't guess without statement date

  const dates = tx
    .map((t) => t.date)
    .filter(Boolean)
    .sort();
  const from = dates.length ? dates[0] : null;
  if (!from) return null;

  // Sanity: ignore ultra-short ranges (likely parsing noise)
  const spanDays = (new Date(sd) - new Date(from)) / 86400000;
  if (spanDays < 10) return null;

  return { from, to: sd };
}

export function parseIcici(text) {
  const base = parseGeneric(text);

  const owner = extractIciciOwnerName(text);
  if (owner) base.cardOwnerName = owner;

  const last4 = extractMaskedLast4(text) || extractCardEnding(text);
  if (last4) base.cardEnding = last4;

  const n = extractTotalAmount(text);
  if (n != null) base.totalAmountDue = n;

  const d = extractDueDate(text);
  if (d) base.paymentDueDate = d;

  const tx = parseTransactions(text);
  if (tx.length) base.transactions = tx;

  const sp = extractIciciStatementPeriod(text, tx);
  if (sp?.from && sp?.to) base.statementPeriod = sp;

  return base;
}
