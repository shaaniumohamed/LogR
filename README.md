# LogR

A trade journal for leveraged CFD traders, with native MetaTrader 5 auto-sync.
Web app, deployable on Vercel.

> **Status: planning / brainstorm.** No code yet — the docs below are the design
> work that comes before it.

## The short version

Trade journals fail for two reasons: logging is tedious, and the output doesn't
change what you do tomorrow. LogR attacks both.

- **Sync without installing anything**: your broker already emails you daily
  statements — auto-forward them and they import themselves. Add a read-only
  investor-password bridge for near-real-time sync that records every stop move.
- **A risk model that fits discretionary trading** — no fixed stop required.
  Tap where the idea was invalidated and get real R, plus a measure of whether you
  actually exit where you said you would.
- **Layering, partials and runners as first-class citizens** — is your runner
  actually paying, or should you take full TP?
- **Playbooks** turn journaling into strategy validation — per-setup expectancy
  with confidence intervals, and kill-criteria alerts when a setup has no edge.
- **Auto-detected mistakes with a price tag**: "moved stop against me — 14 trades,
  −£3,180." Most of them are detected from the data without you tagging anything.
- **Rules engine + discipline grade**: the headline number is plan adherence,
  not profit. Plus a live prop-firm challenge tracker.

## Docs

| | |
|---|---|
| [01 — Strategy](docs/01-strategy.md) | Who it's for, positioning, the persuasion model and its ethics |
| [02 — Features](docs/02-features.md) | The full brainstorm, prioritised into build tiers with reasoning |
| [03 — Data Ingestion](docs/03-mt5-integration.md) | **The hard part.** Every sync option analysed; the deal→position→trade problem |
| [04 — Architecture](docs/04-architecture.md) | Vercel-native stack, serverless constraints, derivation pipeline |
| [05 — Data Model](docs/05-data-model.md) | Postgres schema draft |
| [06 — Metrics Spec](docs/06-metrics-spec.md) | Exact definition of every statistic, and the honesty constraints |
| [07 — Roadmap](docs/07-roadmap.md) | M0–M6, with a go/no-go gate at M1 |
| [08 — Open Questions](docs/08-open-questions.md) | Decisions needed before design starts |
| [09 — Risk Model](docs/09-risk-model.md) | Journaling a discretionary trader who uses no fixed stop |
| [10 — UI/UX](docs/10-ui-ux.md) | Phone-first design direction and screen inventory |
| [11 — Behavioural Design](docs/11-behavioural-design.md) | The daily loop, in-session intervention, accountability group, first-run |
| [12 — Charts & Media](docs/12-charts-and-media.md) | Reconstructed charts, screenshot capture, voice notes |
| [13 — XAUUSD](docs/13-xauusd.md) | Gold specialisation: volatility regime, news proximity, spread conditions |
| [14 — High Frequency](docs/14-high-frequency.md) | Redesign for ~100 orders/day; supersedes parts of 10 and 11 |
| [15 — Methodology](docs/15-methodology.md) | Zone trades, automatic structure annotation, confluence marginal value |
| [16 — Cost & Capital](docs/16-cost-and-capital.md) | Measuring the spread the broker reports as zero; working-capital accounts |

## Data handling rule for this repo

**This repository is public. No real account data goes in it — ever.**

- No account numbers, logins, server names, broker account nicknames or balances
- No real P&L figures, volumes, or statement extracts, in docs, commits or tests
- Worked examples in docs are **synthetic**, and say so
- Test fixtures must be anonymised before they are committed: account identifiers
  replaced, figures scaled by an undisclosed factor, dates shifted. A fixture that
  cannot be anonymised does not get committed — it stays local and the test skips
- Credentials of any kind (API keys, investor passwords) never touch the repo,
  and the application never stores a broker master password anywhere

Analysis of real data happens outside version control. Only the **design
conclusions** it produces get written down here.

## Design principles

1. **Raw executions are immutable; everything else is derived and rebuildable.**
   User-authored notes key to a stable trade identity so a re-derivation never
   destroys someone's journal.
2. **Never store a broker master password.** The EA path needs no credentials at all.
3. **Reconcile to the cent.** If our P&L disagrees with the broker's statement,
   the product is dead — so reconciliation is the acceptance test, not a nice-to-have.
4. **Grade the process, not the P&L.** What sits at the top of the dashboard is
   what the user optimises for.
5. **The LLM narrates; SQL calculates.** No statistic is ever produced by a model.
6. **An alert that stops an action is legitimate; one that prompts an action is not.**
   The app never encourages a trade.
7. **Reward only what is under your control.** Streaks are for reviewing and
   following rules, never for winning or for trading frequency.
