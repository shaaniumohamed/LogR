# Methodology Model — zone trades, confluence, and automatic structure annotation

The trader's stack: a confluence of several named methodologies (MAnE, Alchemist
SNR, SMC, Fibonacci). Execution pattern: identify a **zone**, **layer** into it,
hold a **mental invalidation** (the level where the idea is dead), target the
**next liquidity pool or resistance**, take **partials** on the way, move runners
to **breakeven**.

This is specific enough to model properly, and modelling it properly turns out to
unlock the single best feature in the product.

> **Note on the named methodologies:** the app must not hardcode anyone's
> interpretation of MAnE, Alchemist SNR, SMC or fib. Confluence factors are
> **user-defined objects**, and the trader names their own. What the app supplies
> is (a) auto-detection of the mechanical, price-derivable ones and (b) the
> statistics over whatever taxonomy the user defines.

---

## 1. The Zone Trade is the unit

Confirmed: a chunk of layers = one trade. Formally:

```
ZoneTrade
  direction          long | short
  zone_high          upper bound of the layering region     ← inferred from fills
  zone_low           lower bound                            ← inferred from fills
  entry_legs[]       each layer: price, size, time
  avg_entry          size-weighted
  invalidation       the mental stop level                  ← rule or one tap
  targets[]          next liquidity pool / resistance level(s)
  exit_legs[]        each partial + the runner
  be_moved_at        when the runner went to breakeven
  confluences[]      which factors were present
  fill_depth         how deep into the zone price actually went
```

### Clustering rule (better than time proximity)
Generic journals group by time. For zone layering, **price band is the stronger
signal** — layers are by definition close in price:

```
Same direction
AND entry prices within a band of k × ATR(M5)   ← the zone
AND no intervening exit that takes position flat
AND within a reasonable time window (zones can fill over hours)
  → one ZoneTrade
Position goes flat  → cluster closes. A later re-entry in the same zone is a NEW trade.
```

User-correctable: merge and split from the UI, because the algorithm will
occasionally be wrong and the trader's intent is authoritative.

---

## 2. R comes for free, from zone geometry

This is the payoff for modelling zones. The invalidation isn't arbitrary — it's
**structural**, it sits just beyond the zone, and it's known before entry. So:

```
default invalidation (long)  = zone_low − buffer     (buffer = j × ATR, learned per setup)
risk_amount                  = |avg_entry − invalidation| × 100 oz × total_lots
r_multiple                   = net_pnl / risk_amount
```

The app proposes the invalidation from zone geometry, the trader confirms or
adjusts **once per zone trade** — roughly 5–15 per day, not 100. And with a
setup-level rule defined (`09`, `14`), most days need no input at all.

`risk_source` becomes `zone_geometry` (inferred) or `zone_confirmed` (user
verified) — both honest, and distinguishable in the UI.

---

## 3. Fill-depth analysis — novel, and specific to layering

When you ladder a zone, **how much of the ladder fills is itself a signal.**
Price that only grazes the top of the zone fills one layer; price that runs
through the whole zone fills everything and is also closest to invalidating.

Track `fill_depth` = how far into the zone price travelled, as a % of zone height.
Then segment expectancy by it:

> *"Trades where only 1–2 layers filled: +0.58R over 140 trades.
> Trades where the full ladder filled: −0.31R over 96 trades.
> A full fill means price disrespected your zone — it is a warning, not a discount."*

Or the inverse, which is equally actionable. Either finding changes how you ladder:
tighter zones, fewer layers, or skip the deep fills entirely. No generic journal
can produce this because no generic journal knows what a zone is.

Related: **zone width vs ATR.** Too wide and the average entry is poor and
invalidation is far; too narrow and layers don't fill. There is an optimum and it
is measurable.

---

## 4. Automatic structure annotation  ⭐ the big one

Every mechanical SMC / price-structure concept is **computable from OHLC bars**,
which we already have per trade. Nothing needs tagging:

| Concept | Detection from bars |
|---|---|
| Swing highs / lows | Fractal / pivot detection over the relevant lookback |
| BOS / CHoCH | Sequence break in the swing series |
| Liquidity sweep | Price exceeds a prior swing then closes back inside |
| Equal highs / lows (liquidity pools) | Clustered swing extremes within a tolerance |
| Fair value gap / imbalance | 3-bar gap: `bar1.high < bar3.low` (bullish) |
| Order block | Last opposing candle before the impulsive leg |
| Premium / discount | Position of entry within the dealing range |
| Fib retracement level | Entry as a % retracement of the prior impulse leg |
| HTF bias alignment | Direction vs the higher-timeframe swing structure |
| Distance to nearest liquidity pool | Price distance from entry to the next clustered extreme |

So **every one of ~4,000 historical trades can be annotated automatically** with
the structural context it occurred in — retroactively, for trades already closed,
with no tagging from the trader at all.

Implementation note: these detectors must be **parameterised and tunable**
(lookback, tolerance, buffer) and validated against trades the user labels by
hand, because every SMC practitioner draws them slightly differently. Ship the
parameters as user-editable, with sensible defaults, and show the detected
structure drawn on the trade's chart so the user can see whether the detector
agrees with their eye. A detector the user doesn't trust is worse than none.

---

## 5. Confluence marginal value  ⭐⭐ the killer feature

A confluence methodology raises one question it can never answer by feel:

> **Which of my confluences actually carry the edge, and which are decoration?**

With ~4,000 trades and automatic annotation, this is answerable properly.

**Analysis 1 — expectancy by confluence count**
> *"5+ confluences: +0.51R (n=210). 3–4: +0.18R (n=980). 1–2: −0.14R (n=1,640)."*

**Analysis 2 — marginal contribution of each factor** (the valuable one)
Hold everything else constant and isolate each factor's incremental effect —
logistic/linear model on outcome, or matched-pair comparison where trades are
identical but for one factor:

> *"Liquidity sweep before entry: **+0.34R marginal** (n=890) — your strongest factor.*
> *HTF bias alignment: **+0.22R marginal** (n=1,450).*
> *Fib OTE zone: **+0.02R marginal** (n=1,100) — statistically indistinguishable
> from zero. Dropping it as a requirement would qualify ~40% more setups at
> materially the same expectancy."*

That last line is worth real money in both directions: either it removes a filter
that costs opportunity, or it confirms the filter earns its place. Neither
conclusion is reachable without thousands of annotated trades — which is exactly
what this trader has and a lower-frequency trader never would.

**Analysis 3 — confluence interactions.** Some factors only work together. A
simple pairwise interaction table over the top factors catches "fib only helps
when it coincides with an order block".

**Honesty guards:** report sample size and CI for every factor; never present a
marginal effect below the minimum N; state plainly that this is correlational.
And flag when factors are collinear — if two confluences almost always co-occur,
their individual contributions are not separable, and saying so is more useful
than inventing a split.

---

## 6. Target and exit analysis, with structure

Targets are structural ("next liquidity pool or resistance"), and those levels
are detectable — so exits can be graded against them:

- **Target reached?** Did price hit the identified pool before invalidating?
- **Exit vs target**: MFE relative to the structural target, not an arbitrary R
- **Partial placement**: are partials landing before an intermediate level that
  price then blows through, or at a level that price respects?
- **Runner outcome vs target**: does the runner actually reach the pool often
  enough to justify leaving size on?

> *"Price reached your identified target on 47% of trades. On those, your runner
> captured 61% of the move to target. Your partials averaged 0.4R while the target
> was 2.1R away."*

---

## 7. The retest problem — breakeven interacts badly with zone trading

This is a structural prediction worth testing on the data. Zone entries very often
see price **return to the zone** before continuing. Moving the runner to breakeven
right after the first partial therefore has an elevated chance of being knocked
out by ordinary retest behaviour, specifically for this style:

> *"On 41 trades price retested your zone after your first partial. Your BE stop
> was hit on 29 of them, and 17 of those went on to reach your target. Cost: 14.8R.
> Moving to BE only after price cleared the zone by 1× its height would have kept 11 of them."*

That gives a concrete, testable rule change — **BE trigger based on structure
(distance cleared from the zone) rather than on "after the partial"** — and once
it's a rule, the app can grade adherence to it.

---

## 8. What the trader tags vs what is automatic

| Automatic | Tagged by the trader |
|---|---|
| Zone bounds (from fills) | Confirm/adjust the zone if the grouping is wrong |
| Layer grouping into one trade | Merge/split when the algorithm is wrong |
| Invalidation proposal (zone geometry + setup rule) | Confirm, or correct the level |
| All mechanical structure (sweep, FVG, OB, BOS, fib, premium/discount, HTF bias) | Nothing |
| Liquidity pools and targets | Confirm which one was the intended target |
| Fill depth, MAE/MFE, spread paid, ATR regime, session, news proximity | Nothing |
| Partial/runner/BE accounting | Nothing |
| Setup suggestion from cluster similarity | Confirm the setup name |

**Trader input per zone trade: 2–3 taps.** At ~5–15 zone trades/day, that is the
2-minute daily review from `14-high-frequency.md`, and it produces a fully
annotated dataset.

Non-mechanical confluences — the discretionary reads from a specific methodology —
stay as user-defined tags with a one-tap chip grid, ordered by that user's own
frequency of use.

---

## 9. Why this combination is unusually favourable

Most journals face a trade-off: rich annotation requires manual work, and manual
work doesn't scale. Here the constraints line up the other way:

- **One instrument** → structure detectors need tuning once, not per asset
- **High frequency** → thousands of annotated trades, so marginal-value analysis
  has real statistical power within weeks
- **Mechanical methodology** → most of the annotation is derivable from price
- **Zone layering** → the trade unit is well-defined, and invalidation follows
  from geometry rather than needing to be declared per trade

The result is a dataset most discretionary traders could never assemble, and it
can be built with almost no typing.
