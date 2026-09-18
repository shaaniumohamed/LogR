# LogR — Product Strategy

> Working name: **LogR** — because the unit that matters is **R**, not dollars.

## 1. The real problem

Trade journals have a ~90% abandonment problem. Not because traders don't believe
in journaling — every trader "knows" they should. They abandon because of a
predictable failure loop:

```
manual entry is tedious  ->  entries get skipped  ->  data becomes incomplete
        ^                                                      |
        |                                                      v
  no reason to come back  <-  stats are meaningless  <-  garbage in
```

Two independent things must be solved, and most journals only solve one:

| Failure | Fix | Who solves it |
|---|---|---|
| **Friction**: typing 14 fields per trade | Auto-import from the broker | TradeZella, Tradervue |
| **Payoff**: "so what?" after logging | Insights that change tomorrow's behaviour | Almost nobody, well |

TradeZella's own moat is friction removal (broker sync) + the calendar dopamine
hit. Its weakness for *our* user is that it is built US-equities/options-first:
CFD symbol handling, swap/financing, lot-based sizing, prop-firm rules and
MT5 account models are second-class citizens.

**LogR's thesis: be the journal that a leveraged CFD/prop trader would build for
themselves.** Auto-capture everything from MT5 including the things statements
throw away, normalise to R, and convert the data into *behavioural* feedback, not
just a P&L report.

## 2. Who it is for (in priority order)

1. **Retail CFD trader on MT5** — indices (US30/NAS100/GER40), gold, FX majors,
   oil. Trades intraday to swing. 1–5 accounts. Cares about: am I actually
   profitable, where am I leaking, am I following my plan.
2. **Prop-firm challenge trader** (FTMO/FundedNext/ FundingPips style) — has hard
   external rules: daily loss limit, max drawdown, consistency rule, min trading
   days. Needs a live compliance dashboard more than they need a journal. This is
   an under-served, highly motivated, high-urgency segment.
3. **Multi-account / multi-platform trader** — MT5 + cTrader + DXtrade/Match-Trader
   (prop firms are drifting off MT5). Needs one aggregated view.

Deliberately **not** the first target: US equities/options day traders (crowded,
TradeZella/Tradervue own it), and algo traders (they build their own analytics).

## 3. Positioning

> "TradeZella for leveraged traders, with a sync that captures what your broker
> statement throws away."

Three defensible differentiators, in order of strength:

### D1 — Capture the *initial* stop loss (and therefore real R)
A downloaded MT5 statement tells you entry, exit, volume, profit. It does **not**
tell you where your stop was when you opened the trade. If you moved your stop,
the history is gone forever. Without initial risk, every R-multiple, expectancy,
risk-of-ruin and MAE/MFE number is fabricated.

An EA sitting on the terminal snapshots SL/TP **at the moment of fill**, plus the
spread at execution, plus the account equity at that instant. Nobody who syncs
from statements or from a read-only cloud API can reconstruct this. This single
capability is the foundation for most of the analytics below, and it is a genuine
technical moat because it requires code on the trader's terminal.

### D2 — Automatic chart screenshots at entry and exit
MQL5 has `ChartScreenShot()`. The EA can capture the chart at fill time, at close
time, and again N bars later ("what happened after you left"), and upload them.
Manual screenshotting is the #2 reason people stop journaling. Making it free is
disproportionately persuasive.

### D3 — Rules engine + prop-firm compliance, evaluated from data
Traders don't need to be told their win rate. They need to be told
*"you broke your own max-risk rule 11 times this month and those 11 trades cost
you £3,180 — your other 94 trades were profitable."* That is a sentence that
changes behaviour. It requires: rules-as-data, per-trade evaluation, and
attributing P&L to rule violations.

## 4. The persuasion model (and its ethics)

The brief was "features that would genuinely persuade me to log my trades." The
honest answer is that persuasion comes from **time-to-insight**, not from badges.

Design principles:

| Principle | Concretely |
|---|---|
| **Value before work** | Drop a statement on the landing page, get a full dashboard in <60s, *before* signing up. Account creation only to save it. |
| **Logging is a by-product** | Trades appear by themselves. The user's only job is to add *intent* (setup, mistake tags, one sentence). Target: <45s per trading day. |
| **One insight per visit** | Every dashboard load surfaces one specific, data-backed, actionable sentence. Rotate. Never show a blank "no data" state. |
| **Grade the process, not the P&L** | The daily score is plan-adherence, not profit. A losing day that followed the plan is an A. A winning day that broke risk limits is a D. |
| **Loss aversion, pointed at discipline** | Streaks are for *review completed* and *zero rule breaks*, never for win streaks or profit. |
| **Cost framing** | Always express mistakes in money: "no-stop trades: −$4,312 lifetime". Losses are ~2x as motivating as equivalent gains. |

**Anti-goals** — things that would boost engagement and hurt the user, so we don't
build them:
- No social feed of winners, no leaderboards by P&L, no "trade of the day".
- No celebration animations on big wins (rewards variance-seeking).
- No push notification that pulls a user toward the terminal during the session.
- No streak that breaks for *not trading*. Not trading is often correct.

## 5. Why this is buildable by one person on Vercel

- The sync problem is solved by an EA that the user installs once — no
  infrastructure needed on our side beyond an authenticated ingest endpoint.
- Everything else is CRUD + SQL aggregation + charts. No ML required for v1.
- Serverless suits the traffic shape: bursty (market close, weekend reviews),
  near-zero overnight.
- The hard parts are *correctness* (MT5 deal aggregation, metric definitions,
  multi-currency), not scale.

## 6. Success criteria for v1

Not "features shipped" — behaviour:

- **Activation**: user connects an account and sees ≥30 days of history within
  10 minutes of signup.
- **The stickiness test**: ≥60% of trading days have at least one tag or note
  added within 24h of the trade closing.
- **The payoff test**: user can answer "what is my single most expensive habit?"
  in under 3 clicks, with a number attached.
