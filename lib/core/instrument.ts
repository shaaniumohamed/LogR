/**
 * What the app is allowed to assume about an instrument.
 *
 * As little as possible. The journal was written around one trader's gold
 * account and quietly baked that in — a contract size of 100 in the risk
 * arithmetic, a spread of fifteen to thirty cents an ounce in the cost estimate.
 * Both are silently wrong for anyone trading anything else, and silently wrong
 * is the worst kind: a friend on EURUSD would have been shown a spread bill
 * roughly a thousand times too small and an R figure to match, with nothing on
 * screen to suggest either was made up.
 *
 * So the rule here is that anything derivable from the trader's own fills is
 * derived (see pointValuePerLot in metrics.ts), and anything that genuinely
 * needs outside knowledge either comes from this short, honest table or is not
 * shown at all.
 */
import { normalizeSymbol } from "./symbols";

export interface SpreadRange {
  /** In price units of the instrument, not pips or cents. */
  lo: number;
  hi: number;
  /** How to say the size in words, for the explanation. */
  describe: string;
}

/**
 * A typical retail spread, where one is known well enough to be worth printing.
 *
 * Returns null for anything not listed, and the cost estimate simply disappears
 * rather than guessing. An absent figure costs a reader nothing; a confident
 * wrong one costs them their trust in every other figure on the page.
 */
export function spreadRange(symbol: string): SpreadRange | null {
  const s = normalizeSymbol(symbol);

  if (s.startsWith("XAU")) return { lo: 0.15, hi: 0.3, describe: "15 to 30 cents an ounce" };
  if (s.startsWith("XAG")) return { lo: 0.015, hi: 0.035, describe: "1.5 to 3.5 cents an ounce" };

  // Six letters, both halves a currency code: an FX pair. JPY pairs are quoted
  // to two decimals rather than four, so their pip is a hundred times larger.
  if (/^[A-Z]{6}$/.test(s) && isCurrency(s.slice(0, 3)) && isCurrency(s.slice(3))) {
    return s.endsWith("JPY") || s.startsWith("JPY")
      ? { lo: 0.008, hi: 0.02, describe: "roughly one to two pips" }
      : { lo: 0.00008, hi: 0.0002, describe: "roughly one to two pips" };
  }

  return null;
}

const CURRENCIES = new Set([
  "USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "NZD",
  "SEK", "NOK", "DKK", "SGD", "HKD", "MXN", "ZAR", "TRY", "PLN", "CZK", "HUF", "CNH",
]);

function isCurrency(code: string): boolean {
  return CURRENCIES.has(code);
}

/** How many decimals a price is worth showing to. */
export function priceDecimals(symbol: string): number {
  const s = normalizeSymbol(symbol);
  if (s.startsWith("XAU") || s.startsWith("XAG")) return 2;
  if (/^[A-Z]{6}$/.test(s) && isCurrency(s.slice(0, 3)) && isCurrency(s.slice(3))) {
    return s.includes("JPY") ? 3 : 5;
  }
  return 2;
}
