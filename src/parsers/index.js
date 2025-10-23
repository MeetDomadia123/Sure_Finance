import { parseGeneric } from "./generic.js";
import { parseAxis } from "./axis.js";
import { parseHdfc } from "./hdfc.js";
import { parseSbi } from "./sbi.js";
import { parseIcici } from "./icici.js";
import { parseAmex } from "./amex.js";

export function parseByBank(text, bank) {
  switch ((bank || "").toLowerCase()) {
    case "axis":
      return parseAxis(text);
    case "hdfc":
      return parseHdfc(text);
    case "sbi":
      return parseSbi(text);
    case "icici":
      return parseIcici(text);
    case "amex":
    case "american express":
      return parseAmex(text);
    default:
      return parseGeneric(text);
  }
}
