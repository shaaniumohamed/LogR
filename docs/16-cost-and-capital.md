# Cost Measurement & the Working-Capital Model

Two findings from real broker data, both of which change what the app must compute.

---

## 0. Correction: the spread is inside the fill, and net profit is already after it

An earlier draft of this document framed spread as a cost sitting *on top of*
reported net profit. That was wrong, and the distinction matters.

The spread is embedded in the fill price. A buy fills at the ask and is marked at
the bid, so the position opens showing a floating loss equal to the spread. There
is no separate charge and nothing is deducted afterwards — **every closed trade's
reported P&L is already net of spread.**

So the correct statement is not "spread took X% of your profit". It is:

> **Gross edge = reported net + spread paid.** The trader keeps the net; the spread
> is the hurdle each trade had to clear to get there.

Same arithmetic, very different claim. The app must use the second framing, because
the first implies money went missing that the trader could recover by noticing it —
and it can't. What *is* recoverable is the size of the hurdle, which is set by
account type, and that is where the actionable value sits.

Presentation rule: show **net, spread, and gross-before-spread as three bars**, and
label the spread bar as a hurdle rather than a deduction. Never print a bare
"spread cost as % of net profit" figure without that context.

## 1. The broker reports trading cost as zero. It isn't.

On a commission-free account (Exness Pro and Standard), the broker's own
performance screen has a **"Trading cost"** line, and it reads **`0.00 USD`**.
Statements agree: commissions `0.00`, swaps `0.00`.

This is technically accurate and practically false. There is no *commission* — the
entire execution cost is the spread, and no broker reports the spread you crossed
as a cost anywhere. For a low-frequency trader that's a rounding error. For a
scalper doing thousands of round trips against small targets, **it is the largest
line item in the business and it is reported as zero.**

Surfacing this number is the single highest-value calculation in the product.

---

## 2. Cost can be estimated from volume alone — no tick data required

`14-high-frequency.md` proposed continuous quote capture to reconstruct
spread-at-fill. That's the precise method, and it's still worth building. But a
good first-order estimate needs only the **notional volume** the broker already
reports:

```
oz_traded        = notional_volume / average_price
round_trip_oz    = oz_traded            (if volume counts position opens only)
                 = oz_traded / 2        (if volume counts every order/leg)
spread_cost      = round_trip_oz × average_spread_per_oz
```

**The one-vs-both-legs ambiguity must be resolved per broker**, by reconciling
against a period where the deal-level data is known. Until it is, present a
**range, not a point estimate** — an honest band beats a precise-looking wrong
number, and the band is usually narrow enough to be decisive anyway.

Worked shape (fully synthetic example — a high-frequency gold account turning over
~40 lots/month against ~$1,000 of monthly net profit):

Expressed as a share of **gross edge** (net + spread), which is the honest
denominator — not as a share of net profit:

| | spread $0.15 | $0.20 | $0.30 |
|---|---|---|---|
| Volume counts both legs | ~23% of gross edge | ~29% | ~37% |
| Volume counts opens only | ~37% | ~44% | ~50% |

The point of presenting it as a grid: **the conclusion survives every cell.** Even
on the most favourable assumption the cost is a large fraction of net profit, so
the finding does not depend on resolving the ambiguity — which means it can be
shipped before the ambiguity is resolved.

**Design consequence:** ship the volume-based estimate in **M1**, from import data
alone. Quote capture upgrades it from a band to an exact figure later. Do not make
the most valuable insight in the product wait for the hardest piece of infrastructure.

---

## 3. Cost as a share of the target move — the scalper's critical ratio

Absolute cost understates the problem. The ratio that matters:

```
cost_ratio = spread_per_oz / average_winning_move_in_price
```

A scalper targeting **$1–2 of gold movement** while paying **$0.15–0.30 of spread**
is giving up **11–25% of every winning move before the trade starts**, and paying
it again on every loser. Express it that way — as a fraction of the move you're
actually reaching for — and it becomes impossible to ignore.

From this, two computable outputs:

- **Minimum viable target.** Given the measured win rate, payoff ratio and cost,
  the target size below which expectancy turns negative. A single number in
  dollars of price movement, directly usable.
- **Break-even win rate at current target size**, versus the actual win rate. The
  margin between them is the real edge, after costs.

---

## 4. Account-type optimiser

Broker account types trade spread against commission, and the crossover depends
entirely on volume — which means it's arithmetic once volume is known, not opinion.

```
Pro-style   (no commission, wider spread) : lots × spread_per_oz × 100
Raw-style   (tight spread + commission)   : lots × (spread_per_oz × 100 + 2 × commission_per_lot)
```

At meaningful monthly volume the gap between the two runs to hundreds of dollars a
month on even a small account — frequently a double-digit percentage increase in
net profit **for zero change in trading behaviour**. Few retail traders ever
compute it, because doing so requires knowing your own volume and average paid
spread, which no broker screen puts in front of you.

Build this as a first-class screen: current account type, measured volume, measured
or estimated spread, and a side-by-side comparison of every account type the broker
offers. Caveat honestly — advertised spreads differ from paid spreads, and tighter
nominal spreads can come with worse fills — so present it as "worth investigating
with this much at stake", not as a guarantee.

---

## 5. Working-capital mode — when the equity curve is meaningless

### The pattern
Some traders — small-account scalpers especially — run a **fixed working capital**
and sweep profits out continuously. A representative pattern:

> Deposit a fixed float. Trade it. **Withdraw profits daily. Reset to the same
> float at the start of the next day.** Occasionally top up mid-period to increase
> size.

Every conventional performance metric breaks on this:

| Metric | Why it breaks |
|---|---|
| % gain | Withdrawals shrink the denominator; the figure can be inflated arbitrarily |
| Equity curve | A sawtooth of trading and transfers. Shows almost nothing about the trading |
| Max drawdown % | Measured against a balance that is reset daily by design. Not a risk measure |
| Cumulative return | Meaningless when capital is swept out and replaced |
| Recovery factor | Inherits the broken drawdown |

A broker-reported "600% gain" on this pattern is an artifact of the withdrawal
schedule, not a performance claim. **The app must not repeat it.**

### What replaces it

Add an explicit account mode, `working_capital`, with a declared daily float:

- **Cumulative withdrawn profit** is the real equity curve — the money actually
  extracted. This is the headline series.
- **Daily return on working capital** — `day_net / declared_float` — is the
  comparable per-day unit, and it's directly aggregable into a meaningful
  distribution.
- **Intraday drawdown against the float** is the real risk measure: the worst
  within-day equity excursion as a % of that day's starting capital. This is the
  number that would blow the account, and the only drawdown figure worth showing.
- **Transfers are classified, not summed into performance.** Deposits and
  withdrawals are ledger events; a top-up to increase size is a capital decision
  and must be visible as one, never as P&L.
- **Time-weighted return** (`06-metrics-spec.md`) for any cross-period comparison.

### Why it's worth building rather than working around
This pattern is a deliberate, hard risk limit — the maximum loss is the float,
because the profits are already out of the account. It deserves to be modelled as
the intentional strategy it is, with the metrics that make it legible, instead of
being mangled by equity-curve maths that assumes a compounding account.

It also **changes the prop-firm readiness question entirely**. A drawdown
percentage computed on a withdrawal-distorted balance says nothing about whether a
trader would survive a challenge. The honest comparison requires the deal-level
series: reconstruct the intraday equity path on a constant-capital basis, *then*
test it against the firm's daily-loss and total-drawdown rules. Until that
reconstruction exists, the app should decline to answer rather than quote a number
it knows is distorted.

---

## 6. Requirements summary

- `trading_accounts.capital_mode`: `compounding` | `working_capital`
- `trading_accounts.declared_float` for working-capital accounts
- Transfers stored as classified ledger events, never folded into P&L
- Cost estimation from volume in M1; exact from quote capture later
- Present cost as a **range** until the volume convention is reconciled
- Cost-as-share-of-target-move as a headline metric for high-frequency accounts
- Account-type comparison screen driven by measured volume
- Refuse to report drawdown-based prop readiness from distorted balance data
