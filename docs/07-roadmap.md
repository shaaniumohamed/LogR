# Roadmap

Sequenced so that **something is usable by you, on your own trades, after M1** —
and every milestone after that is judged by whether you actually kept using it.

---

## M-1 — Clickable prototype (~3 days)  ← *do this first*
High-fidelity mockup with realistic fake CFD data: home, calendar, trade detail,
and the review flow. No backend. Purpose: settle the UI direction and time the
review flow before committing to a schema. Cheap to throw away, expensive to skip.

---

## M0 — Foundations (~1 week)
- Next.js + TypeScript + Tailwind + shadcn scaffold, deployed to Vercel
- Neon Postgres, Drizzle schema + migrations, seed script
- Clerk auth, account CRUD
- `/packages/core` skeleton with the metrics module and its test harness
- CI: typecheck, lint, unit tests on every PR; preview deploy per PR

**Done when:** you can log in, create a trading account record, and a deploy is live.

---

## M1 — Import + first dashboard (~2 weeks)  ← *the "would I use this" checkpoint*
- **Exness PA CSV parser** (client-side) with automatic date-chunking around the
  1,000-row export cap, plus the generic MT5 HTML statement parser
- Reconciliation screen before any import commits
- `executions → positions → trades` derivation, including `INOUT` and `OUT_BY`
- Golden-fixture test suite (start with **your own** statements)
- Calendar heatmap · equity curve · the core eight stats · trades table with filters
- Trade detail page: notes, tags, screenshot upload

**Done when:** you import a year of your real history, the net P&L matches your
broker to the cent, and the calendar tells you something you didn't know.

**This is the go/no-go gate.** If M1 doesn't make you want to open it daily, the
feature list is wrong and we re-plan rather than building more.

---

## M2 — Automatic ingestion, no install (~2 weeks)
- **Emailed-statement pipeline**: unique inbound address per user, inbound-email
  webhook, attachment parse, idempotent merge. Plus a generated Gmail/Outlook
  filter the user clicks once.
- `POST /api/v1/ingest` with HMAC auth, idempotent upsert, rate limiting
- **MetaApi bridge** (investor password, free for the first account): poll history
  + open positions every ~30s → captures SL at first sight of a position, every
  stop move with a timestamp, and an equity snapshot per poll
- Equity curve and intraday drawdown from those snapshots

**Done when:** you close a trade on your phone and it is in the app that evening
with no action from you — and, once the bridge is connected, within a minute,
with your stop moves recorded.

*(The MQL5 EA from the original plan moves to "later" — it needs a desktop or VPS
terminal, which isn't the current setup. The ingest API is designed so the EA drops
in as one more source if that ever changes.)*

---

## M3 — Risk model, playbooks, mistakes (~2–3 weeks)
- **Four-model risk engine** (`hard_sl` / `invalidation` / `fixed_fraction` /
  `mae_proxy`) with `risk_source` honesty flags throughout the UI
- **Tap-the-invalidation-level-on-chart** review interaction
- Runner / breakeven / layering / scalp-cost analyses (`09-risk-model.md`)
- Playbook CRUD, trade→playbook tagging with auto-suggestions, per-playbook stats
  with confidence intervals and kill-criteria alerts
- Mistake taxonomy + **auto-detection** (no stop, moved stop, oversized, revenge,
  overtraded) + the cost-attribution report
- Session / hour / day-of-week analytics, DST-correct
- Symbol + cost breakdown (commission, swap, spread)

**Done when:** the app can answer "what is my most expensive habit?" with a number.

---

## M4 — Discipline engine (~2 weeks)
- Rules-as-data, per-trade evaluation, daily discipline grade
- Daily pre-market / post-market review flows, voice notes + transcription
- Prop-firm challenge tracker with live gauges and Monte Carlo pass probability
  (requires the MetaApi bridge for live equity — statements alone give end-of-day only)
- Streaks (process only), email digest via Vercel Cron
- Browser push + Telegram alerts for protective events

**Done when:** the dashboard headline is a discipline grade, not a P&L number.

---

## M5 — Depth (~3 weeks)
- M1 bar capture via EA → MAE/MFE analysis → "your stops are too wide" /
  "you exit early" insights
- Interactive trade replay (lightweight-charts) with entry/exit/SL/TP markers
- Monte Carlo / risk-of-ruin, position-size calculator
- Weekly/monthly PDF reports, CSV export, read-only share links
- Multi-account portfolio view

---

## M6 — Intelligence & polish
- AI weekly narrative (deterministic SQL → LLM narration, never LLM arithmetic)
- Semantic search over notes; emotional-state vs performance correlation
- Chat-with-your-data over a constrained schema
- Economic calendar overlay + news-proximity analysis
- Correlation / concurrent-exposure analysis
- PWA install, offline-capable mobile journaling

---

## Later / conditional
- cTrader adapter (when a cTrader account shows up)
- MetaApi "no-install sync" paid tier (when install friction proves to be the churn cause)
- Desktop bridge agent (if WebRequest whitelist is the churn cause)
- EA risk guard — enforcement, not just reporting (opt-in, warn → block → close,
  with its own demo-account test plan)
- Coach/mentor accounts: a mentor sees a student's journal
- Multi-user launch: billing (Stripe), onboarding, marketing site

---

## Effort reality check
M0–M2 is the genuinely hard part and it is where the moat is. M3–M5 are mostly
SQL and charts — fast once the data model is right. **Do not start M3 until the
derivation layer reconciles perfectly against real statements from at least three
brokers**, because every downstream number inherits its errors, and a journal
that reports the wrong P&L once is deleted.
