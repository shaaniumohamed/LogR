# Risk Model — journaling a discretionary trader with no fixed stop

## The problem

Standard journal maths assumes: one entry, one hard stop, one exit.
`R = net_pnl / (|entry − stop| × size)`.

The actual described workflow is none of those things:

- **No hard SL while actively monitoring** — exit when the trade idea is invalidated
- **Layered entries** when scalping — several fills building one position
- **Partial exits** — take some off at a small profit, leave a runner for full TP
- **Stop moved to breakeven** after the partial
- Scalps have low R:R by design; mostly intraday

So `initial_sl` is frequently `NULL`, and "the trade" is a cluster of fills on both
sides. If the app demands a stop loss it will be wrong, annoying, and unused.

**Design stance: the journal adapts to the trader, not the reverse.** But
*something* has to normalise risk, or expectancy, drawdown projection and
prop-firm sizing are all guesswork.

## Four risk models, chosen per trade (or defaulted per playbook)

| Model | Risk = | When it applies | Data quality |
|---|---|---|---|
| `hard_sl` | `\|entry − SL\| × size` | SL was on the platform at entry | **measured** |
| `invalidation` | `\|entry − invalidation_price\| × size` | You name the level where the idea dies | **declared** |
| `fixed_fraction` | `pct × balance_at_open` | "I was risking ~0.5% on this" | **declared** |
| `mae_proxy` | `MAE_distance × size` | Backfilled history, nothing declared | **estimated** |

Every trade stores `risk_source`, and **the UI always shows which**. A measured R
and an estimated R must never render identically — quietly mixing them is how a
journal starts lying to you.

### The `invalidation` model is the important one

You already know where the idea is invalid — that's what you're watching for. The
app's only job is to capture that number with near-zero friction. Two ways:

1. **Tap it on the chart.** In the end-of-day review, each untagged trade shows its
   own M1 chart with your entry and exit marked. You tap the level where the idea
   would have been dead. ~3 seconds per trade, on a phone, and it feels like
   chart-reading rather than data entry.
2. **Type a price** for anyone who prefers it.

This unlocks a metric that matters more to you than R itself:

> **Invalidation discipline** — did you actually exit at your invalidation level,
> or did you hold past it?

For a mental-stop trader, *that* is the leak. A platform stop can't be
disobeyed; a mental one can, and the cost is invisible today. Once the level is
recorded, the app can say: *"On 23 trades you held past your own invalidation.
Exiting there would have saved £1,940. On the 9 where holding worked, it gained
£310."* That single report justifies the whole tapping ritual.

## Multi-leg trades are the normal case, not an edge case

The data model already has `executions → positions → trades`. For this trader the
third layer carries real weight, and three analyses fall out of it that no generic
journal produces:

### 1. Runner analysis  ⭐ the highest-value feature for this style
Split every scaled-out trade into **the partial** and **the runner**, and compute
expectancy on each separately.

The question it answers: *is the runner actually paying for itself?*
There are only three possible findings and all of them are actionable:

- Runner expectancy strongly positive → **take smaller partials**, you're cutting winners
- Runner expectancy ≈ 0 → the runner is free optionality, keep it, it costs nothing
- Runner expectancy negative → **take full TP at your first target**; the runner is
  a losing habit dressed up as letting winners run

> *"Your partials return +0.31R. Your runners return −0.08R over 87 trades.
> Closing in full at your first target would have made £1,420 more this year."*

### 2. Breakeven-stop cost analysis
You move the stop to BE after the partial. That is protective, and it also gets
you knocked out of trades that then work. With post-exit M1 bars we can measure it
exactly:

> *"You moved to breakeven on 41 trades. 19 were stopped at BE and then reached
> your original target anyway — cost: 11.2R. On the other 22, BE saved 4.1R.
> Net: moving to BE cost you 7.1R this year."*

Then the refinement: *at what distance does moving to BE stop being net-negative?*
The data answers it — e.g. "only move to BE after 1.5R of favourable movement".

### 3. Layering / scale-in analysis
When you layer into a scalp:

> *"Layered entries improved your average price by 4.2 pips, but increased size
> 2.3x. On layered trades that ultimately lost, the extra size cost £840 —
> more than the £310 the better average price earned on winners."*

Layering is mathematically **averaging into a position**, which is fine when the
thesis is intact and ruinous when it isn't. Splitting layered trades by outcome
tells you which one you're actually doing.

## Scalping economics — the cost report

Scalps have low R:R by construction, which makes them uniquely vulnerable to costs.
Spread + commission is a fixed tax per round trip, so it consumes a much larger
share of a 5-pip target than a 50-pip one.

> *"Your scalps grossed +£1,840 and netted +£310. 83% of your scalping edge went
> to spread and commission. Your intraday swings kept 91% of theirs."*

This needs the Exness account type (Standard vs Raw Spread vs Zero vs Pro) to
attribute cost correctly. Follow-on analysis: **minimum viable target size** —
below roughly N pips, expectancy after costs is negative for your win rate, so
there is a target size under which a scalp is not worth taking. That's a hard
number the app can hand you.

## What replaces R as the headline

R stays, computed wherever risk is measured or declared, and flagged when it isn't.
But for this style the honest primary lens is:

1. **Expectancy in % of account** — always computable, no stop required
2. **Net after costs vs gross** — because scalping edge lives or dies here
3. **Invalidation discipline %** — the behavioural metric that's actually yours to fix
4. **R**, on the subset of trades where risk was measured or declared

And the app should say plainly what share of trades have measured risk. "R computed
on 62% of trades" is a trust signal; silently averaging real and guessed R is not.
