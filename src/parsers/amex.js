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

// Utility block (same as in SBI/ICICI)
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
function firstDateToken(s) {
  const m =
    String(s || "").match(
      /(\d{1,2}[ \/\-](?:[A-Za-z]{3}|[01]?\d)[A-Za-z]*[ \/\-]\d{2,4})/
    ) || String(s || "").match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/);
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
  return (
    valueOnSameOrNextLine(h, /total\s*(?:amount\s*)?due\b/i, 4) ??
    valueOnSameOrNextLine(h, /amount\s*payable\b/i, 4) ??
    valueOnSameOrNextLine(h, /new\s*balance\b/i, 4) ??
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

function parseTransactions(text) {
  const lines = normalize(text)
    .split(/\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const tx = [];
  const dateAtStart =
    /^(\d{1,2}[\/\- ](?:[A-Za-z]{3}|[01]?\d)[A-Za-z]*[\/\- ]\d{2,4})\s+(.+)$/i;
  const isCR = (s) => /\b(CR|CREDIT)\b/i.test(s);
  const isDR = (s) => /\b(DR|DEBIT)\b/i.test(s);
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
    if (isDR(line) && !isCR(line)) amt = -amt;
    const cutIdx = rest.lastIndexOf(amtTok);
    const desc = (cutIdx > 0 ? rest.slice(0, cutIdx) : rest)
      .replace(/\s{2,}/g, " ")
      .trim();
    tx.push({ date: dISO, description: desc || null, amount: amt });
  }
  return tx;
}

// **IMPROVED, ROBUST FUNCTION**
function extractAmexOwnerName(text = "") {
  const lines = normalize(text)
    .slice(0, 5000) // Search within the top part of the document
    .split("\n")
    .map((l) => l.trim().replace(/\s{2,}/g, " "))
    .filter(Boolean);


  const knownHeaderPhrases = [
    "AMERICAN EXPRESS",
    "STATEMENT OF ACCOUNT",
    "NEW BALANCE",
    "PAYMENT DUE DATE",
    "MINIMUM PAYMENT DUE",
    "TOTAL DUE",
    "CREDIT LIMIT",
  ];


  for (const line of lines.slice(0, 40)) {
    // Rule 1: Must be entirely uppercase letters, spaces, and possibly dots/hyphens for initials.
    if (!/^[A-Z\s.'\-]+$/.test(line)) {
      continue;
    }

    // Rule 2: Must consist of 2 to 4 words to be a plausible name.
    const words = line.split(" ");
    if (words.length < 2 || words.length > 4) {
      continue;
    }

    // Rule 3: Must NOT be one of the known non-name header phrases.
    if (knownHeaderPhrases.includes(line)) {
      continue;
    }

    // Rule 4: Must not contain other obvious label keywords.
    if (/\b(ACCOUNT|STATEMENT|CARD|BALANCE|PAYMENT|LIMIT|DATE)\b/i.test(line)) {
      continue;
    }

    // Rule 5: Should not contain any numbers.
    if (/\d/.test(line)) {
      continue;
    }

    // If a line survives all these checks, we have high confidence it's the name.
    return line;
  }

  return null;
}

export function parseAmex(text) {
  const base = parseGeneric(text);

  // --- Name Extraction ---
  // Always run the AMEX-specific name parser to OVERRIDE any bad generic result.
  const owner = extractAmexOwnerName(text);
  if (owner) {
    base.cardOwnerName = owner;
  }

  // --- Other Fields ---
  // Continue to use specific extractors for accuracy.
  const last4 = extractMaskedLast4(text) || extractCardEnding(text);
  if (last4) base.cardEnding = last4;

  const n = extractTotalAmount(text);
  if (n != null) base.totalAmountDue = n;

  const d = extractDueDate(text);
  if (d) base.paymentDueDate = d;

  const tx = parseTransactions(text);
  if (tx.length) base.transactions = tx;

  return base;
}
