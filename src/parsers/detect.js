import { parseByBank } from "./index.js";

export const BANK_IDS = ["axis", "hdfc", "sbi", "icici", "amex"];

const BANK_PATTERNS = {
  axis: [
    /\baxis\s+bank\b/i,
    /\baxis\s+bank\s+limited\b/i,
    /\baxis\s+bank\s+credit\b/i,
    /\bedge\s+rewards\b/i,
    /\bmagnus\b|\batlas\b|\bneo\b/i,
  ],
  hdfc: [
    /\bhdfc\s+bank\b/i,
    /\bmycards\b/i,
    /\bsmartpay\b/i,
    /\bhdfc\s+bank\s+cards\b/i,
  ],
  sbi: [/\bstate\s+bank\s+of\s+india\b/i, /\bsbi\s+card\b/i, /\byono\b/i],
  icici: [/\bicici\s+bank\b/i, /\bcoral\b|\bsapphiro\b|\brubyx\b/i],
  amex: [/\bamerican\s+express\b/i, /\bamex\b/i],
};

function scoreDetection(header, bank) {
  const pats = BANK_PATTERNS[bank] || [];
  let score = 0;
  for (const r of pats) {
    const m = header.match(r);
    if (m) score += 2; // presence bonus
    const all = header.match(
      new RegExp(r.source, r.flags.includes("g") ? r.flags : r.flags + "g")
    );
    if (all) score += Math.min(all.length, 3); // frequency
  }
  return score;
}

export function detectBank(text) {
  const header = (text || "").slice(0, 8000);
  const scores = {};
  for (const b of BANK_IDS) scores[b] = scoreDetection(header, b);
  let bank = BANK_IDS[0],
    best = -1;
  for (const b of BANK_IDS) {
    if (scores[b] > best) {
      best = scores[b];
      bank = b;
    }
  }
  return { bank, score: best, scores };
}

function scoreParsed(parsed) {
  if (!parsed) return 0;
  let s = 0;
  if (parsed.cardEnding) s += 3;
  if (parsed.statementPeriod?.from) s += 2;
  if (parsed.statementPeriod?.to) s += 2;
  if (parsed.paymentDueDate) s += 2;
  if (parsed.totalAmountDue != null) s += 2;
  const txCount = Array.isArray(parsed.transactions)
    ? parsed.transactions.length
    : 0;
  s += Math.min(txCount, 15); // reward more transactions
  return s;
}

// Try all banks, choose the best result, but respect user's choice if close
export function chooseBestBankParse(text, selectedBank) {
  const det = detectBank(text);
  const results = {};
  const scores = {};
  for (const b of BANK_IDS) {
    const parsed = parseByBank(text, b);
    results[b] = parsed;
    scores[b] = scoreParsed(parsed);
  }

  // Best by parse score
  let bestBank = BANK_IDS[0],
    bestScore = -1;
  for (const b of BANK_IDS) {
    if (scores[b] > bestScore) {
      bestScore = scores[b];
      bestBank = b;
    }
  }

  // If user selected a bank and it's close (within 2 points), prefer it
  const sel = (selectedBank || "").toLowerCase();
  const selectedScore = scores[sel] ?? -1;
  const bankUsed =
    sel && selectedScore >= 0 && bestScore - selectedScore <= 2
      ? sel
      : bestBank;

  return {
    bankDetected: det.bank,
    detectionScore: det.score,
    detectionScores: det.scores,
    bankUsed,
    parseScores: scores,
    parsed: results[bankUsed],
  };
}
