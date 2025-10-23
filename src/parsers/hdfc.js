import { parseGeneric } from "./generic.js";

function normalize(t = "") {
  return t.replace(/\u00A0/g, " ").replace(/\r/g, "");
}


function fixCurrencyOCR(s = "") {
  // Only normalize garbled rupee to proper ₹
  return s.replace(/â‚¹/g, "₹");
}
function prepare(text = "") {
  return fixCurrencyOCR(normalize(text));
}

// Currency amount tokens (₹ or Rs)
function moneyTokensWithIndex(s = "") {
  const out = [];
  const re = /(?:₹|Rs\.?\s*)?\s*(\d[\d,]*\.\d{2})/g;
  let m;
  while ((m = re.exec(s))) {
    out.push({ val: m[1], idx: m.index });
  }
  return out;
}
function parseMoneyFirstToken(s) {
  const toks = moneyTokensWithIndex(s);
  if (!toks.length) return null;
  const n = parseFloat(toks[0].val.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}


function moneyTokensCurrencyWithIndex(s = "") {
  const out = [];
  const re = /(?:₹|Rs\.?\s*)\s*(\d[\d,]*\.\d{2})/g;
  let m;
  while ((m = re.exec(s))) {
    out.push({ val: m[1], idx: m.index });
  }
  return out;
}


function firstCurrencyAfterLabel(text, labelRegex, windowLines = 5) {
  const lines = text.split(/\n/);
  const excludeRe = /(minimum\s*due|due\s*date)/i;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!labelRegex.test(line)) continue;

    const pos = line.search(labelRegex);


    const same = moneyTokensCurrencyWithIndex(line).find((t) => t.idx >= pos);
    if (same) {
      const n = parseFloat(same.val.replace(/,/g, ""));
      if (Number.isFinite(n)) return n;
    }


    for (let j = i + 1; j < Math.min(i + 1 + windowLines, lines.length); j++) {
      const ln = lines[j];
      if (excludeRe.test(ln)) continue;
      const toks = moneyTokensCurrencyWithIndex(ln);
      if (toks.length) {
        const n = parseFloat(toks[0].val.replace(/,/g, ""));
        if (Number.isFinite(n)) return n;
      }
    }
    break;
  }
  return null;
}


function amountOnSameOrNextLine(text, labelRegex) {
  const lines = text.split(/\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!labelRegex.test(line)) continue;


    const pos = line.search(labelRegex);
    const toks = moneyTokensWithIndex(line);
    const after = toks.find((t) => t.idx >= pos);
    if (after) {
      const n = parseFloat(after.val.replace(/,/g, ""));
      if (Number.isFinite(n)) return n;
    }

    // Next 3 lines: take the first money token found
    for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
      const n = parseMoneyFirstToken(lines[j]);
      if (n != null) return n;
    }
    break;
  }
  return null;
}


function amountAfterLabelPreferMax(text, labelRegex, windowLines = 5) {
  const lines = text.split(/\n/);
  const excludeRe = /(minimum\s*due|due\s*date)/i;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!labelRegex.test(line)) continue;

    const pos = line.search(labelRegex);
    const cands = [];


    for (const t of moneyTokensWithIndex(line)) {
      if (t.idx >= pos) cands.push(parseFloat(t.val.replace(/,/g, "")));
    }


    for (let j = i + 1; j < Math.min(i + 1 + windowLines, lines.length); j++) {
      const ln = lines[j];
      if (excludeRe.test(ln)) continue;
      for (const t of moneyTokensWithIndex(ln)) {
        const n = parseFloat(t.val.replace(/,/g, ""));
        if (Number.isFinite(n)) cands.push(n);
      }
    }

    if (cands.length) return Math.max(...cands);
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
function valueOnSameOrNextLineDate(text, labelRegex) {
  const lines = text.split(/\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!labelRegex.test(line)) continue;
    const sameTok = firstDateToken(line);
    if (sameTok) return parseDateFlexible(sameTok);
    for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
      const tok = firstDateToken(lines[j]);
      if (tok) return parseDateFlexible(tok);
    }
    break;
  }
  return null;
}

function parseDateFlexible(s) {
  if (!s) return null;
  const MONTHS = {
    jan: 0,
    feb: 1,
    mar: 2,
    apr: 3,
    may: 4,
    jun: 5,
    jul: 6,
    aug: 7,
    sep: 8,
    sept: 8,
    oct: 9,
    nov: 10,
    dec: 11,
  };
  const toISO = (y, m, d) => {
    const yy = y < 100 ? 2000 + y : y;
    const dt = new Date(Date.UTC(yy, m, d));
    return isNaN(dt) ? null : dt.toISOString().slice(0, 10);
  };
  const src = s.replace(/(\d)(st|nd|rd|th)/gi, "$1").trim();
  let m = src.match(
    /(\d{1,2})[ \-\/](jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*,?[ \-\/](\d{2,4})/i
  );
  if (m) return toISO(+m[3], MONTHS[m[2].toLowerCase()], +m[1]);
  m = src.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (m) return toISO(+m[3], +m[2] - 1, +m[1]);
  m = src.match(
    /(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*[ \-](\d{1,2}),?[ \-](\d{2,4})/i
  );
  if (m) return toISO(+m[3], MONTHS[m[1].toLowerCase()], +m[2]);
  return null;
}

// Collect ₹/Rs amounts in a small window after a label, skipping unrelated lines
function currencyWindowAfterLabel(text, labelRegex, windowLines = 4) {
  const lines = text.split(/\n/);
  // Skip typical neighbors that can be larger than the Total box
  const excludeRe =
    /(minimum\s*due|due\s*date|credit\s*limit|available\s*credit|available\s*cash)/i;

  for (let i = 0; i < lines.length; i++) {
    if (!labelRegex.test(lines[i])) continue;

    const pos = lines[i].search(labelRegex);
    const nums = [];

    // Same line: only tokens after the label
    for (const t of moneyTokensCurrencyWithIndex(lines[i])) {
      if (t.idx >= pos) {
        const n = parseFloat(t.val.replace(/,/g, ""));
        if (Number.isFinite(n)) nums.push(n);
      }
    }

    // Next few lines: take all currency tokens unless excluded
    for (let j = i + 1; j < Math.min(i + 1 + windowLines, lines.length); j++) {
      const ln = lines[j];
      if (excludeRe.test(ln)) continue;
      for (const t of moneyTokensCurrencyWithIndex(ln)) {
        const n = parseFloat(t.val.replace(/,/g, ""));
        if (Number.isFinite(n)) nums.push(n);
      }
    }
    return nums;
  }
  return [];
}

// Number right after an equals sign on the next few lines after a label
function amountAfterEqualsNearLabel(text, labelRegex, windowLines = 5) {
  const lines = text.split(/\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!labelRegex.test(lines[i])) continue;
    for (let j = i + 1; j < Math.min(i + 1 + windowLines, lines.length); j++) {
      const m = lines[j].match(/=\s*(?:₹|Rs\.?\s*)?\s*([\d,]+\.\d{2})/i);
      if (m) {
        const n = parseFloat(m[1].replace(/,/g, ""));
        if (Number.isFinite(n)) return n;
      }
    }
    break;
  }
  return null;
}

// Compute total from the summary row:
// total = Previous Statement Dues - Payments/Credits Received + Purchases/Debit + Finance Charges
function extractHdfcSummaryComputedTotal(text) {
  const h = prepare(text).slice(0, 20000);
  const prev = firstCurrencyAfterLabel(h, /previous\s*statement\s*dues\b/i, 2);
  const payCred = firstCurrencyAfterLabel(
    h,
    /payments\s*\/?\s*credits(?:\s*received)?\b/i,
    2
  );
  const purch = firstCurrencyAfterLabel(h, /purchases\s*\/\s*debit\b/i, 2);
  const fin = firstCurrencyAfterLabel(h, /finance\s*charges\b/i, 2);

  if (purch != null || prev != null || payCred != null || fin != null) {
    const total = (prev ?? 0) - (payCred ?? 0) + (purch ?? 0) + (fin ?? 0);
    const n = parseFloat(total.toFixed(2));
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  return null;
}

// Prefer the first currency-marked amount near "TOTAL AMOUNT DUE"
function extractHdfcTotalAmount(text) {
  // Require explicit ₹/Rs and normalize garbled rupee first
  const h = prepare(text).slice(0, 20000);

  // 0) If a line below has "= 999.00", trust that
  const eqVal = amountAfterEqualsNearLabel(
    h,
    /total\s*(?:amount\s*)?due\b/i,
    6
  );
  if (eqVal != null) return eqVal;

  // 1) Tight window around "TOTAL AMOUNT DUE": choose the smallest positive value
  const primaryNums = currencyWindowAfterLabel(
    h,
    /total\s*(?:amount\s*)?due\b/i,
    4
  );
  let nearLabel = null;
  if (primaryNums.length) {
    const filtered = primaryNums.filter((n) => n >= 0);
    if (filtered.length) nearLabel = Math.min(...filtered);
  }

  // 2) Compute from the summary row
  const computed = extractHdfcSummaryComputedTotal(h);

  // Decision matrix
  if (computed != null && nearLabel != null) {
    // If near label is inflated (>= 2000) or much larger than computed, prefer computed
    if (nearLabel >= 2000 || computed < nearLabel - 500) return computed;
    // If close, prefer nearLabel
    return nearLabel;
  }
  if (computed != null) return computed;
  if (nearLabel != null) return nearLabel;

  // 3) Alternatives with same strategy
  for (const re of [/amount\s*payable\b/i, /total\s*due\b/i]) {
    const nums = currencyWindowAfterLabel(h, re, 4);
    if (nums.length) {
      const filtered = nums.filter((n) => n >= 0);
      if (filtered.length) return Math.min(...filtered);
    }
  }

  // 4) Last resort: first currency-marked token in the first ~100 lines
  const lines = h.split(/\n/).slice(0, 100);
  for (const ln of lines) {
    const toks = moneyTokensCurrencyWithIndex(ln);
    if (toks.length) {
      const n = parseFloat(toks[0].val.replace(/,/g, ""));
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function extractHdfcDueDate(text) {
  // Use prepare to normalize and handle odd spaces
  const h = prepare(text).slice(0, 20000);
  const lines = h.split(/\n/).map((s) => s.trim());

  // Helper to find a date token on a line
  const findDateOnLine = (s) => {
    const m =
      s.match(
        /(\d{1,2}[ \/\-](?:[A-Za-z]{3}|[01]?\d)[A-Za-z]*[ \/\-]\d{2,4})/
      ) ||
      s.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/) ||
      s.match(
        /(\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*,?\s+\d{2,4})/i
      );
    return m ? parseDateFlexible(m[1]) : null;
  };

  // 1) Look for label and then scan same + next few lines for a date
  for (let i = 0; i < lines.length; i++) {
    if (!/(?:payment\s*)?due\s*date\b/i.test(lines[i])) continue;

    // Same line
    let d = findDateOnLine(lines[i]);
    if (d) return d;

    // Next lines (up to 8) — HDFC box often has value on the next line
    for (let j = i + 1; j < Math.min(i + 9, lines.length); j++) {
      d = findDateOnLine(lines[j]);
      if (d) return d;
    }
    break;
  }

  // 2) Fallback: inline “Due Date ... <date>”
  const inline =
    h.match(
      /(?:payment\s*)?due\s*date[^\n]*?(\d{1,2}[ \/\-](?:[A-Za-z]{3}|[01]?\d)[A-Za-z]*[ \/\-]\d{2,4})/i
    ) ||
    h.match(
      /(?:payment\s*)?due\s*date[^\n]*?(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i
    ) ||
    h.match(
      /(?:payment\s*)?due\s*date[^\n]*?(\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*,?\s+\d{2,4})/i
    );
  if (inline) {
    const d = parseDateFlexible(inline[1]);
    if (d) return d;
  }

  return null;
}

// **FINAL, ROBUST FUNCTION**
function extractHdfcOwnerName(text = "") {
  const lines = prepare(text)
    .slice(0, 5000) // Search within the top part of the document
    .split("\n")
    .map((l) => l.trim().replace(/\s{2,}/g, " "))
    .filter(Boolean);

  // A specific list of phrases that look like names but are actually headers.
  const knownHeaderPhrases = [
    "BUSINESS MONEYBACK",
    "HDFC BANK",
    "TOTAL CREDIT LIMIT",
    "AVAILABLE CREDIT LIMIT",
    "AVAILABLE CASH LIMIT",
    "PREVIOUS STATEMENT DUES",
    "PAYMENTS CREDITS RECEIVED",
    "PURCHASES DEBIT",
    "FINANCE CHARGES",
    "TOTAL AMOUNT DUE",
    "MINIMUM DUE",
    "DUE DATE",
  ];

  // We'll search the first 30 lines, where the name block always is.
  for (const line of lines.slice(0, 30)) {
    // Rule 1: Must be entirely uppercase letters, spaces, and possibly dots/hyphens for initials.
    if (!/^[A-Z\s.'\-]+$/.test(line)) {
      continue;
    }

    // Rule 2: Must consist of 2 to 4 words. This avoids single-word titles and long sentences.
    const words = line.split(" ");
    if (words.length < 2 || words.length > 4) {
      continue;
    }

    // Rule 3: Must NOT be one of the known non-name header phrases. This is the key fix.
    if (knownHeaderPhrases.includes(line)) {
      continue;
    }

    // Rule 4: Must not contain obvious label keywords.
    if (/\b(LIMIT|STATEMENT|ACCOUNT|CARD|DATE|DUE|AMOUNT)\b/i.test(line)) {
      continue;
    }

    // If a line passes all checks, it's our name.
    return line;
  }

  return null;
}

export function parseHdfc(text) {
  const base = parseGeneric(text);

  // --- Name Extraction ---
  // Always run the HDFC-specific name parser and OVERRIDE any previous result.
  const owner = extractHdfcOwnerName(text);
  if (owner) {
    base.cardOwnerName = owner;
  }

  // --- Other Fields ---
  // Always override with HDFC-specific functions for better accuracy.
  const n = extractHdfcTotalAmount(text);
  if (n != null) base.totalAmountDue = n;

  const d = extractHdfcDueDate(text);
  if (d) base.paymentDueDate = d;

  return base;
}
