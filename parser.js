// Heuristic parser for credit card statements (HDFC/Axis/SBI-like)

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

function toISO(y, m, d) {
  const yy = y < 100 ? 2000 + y : y;
  const dt = new Date(Date.UTC(yy, m, d));
  return isNaN(dt) ? null : dt.toISOString().slice(0, 10);
}

function normalizeText(text) {
  return (text || "")
    .replace(/\u2013|\u2014/g, "-")
    .replace(/\u00A0/g, " ")
    .replace(/[^\S\r\n]+/g, " ")
    .replace(/\r/g, "");
}

function parseDateFlexible(s) {
  if (!s) return null;
  const src = s.replace(/(\d)(st|nd|rd|th)/gi, "$1").trim();

  // dd-MMM[-, ]yyyy (supports comma after MMM)
  let m = src.match(
    /(\d{1,2})[ \-\/](jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*,?[ \-\/](\d{2,4})/i
  );
  if (m)
    return toISO(
      parseInt(m[3], 10),
      MONTHS[m[2].toLowerCase()],
      parseInt(m[1], 10)
    );

  // dd/MM/yyyy or dd-MM-yyyy or dd/MM/yy
  m = src.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (m)
    return toISO(
      parseInt(m[3], 10),
      parseInt(m[2], 10) - 1,
      parseInt(m[1], 10)
    );

  // MMM dd, yyyy
  m = src.match(
    /(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*[ \-](\d{1,2}),?[ \-](\d{2,4})/i
  );
  if (m)
    return toISO(
      parseInt(m[3], 10),
      MONTHS[m[1].toLowerCase()],
      parseInt(m[2], 10)
    );

  return null;
}

function getAllDateStrings(text, limit = 4000) {
  const header = text.slice(0, limit);
  const out = [];
  const pats = [
    /(\d{1,2}[\/\-](\d{1,2})[\/\-](\d{2,4}))/g, // dd/mm/yyyy
    /(\d{1,2}[ \-](?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*,?[ \-](\d{2,4}))/gi, // dd MMM, yyyy
    /((?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*[ \-]\d{1,2},?[ \-]\d{2,4})/gi, // MMM dd, yyyy
  ];
  for (const r of pats) {
    for (const m of header.matchAll(r)) out.push(m[1]);
  }
  return out;
}

// Pick the last numeric token like 123,456.78 from a string
function lastNumberToken(s) {
  if (!s) return null;
  const tokens = [...String(s).matchAll(/\d[\d,]*\.?\d{0,2}/g)];
  if (!tokens.length) return null;
  return tokens[tokens.length - 1][0];
}

// Money parser that uses the last numeric token and CR/DR to set sign
function parseMoneyToNumber(s) {
  if (!s) return null;
  const raw = String(s);
  const neg = /\bDR\b|debit/i.test(raw) && !/\bCR\b|credit/i.test(raw);
  const tok = lastNumberToken(raw);
  if (!tok) return null;
  const num = parseFloat(tok.replace(/,/g, ""));
  if (isNaN(num)) return null;
  return neg ? -num : num;
}

function findFirst(regexes, text) {
  for (const r of regexes) {
    const m = text.match(r);
    if (m) return m;
  }
  return null;
}

// If value not on same line, look at next 2 non-empty lines
function valueOnSameOrNextLine(text, labelRegex) {
  const lines = text.split(/\n/);
  for (let i = 0; i < lines.length; i++) {
    if (labelRegex.test(lines[i])) {
      const same = lastNumberToken(lines[i]);
      if (same) return same;
      for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
        const val = lastNumberToken(lines[j]);
        if (val) return val;
      }
    }
  }
  return null;
}

function extractCardEnding(text) {
  const m = findFirst(
    [
      /\bcard\s*(?:number|no\.?)\b.*?(\d{4})\b/i,
      /\b(?:ending|ends?\s*with)\b[:\s\-]*?(\d{4})\b/i,
      /\bxxxx[\s\-]*?(\d{4})\b/i,
      /(\d{4})\b(?=[^\d]{0,6}$)/m, // last 4 digits near end of a masked sequence
    ],
    text
  );
  return m ? m[1] : null;
}

function extractPeriod(text) {
  const header = text.slice(0, 4000);

  // Label-based
  let m = findFirst(
    [
      /(?:statement|billing)\s*(?:period|cycle)\s*[:\-]?\s*([^\n]+?)(?:\n|$)/i,
      /\bperiod\b\s*[:\-]?\s*([^\n]+?)(?:\n|$)/i,
    ],
    header
  );

  if (m && m[1]) {
    // Two dates on same captured line
    const ds = [
      ...m[1].matchAll(
        /(\d{1,2}[ \/\-](?:[A-Za-z]{3}|[01]?\d)[A-Za-z]*,?[ \/\-]\d{2,4})/g
      ),
    ].map((x) => x[1]);
    if (ds.length >= 2) {
      const from = parseDateFlexible(ds[0]);
      const to = parseDateFlexible(ds[1]);
      if (from || to) return { from, to };
    }
    // "from X to Y"
    const fm = m[1].match(/from\s+(.+?)\s+(?:to|\-)\s+(.+)$/i);
    if (fm)
      return { from: parseDateFlexible(fm[1]), to: parseDateFlexible(fm[2]) };
  }

  // Fallback 1: any "dd ... to|- dd ..." in header
  const gm = header.match(
    /(\d{1,2}[ \/\-](?:[A-Za-z]{3}|[01]?\d)[A-Za-z]*,?[ \/\-]\d{2,4})\s*(?:to|\-)\s*(\d{1,2}[ \/\-](?:[A-Za-z]{3}|[01]?\d)[A-Za-z]*,?[ \/\-]\d{2,4})/i
  );
  if (gm)
    return { from: parseDateFlexible(gm[1]), to: parseDateFlexible(gm[2]) };

  // Fallback 2 (SBI): Opening/Closing balance dates anywhere
  const ob = text.match(
    /Opening Balance on (\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i
  );
  const cb = text.match(
    /Closing Balance on (\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i
  );
  if (ob || cb)
    return { from: parseDateFlexible(ob?.[1]), to: parseDateFlexible(cb?.[1]) };

  return { from: null, to: null };
}

function extractDueDate(text, period) {
  const header = text.slice(0, 4000);

  // Label-based
  const m = findFirst(
    [
      /payment\s*due\s*date\s*[:\-]?\s*([^\n]+)/i,
      /\bdue\s*date\s*[:\-]?\s*([^\n]+)/i,
      /payment\s*due\s*by\s*[:\-]?\s*([^\n]+)/i,
    ],
    header
  );
  const d = m ? parseDateFlexible(m[1]) : null;
  if (d) return d;

  // Fallback: pick a date in header that is not part of the period, usually the 3rd date
  const all = getAllDateStrings(text, 2000);
  const iso = all.map(parseDateFlexible).filter(Boolean);
  if (period?.from || period?.to) {
    const set = new Set([period.from, period.to].filter(Boolean));
    const cand = iso.find((x) => !set.has(x));
    if (cand) return cand;
  }
  return iso[2] || iso[1] || null;
}

function extractTotalAmountDue(text) {
  const header = text.slice(0, 4000);

  // Try same/next line after label, but take the last numeric token
  const line = findFirst(
    [
      /(total\s*(?:amount\s*)?due[^\n]*)/i,
      /(amount\s*payable\s*by[^\n]*)/i,
      /(total\s*due[^\n]*)/i,
    ],
    header
  );

  if (line && line[1]) {
    const tok = lastNumberToken(line[1]);
    const n = parseMoneyToNumber(tok);
    if (n != null) return n;
  }
  const nextTok = valueOnSameOrNextLine(header, /total\s*(?:amount\s*)?due\b/i);
  if (nextTok) return parseMoneyToNumber(nextTok);

  return null;
}

function extractTransactions(text) {
  const norm = normalizeText(text);
  const lines = norm
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const tx = [];
  // date formats at line start: dd/mm/yyyy or dd-mm-yy
  const dateAtStart =
    /^(\d{1,2}[\/\- ](?:[A-Za-z]{3}|[01]?\d)[A-Za-z]*[\/\- ]\d{2,4})\s+(.+)$/i;
  const dateNumericStart = /^(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\s*\|?\s*(.+)$/;

  for (const line of lines) {
    let m = line.match(dateAtStart) || line.match(dateNumericStart);
    if (!m) continue;

    const dateRaw = m[1];
    const rest = m[2];

    // Determine CR/DR anywhere in the line
    const isCR = /\bCR\b|CREDIT/i.test(line);
    const isDR = /\bDR\b|DEBIT/i.test(line);

    // Amount: take last numeric token on the line
    const amountTok = lastNumberToken(rest);
    if (!amountTok) continue;
    let amount = parseFloat(amountTok.replace(/,/g, ""));
    if (isNaN(amount)) continue;
    if (isDR && !isCR) amount = -amount;

    // Description: remove tail amount token occurrence
    const lastIdx = rest.lastIndexOf(amountTok);
    const desc = (lastIdx > 0 ? rest.slice(0, lastIdx) : rest)
      .replace(/\s{2,}/g, " ")
      .replace(/[|]+/g, " ")
      .trim();

    tx.push({
      date: parseDateFlexible(dateRaw),
      description: desc || null,
      amount,
    });
  }

  return tx;
}

export function parseStatementText(text) {
  const norm = normalizeText(text);

  const cardEnding = extractCardEnding(norm);
  const period = extractPeriod(norm);
  const paymentDueDate = extractDueDate(norm, period);
  const totalAmountDue = extractTotalAmountDue(norm);
  const transactions = extractTransactions(norm);

  return {
    cardEnding,
    statementPeriod: { from: period.from, to: period.to },
    paymentDueDate,
    totalAmountDue,
    transactions,
  };
}
