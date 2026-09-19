/**
 * The trader's own methodology, in their own words.
 *
 * Researched rather than guessed, because tagging vocabulary that does not match
 * how the trader actually thinks produces statistics they cannot act on. The
 * stack is MSNR (Malaysian SNR) combined with SMC/ICT — the "Alchemist" pairing.
 *
 * MSNR reads support and resistance off a LINE chart using candle BODIES rather
 * than wicks: an "A" formation marks resistance, a "V" marks support. Its
 * distinctive ideas are level freshness (untested since it formed) and level
 * flipping (old resistance becoming support). Higher timeframe sets bias, lower
 * timeframe sets entry.
 *
 * Sources: hoclamtrader.com MSNR guides; "MSNR x SMC x ICT (the Alchemist)".
 */

export interface ConfluenceGroup {
  group: string;
  /** Why a trader would care about this family of signals. */
  blurb: string;
  items: { key: string; label: string; hint: string }[];
}

export const CONFLUENCE_GROUPS: ConfluenceGroup[] = [
  {
    group: "MSNR level",
    blurb: "The level itself — how it formed and whether it has been used up.",
    items: [
      { key: "fresh_level", label: "Fresh level", hint: "Untested since it formed. The core MSNR edge." },
      { key: "unfresh_level", label: "Unfresh level", hint: "Already tested at least once, so weaker." },
      { key: "flipped_level", label: "Flipped level", hint: "Old resistance now acting as support, or the reverse." },
      { key: "a_formation", label: "A formation", hint: "Resistance shape on the line chart." },
      { key: "v_formation", label: "V formation", hint: "Support shape on the line chart." },
      { key: "body_respect", label: "Body respected it", hint: "Bodies held the level, not just wicks." },
      { key: "htf_level", label: "HTF level", hint: "The level came from a higher timeframe." },
    ],
  },
  {
    group: "Structure",
    blurb: "What the market's shape was doing when you entered.",
    items: [
      { key: "htf_bias", label: "HTF bias aligned", hint: "Trade agreed with the higher-timeframe direction." },
      { key: "bos", label: "Break of structure", hint: "Price broke a prior swing in your direction." },
      { key: "choch", label: "Change of character", hint: "First sign the prior trend is failing." },
      { key: "mss", label: "Market structure shift", hint: "Structure flipped to favour your side." },
      { key: "storyline", label: "Storyline intact", hint: "Price followed the path you mapped out beforehand." },
      { key: "trendline", label: "Trendline respected", hint: "A drawn trendline held." },
    ],
  },
  {
    group: "Liquidity",
    blurb: "Where the stops were, and whether they got taken before you entered.",
    items: [
      { key: "liquidity_sweep", label: "Liquidity sweep", hint: "Price ran the stops then reversed." },
      { key: "equal_highs_lows", label: "Equal highs / lows", hint: "Obvious resting liquidity." },
      { key: "inducement", label: "Inducement", hint: "A trap move that pulled traders in first." },
      { key: "asian_sweep", label: "Asian range swept", hint: "The overnight range was taken out." },
      { key: "session_sweep", label: "Session high / low swept", hint: "A prior session's extreme was raided." },
      { key: "judas", label: "Judas swing", hint: "False move at the open before the real one." },
    ],
  },
  {
    group: "Entry zone",
    blurb: "The precise thing you entered against.",
    items: [
      { key: "order_block", label: "Order block", hint: "Last opposing candle before the impulsive move." },
      { key: "breaker", label: "Breaker block", hint: "A failed order block now working the other way." },
      { key: "mitigation", label: "Mitigation block", hint: "Price returning to an unfilled entry area." },
      { key: "fvg", label: "Fair value gap", hint: "Three-candle imbalance price tends to revisit." },
      { key: "crt", label: "Candle range theory", hint: "Expansion out of a defined candle's range." },
      { key: "ote", label: "OTE zone", hint: "The 0.62–0.79 retracement pocket." },
      { key: "premium_discount", label: "Premium / discount", hint: "Entered on the correct half of the range." },
    ],
  },
  {
    group: "Correlation & timing",
    blurb: "Confirmation from outside the chart, and when you took it.",
    items: [
      { key: "smt", label: "SMT divergence", hint: "Gold and DXY, or a correlated pair, disagreed." },
      { key: "dxy", label: "DXY aligned", hint: "The dollar supported the direction." },
      { key: "london_kz", label: "London killzone", hint: "Inside the London window." },
      { key: "ny_kz", label: "New York killzone", hint: "Inside the New York window." },
      { key: "orb", label: "Opening range break", hint: "Break of the session's opening range." },
      { key: "news", label: "News window", hint: "Within roughly 30 minutes of high-impact news." },
    ],
  },
];

export const ALL_CONFLUENCES = CONFLUENCE_GROUPS.flatMap((g) => g.items);
export const confluenceLabel = (key: string) =>
  ALL_CONFLUENCES.find((c) => c.key === key)?.label ?? key;

/** Setup names. Editable later; these reflect the trader's described method. */
export const SETUPS = [
  "MSNR fresh level",
  "MSNR flipped level",
  "Sweep + reversal",
  "SMC order block",
  "SMT divergence",
  "Opening range break",
  "News reaction",
  "No setup — impulse",
] as const;

export const TIMEFRAMES = ["M1", "M5", "M15", "H1", "H4", "D1"] as const;

/**
 * Feelings, split by what they predict rather than by sentiment.
 *
 * Journals usually offer a mood slider, which gets filled in dishonestly or not
 * at all. A short fixed list of states a trader recognises in themselves gets
 * picked accurately, and — because it is a fixed vocabulary — it can be counted.
 */
export const FEELINGS = [
  { key: "patient", label: "Patient", good: true, hint: "Waited for it to come to you." },
  { key: "confident", label: "Confident", good: true, hint: "Clear read, no hesitation." },
  { key: "focused", label: "Focused", good: true, hint: "Fully on the chart." },
  { key: "rushed", label: "Rushed", good: false, hint: "Hurried the entry." },
  { key: "fomo", label: "FOMO", good: false, hint: "Afraid of missing the move." },
  { key: "revenge", label: "Revenge", good: false, hint: "Trying to win back a loss." },
  { key: "bored", label: "Bored", good: false, hint: "Traded to have something on." },
  { key: "hesitant", label: "Hesitant", good: false, hint: "Unsure, entered small or late." },
  { key: "tilted", label: "Tilted", good: false, hint: "Frustrated and pushing." },
] as const;

export const feelingLabel = (key: string) =>
  FEELINGS.find((f) => f.key === key)?.label ?? key;
export const isGoodFeeling = (key: string) =>
  FEELINGS.find((f) => f.key === key)?.good ?? false;

/** Execution errors, kept separate from feelings: one is a state, one is an act. */
export const MISTAKES = [
  { key: "chased", label: "Chased the entry", hint: "Entered outside your zone." },
  { key: "oversized", label: "Oversized", hint: "Risked more than your rule allows." },
  { key: "no_plan", label: "No plan", hint: "Entered without a defined invalidation." },
  { key: "moved_stop", label: "Moved the stop", hint: "Widened it once price went against you." },
  { key: "held_past", label: "Held past invalidation", hint: "The idea was dead and you stayed in." },
  { key: "early_exit", label: "Closed too early", hint: "Took it off well before the target." },
  { key: "unfresh", label: "Traded an unfresh level", hint: "The level had already been used." },
  { key: "against_htf", label: "Against HTF bias", hint: "Counter to your own higher-timeframe read." },
  { key: "overtraded", label: "Overtraded", hint: "Too many trades in the session." },
] as const;

export const mistakeLabel = (key: string) =>
  MISTAKES.find((m) => m.key === key)?.label ?? key;

/**
 * What a drawing on the chart is FOR.
 *
 * Kept to the things this trader actually marks, and worded the way MSNR and
 * SMC talk about them, so a label can later be cross-referenced with the
 * confluence tags on the same trade: "your fresh demand zones return 3× what
 * your unfresh ones do" is only possible if both sides use the same words.
 */
export const DRAWING_LABELS = [
  { key: "demand", label: "Demand zone", kind: "zone" },
  { key: "supply", label: "Supply zone", kind: "zone" },
  { key: "flip", label: "Flip level", kind: "zone" },
  { key: "liquidity", label: "Liquidity", kind: "level" },
  { key: "target", label: "Target", kind: "level" },
  { key: "structure", label: "Structure", kind: "level" },
] as const;

export const drawingLabel = (key: string) =>
  DRAWING_LABELS.find((d) => d.key === key)?.label ?? key;
