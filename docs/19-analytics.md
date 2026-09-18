# Analytics Catalog

Every chart the app ships, the question it answers, and why it earns its place.
A chart that doesn't change a decision doesn't ship.

Grouped the way the UI groups them, because the grouping *is* the mental model:
**Overview** (am I profitable and why) · **Setups & confluence** (which of my
ideas work) · **Timing** (when I'm good) · **Execution** (what I do to myself).

---

## Overview

| Chart | Question | Why it earns its place |
|---|---|---|
| **R distribution histogram** | What is the *shape* of my edge? | The single most informative chart in a journal. A left-heavy hump of sub-0.5R wins with a fat left tail is the signature of cutting winners and letting losers run — visible instantly, invisible in any summary statistic |
| **Cumulative R + drawdown** | Am I compounding or churning? | R, not currency, because a working-capital account's dollar curve is dominated by transfers (`16`). The drawdown underlay is the risk half |
| **Win rate vs break-even win rate** | Is my win rate actually good? | A bare win rate is meaningless without the payoff ratio. `break-even = 1/(1+payoff)`. The **gap** is the edge, and it's the number to show |
| **Planned R:R vs realised R** (scatter) | Do I get what I plan? | Every dot a trade, diagonal = perfect execution. Dots below the line are trades that reached toward target and got closed early. Turns "I exit too soon" from a feeling into a measured distance |
| **Daily net** | Which days carried the period? | Also exposes the prop-firm consistency problem — one day carrying everything |

## Setups & confluence

| Chart | Question | Why |
|---|---|---|
| **Expectancy by setup** | Which strategies pay? | Sample size on every bar; a setup below zero with n≥30 is a decision, not a hunch |
| **Confluence marginal value** ⭐ | Which of my confluences carry the edge? | `E[R \| factor present] − E[R \| absent]`, per factor, sorted. The question a confluence methodology raises and can never answer by feel. Requires thousands of annotated trades — which high frequency provides |
| **Expectancy by confluence count** | Does stacking more help? | If flat, the trader is gathering *confirmation* rather than edge, and the extra wait costs entries. A genuinely uncomfortable chart |
| **Win-rate margin by setup** | Which setups win often enough to pay? | Points above the break-even rate *that setup* needs at *its own* payoff. Catches the setup that feels good and doesn't pay |

**Honesty rules on this tab** — non-negotiable, because these findings change behaviour:
- minimum n before a factor is shown at all
- a 95% CI on every marginal estimate; factors whose |effect| < CI are **named as
  statistically indistinguishable from noise**, not quietly ranked low
- stated plainly as correlational, and that co-occurring factors cannot be separated

## Timing

| Chart | Question |
|---|---|
| **Session × weekday heatmap** | Where exactly is the money made? A session fine on average can be losing on specific days |
| **By session** | Asia / London / NY AM / NY PM |
| **By volatility regime** | Daily ATR bucket. If expectancy falls as ATR rises, stops aren't scaling with conditions (`13`) |
| **News proximity** | Minutes from the nearest high-impact USD event. Gold is the most news-sensitive liquid instrument there is |
| **By hold time** | Bucketed. Winners shorter than losers is the classic tell |

## Execution

| Chart | Question | Why |
|---|---|---|
| **Fill depth** | Did the whole ladder fill? | Novel to zone-layering. A full fill means price disrespected the zone — a warning, not a discount (`15`) |
| **Mistakes, priced** | What does each bad habit cost? | Expectancy per tag plus the counterfactual. Most tags auto-detected, because nobody honestly tags their own revenge trades |
| **Trade number within the day** | Where is my tilt threshold? | The bucket where this turns negative is the real daily limit, and the number an in-session alert fires on (`11`) |
| **Exit efficiency (MFE vs captured)** | How much of the move do I keep? | The gap is R reached and given back. Pairs with the breakeven-cost figure |
| **Long vs short** | Do I have an unconscious directional bias? | A persistent gap is usually bias, not edge |

---

## Chart construction rules

From `18-design-system.md`, applied to every chart above:

- **One scale.** Never a dual y-axis.
- **Sample size is rendered on the chart**, not in a tooltip — in its own column,
  separated by a hairline so it can never collide with the value label.
- Diverging bars around a zero baseline; the baseline is the strongest line in the
  drawing. Value labels take the mark's colour; category labels stay in text ink.
- Hover titles on every mark; the value is also printed, so hover is enhancement.
- Semantic (profit/loss) encoding and the categorical palette are **never on the
  same chart**.
- Every chart carries a plain-English `note` underneath stating what the data says.
  A chart nobody can interpret is decoration — the sentence is the deliverable and
  the chart is the evidence.

## Deliberately not built

| | Why |
|---|---|
| Dual-axis "P&L vs volume" | The #1 chart mistake; two scales invite false correlation |
| Pie charts of anything | Angle comparison is worse than length at every sample size |
| Win/loss streak gambler charts | Encourages streak thinking, which is noise-reading |
| Equity curve in currency as the headline | Transfer-dominated on a working-capital account (`16`) |
| Sharpe as a headline figure | Small, non-normal discretionary samples; shown with a caveat, never led with |
