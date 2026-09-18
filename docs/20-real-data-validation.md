# Validating the Design Against Real Data

A real Exness CSV export (XAUUSD, ~2,800 closed positions, seven months) was
analysed **outside version control**. No figures from it appear in this repository
— only the design conclusions it produced. What follows is what the exercise
proved, disproved, and changed.

---

## 1. The export format (parser spec)

Exness Personal Area → Trading → History of orders → Download CSV gives:

```
ticket, opening_time_utc, closing_time_utc, type, lots, original_position_size,
symbol, opening_price, closing_price, stop_loss, take_profit, commission,
swap, profit, equity, margin_level, close_reason
```

Better than expected — it is **position-level, not deal-level**, which removes the
entire `DEAL_ENTRY_INOUT` / `OUT_BY` aggregation problem described in `03` §3 for
this broker. Each row is already one round trip with an open and a close.

### Edge cases found in real data — all must be handled

| Finding | Consequence for the parser |
|---|---|
| **`profit` is blank, not `0.00`, on scratch trades** | ~1% of rows. `float('')` throws. Blank means zero, and treating it as missing silently drops trades |
| `commission` and `swap` blank throughout | Commission-free account. Blank ≠ zero here either, but the effect is the same; do not infer "no data" |
| `stop_loss` / `take_profit` empty on ~90% of rows | Confirms the mental-stop workflow. **R is not computable from the export** — which is the entire justification for the invalidation model in `09` and `15` |
| `close_reason` ∈ {`user`, `tp`, `sl`, `so`} | Not documented anywhere, and highly informative. `so` = margin stop-out. Capture it as a first-class field |
| Timestamps are UTC and labelled as such | Good. Still store the broker offset for other exports |
| A handful of rows on other symbols | A "gold-only" account is not literally gold-only. Never hardcode one instrument |
| `equity` / `margin_level` columns present but empty | Do not build an equity curve on the assumption they are populated |

**`close_reason` is the most valuable column and it was not in the plan.** It
separates trades the trader closed by hand from those a target, a stop, or a
margin call closed — and those populations behave completely differently. Add it
to the schema in `05` and segment by it everywhere.

## 2. Zone clustering — validated on real data

The clustering rule from `15` (same direction, entries within a price band,
overlapping in time, closed when flat) was run against the real export:

- ~2,800 positions collapsed to ~600 zone trades
- **~4.6 legs per zone trade**
- **~74% of zone trades are layered** (more than one entry)
- median zone band was well under $1 of gold price; median hold a few minutes

This matches the trader's own description of their process without being tuned to
it, which is the result that matters: **the cluster is a real object in the data,
not an artefact of the algorithm.** Cluster sizes run into the thirties, so the UI
must handle a zone trade with 30+ legs without becoming unreadable.

Tuning notes: the band tolerance needs to be **relative to price** (a percentage),
not absolute, or it breaks when gold moves several hundred dollars across the
sample. A 20-minute gap ceiling plus an overlap requirement was sufficient.

## 3. What the analysis changed in the design

### 3.1 Break-even win rate is not a nice-to-have — it is the headline
Over the full sample the account's payoff ratio put its break-even win rate within
**half a percentage point** of its actual win rate. A trader looking at "57% win
rate" would reasonably conclude they were doing well. They were, in that period,
approximately flat.

No other single statistic exposes that. Win rate alone flatters; profit factor
near 1.0 is easy to dismiss; only `break-even = 1/(1+payoff)` against actual win
rate shows how thin the margin is. **Promote it to the primary KPI**, with the gap
in percentage points stated explicitly.

### 3.2 Segment by `close_reason` — it may be the strongest signal available
Trades closed by a **take-profit** behaved completely differently from trades
closed **by hand**: far higher win rate, and an average win several times larger.
Manual closes clustered near zero.

Two serious confounds, both of which the app must state rather than hide:
- **Survivorship** — a take-profit only fills if price reached it, so the
  population is selected on success by construction.
- **Selection** — trades where a target was set may be different trades.

So this is a *hypothesis generator*, not a finding: "trades left to a preset target
outperform trades you close by hand" is exactly the sort of thing the journal
should surface and the trader should then test deliberately. Ship it with the
caveats attached, never as a recommendation.

### 3.3 Hour-of-day beat every other segmentation for actionability
A two-hour window accounted for a large negative contribution in an otherwise
strongly profitable month, and was negative on most days it was traded. The
counterfactual — this period without those two hours — was a materially better
month.

This vindicates promoting hour-of-day and the session × weekday heatmap into the
first analytics screen. It is the cheapest possible intervention: no new skill
required, just not trading a window.

**Guard:** always show per-day consistency behind such a claim, not only the
aggregate. One catastrophic day inside a window can masquerade as a pattern.

### 3.4 Counterfactuals must be run in both directions
Testing "what if I removed X" on several dimensions produced one that **would have
made things worse** — a bucket that intuition says is bad (long holds for a
scalper) was in fact carrying profit.

That is the whole argument for the feature: intuition about your own trading is
unreliable in both directions. The app should therefore present a
**counterfactual panel** that lists candidate exclusions with their effect,
including the ones that would hurt, rather than only surfacing leaks.

### 3.5 Recent form and lifetime form can differ enormously
The most recent month's expectancy, win rate and break-even margin were far
stronger than the full-sample figures, which were dragged down by earlier months.
Reporting only the lifetime number would have badly misrepresented the trader's
current process.

**Requirement:** every headline figure carries a period selector, defaulting to a
recent window, with lifetime available but never the default. Add a **"recent vs
lifetime" comparison** so improvement is visible rather than averaged away.

### 3.6 The spread framing, corrected again with real magnitudes
Expressed properly (`16` §0) as a share of **gross edge**, the spread's bite varied
enormously between the weak early period and the strong recent one — from taking
most of the edge to taking roughly a fifth of it.

Two consequences: cost must always be shown **for the selected period**, never as a
lifetime figure; and the account-type comparison should be presented against
**recent volume**, since that is what the next month will look like.

## 4. What did not survive contact with the data

| Hypothesis | Outcome |
|---|---|
| Tilt shows up as degrading expectancy late in the session | **Not present.** Late trades performed as well as early ones. The trade-number tilt curve stays in the app, but as a chart to check rather than a finding to assume |
| Long holds hurt a scalper | **Reversed.** Longer holds were carrying profit |
| Layering hurts the average entry | **Reversed.** Layered zone trades outperformed single-entry ones |

Three of my prior hypotheses were wrong, and the data said so within minutes. That
is the strongest possible argument for the product: **a trader's beliefs about
their own trading are unreliable in both directions, and only the log settles it.**

## 5. Process rule this establishes

Every analytic shipped must be validated the same way:
1. run it against a real export,
2. check the finding survives a per-day or per-week consistency check,
3. state its confounds in the UI next to the number,
4. and be willing to report that a hypothesis was wrong.

An analytic that has never been run against real data is a guess with a chart on it.
