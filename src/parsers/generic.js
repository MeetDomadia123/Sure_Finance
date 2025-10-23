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

const norm = (t) =>
  (t || "")
    .replace(/\u2013|\u2014/g, "-")
    .replace(/\u00A0/g, " ")
    .replace(/[^\S\r\n]+/g, " ")
    .replace(/\r/g, "");

const toISO = (y, m, d) => {
  const yy = y < 100 ? 2000 + y : y;
  const dt = new Date(Date.UTC(yy, m, d));
  return isNaN(dt) ? null : dt.toISOString().slice(0, 10);
};
export const parseDate = (s) => {
  if (!s) return null;
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
};

const lastNumTok = (s) => {
  const m = [...String(s || "").matchAll(/\d[\d,]*\.?\d{0,2}/g)];
  return m.length ? m[m.length - 1][0] : null;
};
export const money = (s, signHint) => {
  if (!s) return null;
  const tok = lastNumTok(s);
  if (!tok) return null;
  let n = parseFloat(tok.replace(/,/g, ""));
  if (isNaN(n)) return null;
  if (signHint < 0) n = -n;
  return n;
};

const find = (res, t) => {
  for (const r of res) {
    const m = t.match(r);
    if (m) return m;
  }
  return null;
};

// Normalize OCR confusions for digits used in last-4 detection
export function normalizeDigitChars(s = "") {
  const map = {
    O: "0",
    o: "0",
    D: "0",
    "°": "0",
    I: "1",
    l: "1",
    "|": "1",
    Z: "2",
    z: "2",
    S: "5",
    s: "5",
    B: "8",
    "§": "8",
    q: "9",
    g: "9",
  };
  return s.replace(/[OoD°Il|ZzSsB§qg]/g, (ch) => map[ch] || ch);
}

// Strong last-4 extractor (masked patterns + context scoring)
export function extractCardEnding(text) {
  const header = (text || "").slice(0, 8000);
  const lines = header
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const cands = [];
  const push = (raw, score) => {
    if (!raw) return;
    const val = normalizeDigitChars(raw).replace(/\D/g, "");
    if (/^\d{4}$/.test(val)) cands.push({ val, score });
  };

  for (const line of lines) {
    const ctx =
      (/\b(card|credit)\b/i.test(line) ? 2 : 0) +
      (/\bending|ends?\s*with|last\s*4\b/i.test(line) ? 2 : 0) +
      (/[xX\*\u2022•]/.test(line) ? 1 : 0);

    // Card ending 2IIS / ends with 2115
    const m1 = line.match(
      /(?:card[^a-z0-9]*)?(?:ending(?:\s*with)?)\s*[:\-]?\s*([0-9A-Za-z|]{4})\b/i
    );
    if (m1) push(m1[1], ctx + 4);

    // Card No / Number with mask blocks then last 4
    const m2 = line.match(
      /card\s*(?:no|number)?[^A-Za-z0-9]*?(?:[xX\*\u2022•\s\-]{2,})+([0-9A-Za-z|]{4})\b/i
    );
    if (m2) push(m2[1], ctx + 4);

    // Generic masked blocks like **** **** **** 2115 or ••••-••••-••••-2115
    const m3 = line.match(
      /(?:[xX\*\u2022•]{2,}[\s\-]*){2,}([0-9A-Za-z|]{4})\b/
    );
    if (m3) push(m3[1], ctx + 3);

    // Rare: full digits visible -> capture last group
    const m4 = line.match(/(?:\d{4}[^\d]{1,3}){3}(\d{4})\b/);
    if (m4) push(m4[1], ctx + 2);
  }

  if (!cands.length) return null;

  // Prefer high score and non-trivial values (avoid 0000/1111 etc.)
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
  cands.sort((a, b) => {
    const ab = boring.has(a.val) ? -1 : 0;
    const bb = boring.has(b.val) ? -1 : 0;
    if (ab !== bb) return bb - ab;
    return b.score - a.score;
  });
  return cands[0].val;
}

const extractPeriod = (t) => {
  const h = t.slice(0, 4000);
  let m = find(
    [
      /(?:statement|billing)\s*(?:period|cycle)\s*[:\-]?\s*([^\n]+)/i,
      /\bperiod\b\s*[:\-]?\s*([^\n]+)/i,
    ],
    h
  );
  if (m && m[1]) {
    const ds = [
      ...m[1].matchAll(
        /(\d{1,2}[ \/\-](?:[A-Za-z]{3}|[01]?\d)[A-Za-z]*,?[ \/\-]\d{2,4})/g
      ),
    ].map((x) => x[1]);
    if (ds.length >= 2) return { from: parseDate(ds[0]), to: parseDate(ds[1]) };
    const fm = m[1].match(/from\s+(.+?)\s+(?:to|\-)\s+(.+)/i);
    if (fm) return { from: parseDate(fm[1]), to: parseDate(fm[2]) };
  }
  const gm = h.match(
    /(\d{1,2}[ \/\-](?:[A-Za-z]{3}|[01]?\d)[A-Za-z]*,?[ \/\-]\d{2,4})\s*(?:to|\-)\s*(\d{1,2}[ \/\-](?:[A-Za-z]{3}|[01]?\d)[A-Za-z]*,?[ \/\-]\d{2,4})/i
  );
  if (gm) return { from: parseDate(gm[1]), to: parseDate(gm[2]) };
  return { from: null, to: null };
};

const extractDue = (t) => {
  const h = t.slice(0, 4000);
  const m = find(
    [
      /payment\s*due\s*date\s*[:\-]?\s*([^\n]+)/i,
      /\bdue\s*date\s*[:\-]?\s*([^\n]+)/i,
      /payment\s*due\s*by\s*[:\-]?\s*([^\n]+)/i,
    ],
    h
  );
  return m ? parseDate(m[1]) : null;
};

const extractTotal = (t) => {
  const h = t.slice(0, 4000);
  const m = find(
    [
      /(total\s*(?:amount\s*)?due[^\n]*)/i,
      /(amount\s*payable\s*by[^\n]*)/i,
      /(total\s*due[^\n]*)/i,
    ],
    h
  );
  if (m?.[1]) {
    const n = money(m[1]);
    if (n != null) return n;
  }
  return null;
};

export function parseGeneric(text) {
  const tx = [];
  const n = norm(text);
  const lines = n
    .split(/\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const re1 =
    /^(\d{1,2}[\/\- ](?:[A-Za-z]{3}|[01]?\d)[A-Za-z]*[\/\- ]\d{2,4})\s+(.+)$/i;
  for (const line of lines) {
    const m = line.match(re1);
    if (!m) continue;
    const dateISO = parseDate(m[1]);
    const rest = m[2];
    const isCR = /\bCR\b|CREDIT/i.test(line);
    const isDR = /\bDR\b|DEBIT/i.test(line);
    const amtTok = [...rest.matchAll(/\d[\d,]*\.\d{2}/g)];
    if (!amtTok.length) continue;
    let amt = parseFloat(amtTok[amtTok.length - 1][0].replace(/,/g, ""));
    if (isNaN(amt)) continue;
    if (isDR && !isCR) amt = -amt;
    const cutIdx = rest.lastIndexOf(amtTok[amtTok.length - 1][0]);
    const desc = (cutIdx > 0 ? rest.slice(0, cutIdx) : rest)
      .replace(/\s{2,}/g, " ")
      .trim();
    tx.push({ date: dateISO, description: desc || null, amount: amt });
  }
  const period = extractPeriod(n);
  const cardEnding = extractCardEnding(n);
  return {
    cardEnding: cardEnding,
    statementPeriod: { from: period.from, to: period.to },
    paymentDueDate: extractDue(n),
    totalAmountDue: extractTotal(n),
    transactions: tx,
  };
}
