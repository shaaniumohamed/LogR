# Metrics Specification

Journals lose trust when their numbers disagree with the broker or with other
tools. Every statistic is defined here once, implemented once in
`/packages/core/metrics`, and unit-tested with a worked example.

**Global rules**
- All money in account currency unless stated; portfolio views convert explicitly.
- `net_pnl = gross_pnl - commission - fee + swap` (swap is signed; it is usually
  negative but can be positive on carry).
- **Scratch trades** (`|net_pnl| < 0.1 × avg_win` or a user-set threshold) are
  counted in trade count but excluded from win rate numerator *and* denominator.
  This is shown in the UI — undisclosed scratch handling is how tools get
  accused of lying.
- Every stat displays its **sample size**. A 100% win rate over 3 trades must
  never be rendered the same way as 62% over 400.
- Open positions are excluded from realised stats and shown separately.

## Core

| Metric | Definition | Notes |
|---|---|---|
| Net P&L | `Σ net_pnl` | Must reconcile to the broker statement to the cent |
| Gross P&L | `Σ gross_pnl` | Excludes costs; the gap between these two is a feature |
| Win rate | `wins / (wins + losses)` | Scratches excluded; state N |
| Profit factor | `Σ wins / |Σ losses|` | Undefined with zero losses → show "—", not ∞ |
| Avg win / avg loss | `mean(win) / |mean(loss)|` | The payoff ratio |
| Expectancy ($) | `(WR × avgWin) − (LR × |avgLoss|)` | Per trade |
| Expectancy (R) | `mean(r_multiple)` | **The headline number.** Only over trades with measured risk |
| Max drawdown | peak-to-trough of the equity series | Two variants, below |
| Avg hold time | `mean(duration_s)`, split winners vs losers | Winners shorter than losers = cutting winners, riding losers. Diagnostic gold |

### R-multiple
```
risk_amount = |entry_price − initial_sl| × contract_size × volume × tick_value_factor
r_multiple  = net_pnl / risk_amount
```
- `initial_sl` from the **first opening execution** (`sl_at_execution`), never the
  SL at close.
- No SL → fall back in this order, and **record which**:
  1. user-entered risk for that trade
  2. account default risk % × balance at open
  3. excluded from R stats entirely (never silently assume)
- Commission/swap inclusion in `risk_amount`: **excluded** (risk is the price
  distance), but they are included in `net_pnl`. Documented in the UI tooltip.

### Drawdown — two different numbers, both needed
- **Closed-trade drawdown**: peak-to-trough of cumulative realised P&L. What most
  journals show. Understates real pain.
- **Equity drawdown**: peak-to-trough of `account_snapshots.equity` (EA only).
  Includes open floating loss. **This is what prop firms measure and what actually
  blows accounts.** Display both, labelled clearly; default to equity when available.

### Return measurement with frequent cash transfers  ⭐ required
Small accounts often see many deposits and withdrawals over a short period. A
simple percentage gain is then close to meaningless: withdrawing profits shrinks
the denominator and inflates the reported return, and a "600% gain" can sit on top
of a balance far smaller than the total deposited.

**Requirement: compute time-weighted return (TWR), not simple gain.**
```
Break the series at every cash transfer. For each sub-period:
    r_i = (equity_end − flow_i) / equity_start − 1
TWR = Π(1 + r_i) − 1
```
Also report **money-weighted return (IRR)** alongside it, since the two answer
different questions: TWR measures the strategy, IRR measures what the trader
actually earned on the capital they had at risk.

Display both, plus the raw cash-flow ledger (total in, total out, net). Never show
a headline percentage that a withdrawal could have manufactured. Broker-supplied
"gain" figures should be treated as an input to reconcile against, not as truth.

### Prop-readiness check  ⭐ required before any challenge
Given the user's own history, evaluate it against the rule set of a target prop
firm *retrospectively*:

- Would the max daily loss have been breached, and on how many days?
- Would the max total drawdown have been breached, and when?
- Would the consistency rule have failed (largest day as % of total profit)?
- Is the historical max drawdown within, say, half the firm's limit?

Output one sentence: *"On these rules your last N weeks would have breached on day
X."* A trader planning a challenge needs this **before** paying a fee, and it is
computable from data already imported. High-variance retail equity curves routinely
exceed prop limits by an order of magnitude, and this is the cheapest possible way
to find that out.

## System quality

| Metric | Formula | Interpretation |
|---|---|---|
| SQN | `√N × mean(R) / stdev(R)` | <1.6 poor · 2.0–2.5 good · >3 excellent. Meaningless below N=30 — grey it out |
| Sharpe (daily) | `mean(r_d)/stdev(r_d) × √252` | Show with a caveat; discretionary samples are tiny and non-normal |
| Sortino | as Sharpe, downside deviation only | Better fit for skewed retail returns |
| Kelly % | `WR − (1−WR)/(avgWin/avgLoss)` | Display with an explicit "trade 1/4 of this at most" warning |
| Consistency | `max_day_profit / total_profit` | Prop-firm rule; also a luck detector |
| Expectancy CI | bootstrap 95% CI on mean R | **The most honest stat in the app.** "+0.14R, CI [−0.09, +0.38]" tells the truth that "+0.14R" hides |

## Excursion

| Metric | Definition | The insight it unlocks |
|---|---|---|
| MAE | max adverse excursion, in price and R, from M1 bars in `[opened_at, closed_at]` | Are stops too wide? p80 of MAE on *winners* is the tightest stop that wouldn't have hurt |
| MFE | max favourable excursion | Are exits early? `mean(MFE_R) − mean(R)` on winners = R left on the table |
| Edge ratio | `mean(MFE_R) / mean(MAE_R)` | >1 means the entries have directional edge independent of exits |
| Efficiency | `captured / MFE` per trade | Exit quality, isolated from entry quality |

Requires `price_bars`. Bars come from the broker feed via the EA (`CopyRates`),
because a CFD's price on one broker is not its price on another and third-party
data will produce MAE/MFE that the user can disprove from their own chart.

## Behavioural

| Metric | Definition |
|---|---|
| Discipline grade | Weighted rule adherence for the day → A–F. **Independent of P&L** |
| Rule break cost | `Σ net_pnl` of trades violating rule X; plus counterfactual "P&L excluding these" |
| Revenge-trade rate | % of trades opened <X min after a loss ≥Y R; and their expectancy |
| Plan adherence | matched plans / total trades; plus size and stop deviation vs plan |
| Overtrading index | daily trade count vs personal 90-day p50; expectancy by count decile |
| Tilt detector | expectancy of trade N of the day, by N. Usually collapses after 3–4 |
| Cost ratio | `(commission + |swap| + est. spread) / gross_profit` |

## Segmentations (every metric sliceable by)

symbol · asset class · playbook · direction · session · hour of day · day of week ·
duration bucket · R-risk bucket · tag · account · win-streak position ·
trade-number-of-day · month

The segmentation engine matters more than any individual metric: the product's
job is to find the slice where the user is bleeding, and surface it unprompted.

## Auto-generated insights

Rules that scan segmentations nightly and emit ranked, actionable statements.
Each requires a minimum sample and reports an effect size:

```
IF  expectancy(segment) < 0 AND n >= 20 AND |Σ net_pnl| > 0.05 × |total|
THEN "Your {segment} trades have cost £{x} over {n} trades (expectancy {r}R).
      Cutting them would move you from {before} to {after}."

IF  mean(MFE_R on winners) − mean(R on winners) > 0.8 AND n >= 20
THEN "You exit winners at {a}R but they reach {b}R on average."

IF  expectancy(trade_n_of_day >= 4) < expectancy(trade_n_of_day <= 3) − 0.3
THEN "After your third trade of the day, your expectancy falls from {a}R to {b}R."

IF  count(no_stop) >= 5
THEN "No-stop trades: {n}, net £{x}. This is your largest single leak."
```

**Honesty constraints** — non-negotiable, because a tool that flatters a trader
into overconfidence causes real financial harm:
- never present a finding below the minimum sample size
- always show the confidence interval alongside a point estimate
- never claim causation from a segmentation ("your Tuesday trades lose" is an
  observation, not a law)
- an LLM may rank, phrase and prioritise these; it may never compute them
