# LogR

A trade journal for leveraged CFD traders, with native MetaTrader 5 auto-sync.
Web app, deployable on Vercel.

> **Status: planning / brainstorm.** No code yet — the docs below are the design
> work that comes before it.

## The short version

Trade journals fail for two reasons: logging is tedious, and the output doesn't
change what you do tomorrow. LogR attacks both.

- **Auto-sync from MT5** via an Expert Advisor on your terminal, which captures
  what a downloaded statement throws away: your **initial stop loss at the moment
  of fill**, the spread you paid, your live equity curve, and automatic chart
  screenshots at entry and exit.
- **Everything normalised to R**, so a 0.02-lot scalp and a 2-lot swing are
  comparable.
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
| [03 — MT5 Integration](docs/03-mt5-integration.md) | **The hard part.** Every sync option analysed; the deal→position→trade problem |
| [04 — Architecture](docs/04-architecture.md) | Vercel-native stack, serverless constraints, derivation pipeline |
| [05 — Data Model](docs/05-data-model.md) | Postgres schema draft |
| [06 — Metrics Spec](docs/06-metrics-spec.md) | Exact definition of every statistic, and the honesty constraints |
| [07 — Roadmap](docs/07-roadmap.md) | M0–M6, with a go/no-go gate at M1 |
| [08 — Open Questions](docs/08-open-questions.md) | Decisions needed before design starts |

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
