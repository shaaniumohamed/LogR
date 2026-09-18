# Feature Catalog — prioritised, with reasoning

Scored on **Impact** (does it change trading behaviour?) × **Persuasion** (does it
make me open the app tomorrow?) ÷ **Effort**. Tiers are build order.

---

## TIER 0 — The hook (without these, nothing else matters)

### 0.1 Zero-friction import
Drag a statement onto the landing page → full dashboard in <60s, **before signup**.
Signup only to save. This is the entire top-of-funnel.

### 0.2 Auto-sync from MT5
See `03-mt5-integration.md`. The product is worthless if logging is manual.

### 0.3 Calendar heatmap
Month grid, one cell per day, coloured by P&L (or by **R**, or by discipline
grade — toggle). Weekly totals down the right edge. Click a day → that day's
trades + the day's note.
*Why it works:* it is the single most-screenshotted artefact in trading journals.
It gives a whole month's state in one glance and creates an obvious visual gap
when you stop logging.

### 0.4 Equity curve + drawdown
Closed-trade equity **and** live equity (EA only). Underwater/drawdown chart
beneath it. Toggle: currency / R / % of starting balance.

### 0.5 The core eight stats
Net P&L · Win rate · Profit factor · Expectancy (R) · Avg win / avg loss ratio ·
Max drawdown · Total trades · Avg hold time. Definitions in `06-metrics-spec.md`
— the exact definitions matter more than the list.

---

## TIER 1 — The payoff (why you come back)

### 1.1 R-multiple normalisation  ⭐ foundational
Every trade expressed as a multiple of its initial risk. Requires initial SL
(from the EA) or a fallback: user-entered risk, or account-level default risk %.
*Why it matters:* dollars are noise when position size varies. R makes a
£20 scalp and a £400 swing comparable, and it is the only way expectancy,
risk-of-ruin and Monte Carlo mean anything. **Flag trades where R is estimated
rather than measured** — honesty about data quality builds trust.

### 1.2 Playbooks (setups as first-class objects)  ⭐ the retention feature
Define a setup once: name, description, entry criteria checklist, invalidation,
target logic, expected R, allowed sessions/symbols, example charts.
Tag trades to it (auto-suggested from symbol/session/time/magic number).
Then: **per-playbook expectancy, win rate, sample size, equity curve.**

*Why it works:* it converts journaling from bookkeeping into strategy validation.
The question stops being "how did I do?" and becomes "is Setup A actually an edge,
or am I carrying it with Setup B?" That question is addictive, and it can only be
answered with accumulated logged data — which is exactly the retention loop we want.

Kill-criteria alerts: "Playbook 'London reversal': 34 trades, expectancy −0.18R,
95% CI [−0.41, +0.05]. This has never been profitable. Stop trading it or change it."

### 1.3 Mistake taxonomy + cost attribution  ⭐ the persuasion feature
A fixed starter taxonomy (extendable): *no stop · moved stop against me ·
oversized · revenge trade · FOMO/chased entry · exited early · no setup /
boredom trade · traded during news · overtraded · averaged into a loser ·
ignored higher-timeframe bias · broke daily loss limit*.

One-tap tagging (keyboard shortcuts, bulk tag). Then the report that sells the
whole app:

> **Your most expensive habits, last 90 days**
> 1. Moved stop against me — 14 trades — **−£3,180** (−8.2R)
> 2. No stop loss — 6 trades — **−£1,940** (−4.9R)
> 3. Revenge trade (<5 min after a loss) — 21 trades — **−£1,110** (−2.8R)
> *Without these 41 trades you would be **+£2,290** instead of −£3,940.*

Several of these can be **auto-detected** with no user input at all:
- *no stop*: SL absent at fill
- *moved stop against me*: compare SL at fill vs SL at close, direction-aware
- *revenge trade*: opened within X minutes of a loss ≥ Y R
- *oversized*: risk > user's configured max %
- *overtraded*: trade count > personal daily p90
- *traded during news*: entry within ±15 min of a high-impact event
Auto-detection is what makes this work — nobody honestly tags their own revenge trades.

### 1.4 MAE / MFE analysis  ⭐ most underrated
Using M1 bars around each trade (EA-supplied, from the broker's own feed):
- **MAE** — how far against you did it go before working? → "your stop is 2.4x
  wider than it needs to be; tightening to 1.3x MAE-p80 would raise expectancy
  from 0.21R to 0.38R without changing your win rate"
- **MFE** — how far in your favour before you exited? → "your average winner
  reached 2.7R and you closed at 1.1R. You are leaving 1.6R on the table."

This is the highest insight-per-pixel feature in the whole product, and CFD
traders are exactly the population that exits early.

### 1.5 Time / session analytics
Hour-of-day × day-of-week heatmap (P&L, expectancy, trade count). Session buckets
(Asia / London / NY-AM / NY-PM / overlap), with **broker-time → UTC → user-time**
handled properly and DST-aware. Holding-period buckets.
*Why:* indices are session-driven. "Every pound you've made this year came from
London open; you gave 40% of it back trading Asia" is directly actionable —
the fix is "stop trading Asia", which requires no new skill.

### 1.6 Instrument & cost breakdown
Per-symbol table: trades, expectancy, net, gross, commission, **swap**, estimated
spread cost (entry price vs mid at fill, EA-captured).
*Why CFD-specific:* financing and spread silently eat leveraged accounts.
"Swap has cost you £612 this year — 23% of your gross profit. Your average hold
is 4.2 days; on your top 3 symbols the carry is negative."

### 1.7 Style-specific analytics (layering, partials, runners)  ⭐
Because the target trader layers entries, scales out, and moves to breakeven, these
are core rather than edge cases. Full treatment in `09-risk-model.md`:
- **Runner analysis** — expectancy of the partial vs the runner, separately.
  Answers "is letting it run actually paying, or should I take full TP?"
- **Breakeven-stop cost** — how often moving to BE knocked you out of a trade that
  then reached target, in R.
- **Layering analysis** — did scaling in improve the average price by more than the
  extra size cost on the ones that lost?
- **Invalidation discipline** — did you exit where you said the idea died?
- **Scalp cost economics** — what share of gross edge spread and commission eat,
  and the minimum target size below which a scalp is not worth taking.

### 1.8 Daily / weekly review ritual
- **Pre-market** (2 min): bias, key levels, what I'm allowed to trade today,
  max trades, max loss.
- **Post-market** (3 min): auto-filled stats + 3 prompts (*what did I do well /
  what did I do badly / what is tomorrow's one rule?*), plus a self-grade.
- **Weekly**: auto-generated summary; user writes one paragraph.

Voice notes with transcription — talking for 40 seconds beats typing for 5 minutes
and is the only journaling format people sustain on a phone after a session.

---

## TIER 2 — Discipline engine (the differentiator)

### 2.1 Rules-as-data + discipline score
User defines rules; the system evaluates each automatically against trade data:
- max risk per trade (%/£/R)
- max trades per day · max losses per day · daily loss limit
- stop required on every trade
- only trade symbols in {list} · only during sessions {list}
- no trade within X min of a loss (cool-down)
- min R:R on entry · must be tagged to a playbook
- no trading on high-impact news

Each day gets a **discipline grade (A–F) computed from adherence, not P&L**.
The dashboard headline is the grade, with P&L secondary. The single most important
UI decision in the app: *what you put at the top is what the user optimises for.*

### 2.2 Prop-firm challenge tracker  ⭐ high urgency, under-served
Pick a firm/profile (or custom): profit target, max daily loss, max total
drawdown (static or trailing), min trading days, consistency rule (no day >X% of
total profit), news/weekend restrictions.

Live gauges: *"Daily loss used: £380 / £500 (76%). Max DD headroom: £1,240.
Consistency: your best day is 41% of total profit — limit is 35%. You need 2 more
trading days."*

Plus **projection**: at your current expectancy and trade frequency, probability
of passing before breaching, from Monte Carlo on your own R-distribution.
Prop traders check this multiple times a day, every day of a challenge. That is
the strongest retention loop available in this market, and no journal does it well.

### 2.3 Pre-trade plan → auto-match
Log intent *before* entry (setup, thesis, invalidation, target, planned size).
The sync auto-matches the plan to the actual fill and scores execution:
did you take the size you planned? the stop you planned? did you enter where you
said? "Planned 12 trades this month, took 31. The 19 unplanned ones: −£2,100."
*Why:* this is a commitment device. Writing intent down before acting is the
single best-evidenced behavioural intervention here, and it produces the cleanest
signal in the dataset.

### 2.4 Live guardrails & alerts
Browser push / email / Telegram: daily loss limit approaching, risk on a new trade
exceeds the rule, no stop detected on an open position, N-th trade of the day,
cool-down violation. Optionally enforced by the EA (see `03` §5).
Strictly protective alerts only — never "market moving, come trade".

### 2.5 Streaks & nudges (process only)
Review-completed streak · zero-rule-break streak · "every trade tagged" streak.
Never a win streak. Never a "days traded" streak.

---

## TIER 3 — Depth

### 3.1 Auto chart screenshots (EA) + trade replay
Entry shot, exit shot, and a "+20 bars later" shot showing what you missed.
Plus an interactive replay: lightweight-charts with entry/exit/SL/TP markers and
a scrubber, so a year-old trade is reviewable without the original screenshot.

### 3.2 Notebook / wiki
Free-form notes, lesson library, linked to trades and playbooks. Templates.
Searchable. (Where "what did I learn" accumulates instead of evaporating.)

### 3.3 Reports & export
Weekly/monthly PDF, CSV/Excel export, accountant-friendly realised P&L by tax
year, shareable read-only link for a mentor/coach.

### 3.4 Monte Carlo & risk of ruin
Bootstrap the user's own R-sequence: distribution of 100-trade outcomes, expected
max drawdown, risk of ruin at current risk %, and the sizing that keeps 95%-ile
drawdown under their tolerance. Answers "am I risking too much?" with their data.

### 3.5 Correlation & concurrent exposure
Long US30 + long NAS100 + short USDJPY is one trade, not three. Flag correlated
concurrent risk and show true aggregate exposure at any moment.
CFD-specific and genuinely missing from every retail journal.

### 3.6 Economic calendar overlay
High-impact events on the equity curve and calendar; "trades within ±15 min of
red news" as an auto-detected mistake tag and a performance segment.

### 3.7 Position-size calculator (CFD-aware)
Account balance × risk % ÷ (stop distance × tick value) → lots, using the real
per-symbol specs the EA captured. Pre-fills a plan. Small feature, used daily.

### 3.8 AI insights & coaching
- Weekly narrative: "Three things the data says about your week."
- Semantic search over notes: "show me trades where I mentioned feeling rushed"
  → and their aggregate expectancy. (Emotional state vs performance, from free text.)
- Chat with your trade data (text→SQL over a constrained schema).
**Discipline:** the numbers must be computed deterministically in SQL and handed
to the model. The model narrates and prioritises; it never calculates. Anything
else produces confidently wrong stats, which is fatal for a trading tool.

### 3.9 Backtest / manual-replay journal
Log bar-replay practice trades separately from live, with the same analytics.
Separate `is_backtest` flag so they never pollute live stats.

### 3.10 Multi-account aggregation
Live + demo + 3 prop accounts, one portfolio view, per-account filtering, and
per-account currency normalisation.

---

## Explicitly deferred / rejected

| Idea | Why not |
|---|---|
| Social feed, leaderboards, copy-trading | Encourages variance-seeking and comparison; actively harms users |
| Broker-side order execution | Huge regulatory surface; not a journal |
| Mobile native app (v1) | PWA covers it; native only once retention is proven |
| Real-time tick charts in-app | Expensive data, no journaling value |
| Signals / alerts to enter trades | Different product, and a worse one |
