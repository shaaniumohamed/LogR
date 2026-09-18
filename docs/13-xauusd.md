# XAUUSD Specialisation

Trading a single instrument is a **strategic advantage for the journal**, not a
limitation. A generic journal must hedge across asset classes and ends up shallow
everywhere. A gold-only journal can go deep enough to say things no generic tool
can. The schema stays multi-instrument (friends may trade other things); the
*analytics defaults* become gold-aware.

## What drops out

| Generic feature | Why it's dead weight here |
|---|---|
| Symbol performance breakdown | One symbol. A table with one row is not a feature |
| Cross-instrument correlation exposure | Nothing to correlate against |
| Asset-class contract-spec abstraction | One spec: 100 oz/lot, quoted in USD |
| Multi-currency conversion | Gold is USD-quoted; only account currency conversion matters |
| Swap / carry analysis | Intraday trader, frequently swap-free on Exness. Keep it, demote it |

That's five features removed from the roadmap. Their budget goes into the four below.

## What becomes primary

### 1. Volatility regime — the single most important segmentation  ⭐
Gold at [$4,353 today after a $5,602 ATH in January 2026](https://www.tradingview.com/symbols/XAUUSD/)
is a fundamentally different instrument week to week. A $5 stop is generous in a
quiet range and is pure noise-absorption on a 100-point day.

**Segment every statistic by daily ATR percentile** (or current ATR vs its 20-day
average), bucketed low / normal / high / extreme. Findings this produces:

> *"Your scalps return +0.41R when daily ATR is below its 20-day average, and
> −0.29R above it. 62% of your trades are in the high bucket."*

> *"Your stop distance is effectively constant at ~$4 regardless of conditions.
> In the high-ATR bucket your MAE p80 on **winning** trades is $9.40 — you are
> being stopped out by noise on trades that were right."*

The corrective is concrete and immediately usable: **scale stop and target with
ATR, and size down so risk in currency stays constant.** That is a rule the app
can then enforce and grade.

### 2. News proximity — gold is the most news-sensitive liquid instrument
US CPI, NFP, FOMC, PPI, retail sales, jobless claims and Fed speakers move gold
violently, directly and via DXY and real yields. This moves economic-calendar
integration from Tier 3 to **Tier 1**.

- Auto-tag every trade with minutes-to/from the nearest high-impact USD event
- Segment expectancy by that distance: pre-news, in the ±15m window, post-news
- Track spread behaviour through the event — gold spreads blow out around releases
  and a scalp entered into that is paying several times normal cost

> *"Trades within 30 minutes of high-impact USD news: 34 trades, −£2,100.
> Outside that window: 156 trades, +£3,400."*

If that's what the data says, the fix is one rule and it's free money.

### 3. Spread and cost conditions — brutal on gold scalps
The bridge captures bid/ask on every poll, so we can log **actual spread at entry**
rather than assuming the advertised one.

- **Spread-at-entry histogram.** Flag entries taken at 2x+ normal spread
- **Rollover trap.** Spreads widen sharply around the daily rollover; entries in
  that window pay a tax most traders never notice. Auto-detect and tag it
- **Cost as % of target.** If you're scalping a $3 move on a $0.25 spread, 8% of
  your edge is gone before the trade starts — and that's before commission on a
  Raw Spread or Zero account
- **Minimum viable target.** From your win rate and actual cost distribution,
  compute the target size below which expectancy is negative. A hard number:
  *"below $2.40 of movement, your scalps are not worth taking."*

### 4. Session structure, gold-specific
Not generic FX sessions. Gold's real structure:
- Asia (thin, range-prone, wide relative spread)
- London open (first real directional move)
- **Pre-NY / US data window** (the main event, and the main risk)
- NY open
- Post-NY afternoon (frequent reversal / fade of the day's move)
- Rollover window (avoid)

Combined with the ATR regime, this is a 2-D grid, and it is where the actionable
answer lives: *"London open in high-ATR conditions is where all your profit comes
from. Asia in any condition has cost you £1,840."*

## Contract maths (get this exactly right or every number is wrong)

```
1 standard lot XAUUSD = 100 troy oz
$1.00 price move on 1.00 lot   = $100.00
$1.00 price move on 0.01 lot   = $1.00
Exness quotes to 2 decimals (some accounts 3) → 1 tick = $0.01 = $1.00 per lot

risk_amount = |entry − invalidation| × 100 × lots        (USD)
             → convert to account currency at the broker's rate

Example: £10,000 account, 1% risk, $6.00 invalidation distance
  risk = £100 ≈ $127  →  lots = 127 / (6.00 × 100) = 0.21 lots
```

**Display convention:** show distances in **dollars of price movement**, never in
"pips". "Pip" is ambiguous for gold — some people mean $0.10, others $1.00 — and
ambiguity in a risk number is unacceptable. Use `$4.20 stop`, not `42 pips`.

## Gold-specific additions worth considering

- **Round-number behaviour.** Gold respects round hundreds and fifties. Tag entry
  and exit distance from the nearest round level; check whether entries close to
  one perform differently.
- **Day-of-week.** Gold has a distinct Monday-gap and Friday-afternoon character.
- **DXY / real-yield context** as a daily regime tag, if a cheap data source
  exists. Lower priority than ATR regime — start with volatility, which is free
  from the bars we already have.
- **Gap handling.** Weekend gaps on gold are real. Positions held over the weekend
  need separate treatment in MAE/MFE, since the gap is not an excursion you could
  have traded out of.

## Consequence for the prototype

Demo data should be XAUUSD only, at realistic 2026 levels (~$4,300–4,400), with
realistic intraday ranges for the current regime, 0.05–0.30 lot sizes, layered
entries, partial exits, and a spread of roughly $0.20–0.35 widening around news.
Fake data that looks wrong to a gold trader undermines the prototype's whole
purpose.
