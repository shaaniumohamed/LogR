# High-Frequency Redesign — ~100 orders/day

This document supersedes parts of `10-ui-ux.md` and `11-behavioural-design.md`.
Those were written assuming a handful of trades per day. At ~100 orders/day with
layering, several core design decisions are simply wrong and have to be replaced.

Being explicit about what broke, because the failures are instructive:

| Design | Assumed | Reality at 100/day | Status |
|---|---|---|---|
| Tap invalidation level per trade | ~3 trades/day | 100 taps/day. Nobody will ever do this | **Dead** |
| "This is trade 4, your expectancy drops after 3" | Low trade count | Trade number is meaningless | **Dead** |
| 45-second daily review | ~3 trades | Wrong budget for the wrong unit | **Rescoped** |
| Per-trade manual tagging | Low volume | 25,000 tags/year. Not happening | **Must be automatic** |
| Exness CSV import | Occasional export | 1,000-row cap = **10 days per file** | **Chunking mandatory** |
| Poll positions every 30s | Trades last minutes | Scalps open and close between polls | **Needs streaming** |

## 1. The unit of journaling is the cluster, not the trade

At this frequency you do not think in individual fills. You think in **trade ideas**
(an entry plus its layers plus its partial exits) and in **blocks** (a run of
activity inside a session). So the data model's third layer carries almost all the
weight, and the clustering has to be good.

```
~100 orders/day
   ↓  auto-group by symbol + direction + time proximity + layering pattern
~15–25 trade ideas/day        ← this is what you tag, review and see
   ↓  group by session / activity block
~3–5 blocks/day               ← this is what you write a note about
   ↓
1 day                         ← this is what gets graded
```

Everything in the UI defaults to the **trade idea** level. Individual orders are
drillable but never required. The day review shows a timeline of blocks and ideas,
not a list of 100 rows.

Revised review budget: **~2 minutes/day for ~20 clusters**, not 45 seconds for 3
trades. Still realistic, and still the binding constraint on whether the whole
product works.

## 2. Setup-level invalidation rules — this is how R survives

The per-trade tap is dead. The replacement is better:

> **Define invalidation as a rule once per setup. Compute it per trade automatically.**

You said you run a couple of setups. For each, express invalidation as a rule
against price data we already have:

- `swing low of the N-minute candle before entry`
- `X × ATR(14, M5) from entry`
- `beyond the session range boundary`
- `fixed $ distance` (with an ATR-scaled variant)

The engine then computes `risk_amount` and `r_multiple` for **all 100 trades/day
with zero per-trade input**, and `risk_source` becomes `setup_rule` — a fourth
category alongside the ones in `09-risk-model.md`, and an honest one, because the
rule was declared in advance rather than fitted after the fact.

This also makes invalidation discipline measurable at scale: the rule says where
the idea died, the bars say whether you were still in the trade past that point.

**Per-trade tapping survives only as an exception flow** — for the handful of
trades you want to annotate specifically, reachable from any trade, never required.

## 3. Setup discovery — 25k trades/year makes this genuinely powerful

At this volume, unsupervised clustering on trade features stops being a gimmick.
Cluster on: time of day, direction, ATR regime, entry position within the recent
range, distance from the previous trade, layering pattern, hold time, size
relative to your average.

> *"You describe two setups. The data shows four distinct behavioural clusters.
> Cluster 3 — 340 trades, no name, all after 15:00, entries into extended moves —
> is −$2,400. It does not appear in either of your described setups."*

That finding is only reachable with volume, and it answers a question you cannot
answer by introspection: **what are you actually doing, as opposed to what you
think you're doing?** Auto-suggest a setup label per cluster; you confirm or
correct with one tap, and the labels propagate to every past trade in the cluster.

This is the feature that makes high frequency an *advantage* rather than a burden.

## 4. Cost analysis is now the headline feature, not a Tier 1 feature

You're on a **Pro account, which charges no separate commission** — the entire
execution cost is [embedded in the spread](https://copi-tools.com/blog/exness-account-type/).
That means it never appears as a line item anywhere, in MT5 or in any statement.
**You currently cannot see what trading costs you, at all.**

At ~100 round trips/day, a rough order of magnitude:

```
100 round trips/day × 0.10 lots × $0.18 average spread × 100 oz/lot
  ≈ $180/day  ≈ $3,900/month  ≈ $47,000/year
```

Scale that to your real size. On almost any plausible assumption, **spread is the
largest single line item in your trading**, larger than your net P&L, and it is
completely invisible today. Quantifying it precisely is the highest-value thing
this app can do for you, and it directly informs two decisions worth real money:

1. **Is Pro the right account?** Raw Spread on gold is roughly
   [~$0.05 spread + $3.50/lot/side ≈ $12/lot round trip](https://get.exness.help/hc/en-us/articles/17854173039388-Commodities),
   against Standard's ~$20/lot. Once we measure your *actual* average paid spread
   and volume, the comparison across account types becomes arithmetic, not opinion.
   This alone could pay for the entire project.
2. **What is your minimum viable target?** Below some movement, a scalp is
   mathematically negative after costs at your win rate. The app can state that
   number in dollars.

### Measuring spread on a Pro account
No commission field to read, so we reconstruct it: stream XAUUSD quotes
continuously during trading hours and store bid/ask, then match fill timestamps
against them. **Single-instrument focus makes this cheap** — one symbol, ~13
active hours/day. Downsampled to per-second bid/ask that's ~47k rows/day, trivially
manageable, and it gives exact spread-at-fill for every one of your 100 daily
trades, plus the rollover and news widening patterns.

## 5. Tilt detection, redesigned for rate rather than count

"Trade number 4" is meaningless. The scalper's tilt signals are about **pace and
size**, and they're measurable:

- **Rate acceleration** — trades per 15 min vs your session baseline. Revenge
  scalping shows up as a rate spike before it shows up anywhere else
- **Size creep within a session** — average size in the last 10 trades vs the first 10
- **Rolling P&L** — last 10 trades net, vs your historical distribution for a
  10-trade window
- **Cluster degradation** — trades drifting away from your identified setups and
  into the unnamed cluster
- **Session duration** — hours traded vs your normal, since fatigue at 100/day is real

> *"Last 30 minutes: 22 trades, 2.1x your normal pace, average size up 40%, net
> −$310. Your historical outcome from this pattern: −$580 over the following hour."*

Warn-only, as you chose. One alert per condition per session — at this frequency,
anything chattier gets muted within a day, and a muted alert is worth nothing.

## 6. Architecture consequences

**Streaming, not polling.** A scalp can open and close inside a 30-second polling
window. History deals are durable so polling *history* won't lose closed trades —
but live positions, live equity extremes and any in-session intervention need a
real-time stream.

This means **one small always-on worker** holding the MetaApi WebSocket and
forwarding to the Vercel ingest endpoint. Vercel cannot hold a persistent socket,
so the honest position is: *the web app is Vercel-native; there is one ~$5/month
companion process elsewhere* (Fly.io / Railway). Small, stateless, restartable,
and it also hosts the quote capture from §4.

**Volume.** ~25k orders/year/user. Postgres handles it easily, but:
- `daily_stats` rollups become mandatory, not an optimisation
- trade lists must be virtualised; never render 100 rows unbatched
- the calendar cell should show trade count alongside P&L — at this frequency,
  count *is* a signal
- clustering runs incrementally per day, not over full history

**Import chunking.** The 1,000-row CSV cap covers ~10 days of your trading. The
importer must auto-chunk by date range and stitch, or it will silently truncate —
and silent truncation is the worst possible failure for a tool whose credibility
rests on matching your statement.

## 7. Cent account — a real landmine

You also use a **cent account**. On Exness cent accounts balance, equity and P&L
are denominated in cents (a $100 deposit displays as 10,000) and contract sizes
differ. Aggregating a cent account with your Pro account naively produces P&L
wrong by a factor of 100.

Required: an explicit `is_cent_account` flag and a `display_multiplier` on
`trading_accounts`, contract specs captured per account rather than per symbol,
and **portfolio views that normalise before summing**. Add a golden-fixture test
for exactly this case — it is the kind of bug that is invisible until it is
catastrophic.

Worth noting: a cent account is an ideal place to test the rules engine and any
future guardrails against real execution at negligible risk.

## 8. Good news: statistical power

Every "wait for sample size" caveat in `06-metrics-spec.md` relaxes dramatically.
At ~100 orders/day (~20 trade ideas/day):

- A month gives ~400 trade ideas — enough for confident per-setup expectancy
- **Your 3 weeks of existing history is already ~1,500 orders** — the first import
  will produce statistically meaningful findings immediately, not "come back in
  six months"
- Segmentations that need N≥30 are reachable within days, so session × ATR-regime
  grids will actually populate

**One honest caveat to surface in the UI:** three weeks is a lot of trades but only
one market regime. Conclusions will be regime-specific until the history spans
several. The app should say so rather than implying the numbers are timeless.

## 9. And the thing that matters most

You don't journal now. So there is no existing habit to port — the app has to
create one from nothing, against a workflow where any per-trade friction is
instantly fatal. That is the whole argument for: automatic import, automatic
clustering, automatic setup discovery, rule-based invalidation, and a review
that asks for judgement at the cluster level and nowhere else.

**Design test for every feature from here: does this still work at 100 orders a
day?** If it needs per-trade input, it's wrong.
