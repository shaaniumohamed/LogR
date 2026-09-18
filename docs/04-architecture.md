# Architecture — Vercel-native

## Stack decision

| Layer | Choice | Why this one |
|---|---|---|
| Framework | **Next.js 15, App Router, TypeScript** | Vercel-native, RSC keeps heavy aggregation server-side, route handlers give us the ingest API in the same repo |
| Hosting | **Vercel** | Given. Preview deploys per PR, cron, blob, edge config |
| Database | **Neon Postgres** (Supabase as the alternative) | Serverless Postgres with connection pooling + scale-to-zero + DB branching per preview deploy. Postgres because this is a *heavily analytical* schema (window functions, `generate_series`, percentiles, CTEs) — a document store would be the wrong shape |
| ORM | **Drizzle** | Thin, SQL-first, tiny cold-start, and lets us drop to raw SQL for the analytics queries without fighting the ORM. Prisma's engine is heavier in serverless |
| Auth | **Clerk** (or Auth.js if cost matters) | Ship in an afternoon; org support later for coach/mentor accounts |
| File storage | **Vercel Blob** for v1, **Cloudflare R2** when screenshot volume grows | Zero-config first; R2 has no egress fees, which matters for image-heavy accounts |
| Charts | **Recharts** for stats, **lightweight-charts** for price/replay | TradingView's lightweight-charts is the only sane candlestick option |
| UI | Tailwind + shadcn/ui | Fast, dark-mode by default (traders use dark) |
| Background work | **Vercel Cron** + **QStash/Inngest** for retries | Cron for rollups/digests; a queue for anything that can fail and must retry |
| Email | Resend | React Email templates, trivial |

Deliberately avoided: a long-running Node server, WebSockets from our own
infrastructure, Redis as a hard dependency. All three fight the platform.

## Serverless constraints and how each is handled

| Constraint | Consequence | Mitigation |
|---|---|---|
| Function max duration (60s hobby / 300s pro) | A 5-year statement import can exceed it | Parse **client-side**, POST normalised rows in chunks of ~500; import job tracked in a `import_batches` row so progress survives a refresh |
| 4.5MB request body limit | Statement files and screenshots blow past it | Files never hit our functions — client parses statements; images go to **presigned blob URLs** direct from the EA/browser |
| No persistent connections | Connection-pool exhaustion under burst | Neon serverless driver over HTTP for reads; pooled connection string for transactional writes |
| Cold starts | Ingest latency spikes | Ingest handler is deliberately tiny — validate, upsert, enqueue derivation. All heavy work is deferred |
| No WebSocket server | "Live" dashboards | SWR polling at 15–30s (a journal is not a trading terminal), or Supabase Realtime if we pick Supabase |

## Data flow

```
                     ┌──────────────────────────────────────────┐
  MT5 Terminal       │  EA: OnTradeTransaction + OnTimer         │
  (PC or VPS)        │  queue -> batch -> HMAC-signed POST       │
                     └────────────────┬─────────────────────────┘
                                      │  HTTPS
  Browser: statement ─── parse ───────┤
  (DOMParser, client-side)            │
                                      v
                        POST /api/v1/ingest  (Node runtime)
                        - verify HMAC + timestamp + nonce
                        - zod-validate payload
                        - UPSERT executions ON CONFLICT
                            (account_id, deal_ticket) DO UPDATE
                        - mark affected days dirty
                                      │
                                      v
                     ┌────────────────────────────────────┐
                     │  Derivation pipeline (idempotent)  │
                     │  executions -> positions -> trades │
                     │  -> rule evaluation                │
                     │  -> auto mistake detection         │
                     │  -> daily_stats rollup             │
                     └────────────────┬───────────────────┘
                                      v
                          Neon Postgres (source of truth)
                                      │
            ┌─────────────────────────┼──────────────────────────┐
            v                         v                          v
      RSC dashboard            Vercel Cron                 Blob storage
      (SQL aggregates)    (digests, streaks, MC sims)   (screenshots, raw files)
```

## The derivation pipeline — design rules

The single most important architectural rule: **raw executions are immutable and
everything else is derived and rebuildable.**

- `executions` is append-only, keyed on `(account_id, deal_ticket)`. Re-sending
  the same deal a hundred times changes nothing.
- `positions` and `trades` are **recomputed** from executions for any day marked
  dirty. Never incrementally patched — incremental mutation of derived trade
  state is where these systems rot.
- User-authored data (notes, tags, playbook links, manual trade grouping) lives in
  separate tables keyed to a **stable trade identity**, so a full re-derivation
  never destroys the user's writing. Trade identity = hash of
  `(account_id, sorted position_ids)`, not a serial id.
- A `POST /api/v1/accounts/:id/rebuild` recomputes everything from executions.
  When the parser improves, we re-run it over stored raw files and re-derive.
  This one decision is what makes it safe to ship a v1 parser with known bugs.

## Performance approach

Dashboards must be instant or the calendar dopamine loop breaks.

- **`daily_stats` rollup table** per (account, date): trades, net, gross, R sum,
  wins, losses, fees, swap, max intraday DD, discipline grade. Every calendar and
  equity-curve view reads this, not `trades`.
- Deeper cuts (per-playbook, per-symbol, hour-of-day) run as indexed SQL over
  `trades` — fine up to ~100k trades per user, which no discretionary CFD trader
  will ever reach.
- Materialised views only if profiling demands it. Don't pre-optimise.
- Cache aggregates with `unstable_cache`, keyed on account + a `stats_version`
  bumped by the derivation pipeline. Cheap, correct invalidation.

## Security

- **Never store a broker master password.** Not in any tier, not encrypted, not
  ever. The EA path needs no credentials at all — that is a feature, and it should
  be said loudly on the landing page.
- Per-account API keys: shown once, stored as a hash, revocable, scoped to ingest
  only. HMAC-SHA256 over body + timestamp + nonce; reject skew >5 min; nonce cache
  for replay protection.
- Row-level authorisation on every query — every table carries `user_id` and every
  query filters on the session user. Enforced in a repository layer, not ad hoc.
- Rate limit ingest per API key. A looping EA must not cost us a database.
- Screenshots are private by default; sharing mints a signed, expiring URL.
- GDPR: full export and hard delete. Trading data is sensitive financial data.

## Repo shape

```
/apps/web            Next.js app
  /app               routes (dashboard, trades, calendar, playbooks, reports)
  /app/api/v1        ingest, handshake, presign, rebuild
/packages/core       domain logic — pure, no framework imports
  /derive            deals -> positions -> trades
  /metrics           every statistic, one function each, unit tested
  /rules             rule engine + auto mistake detection
  /parsers           mt5-html, mt5-xlsx, ctrader-csv, generic-csv
/packages/db         drizzle schema + migrations + repositories
/mql5                LogR-Sync.mq5 + includes (public, auditable)
/fixtures            real anonymised statements from many brokers  <-- critical
```

`/packages/core` having **zero framework dependencies** is what makes the metrics
testable and the parsers reusable between the browser and the server.

## Testing strategy (this is a correctness product, not a scale product)

1. **Golden fixtures**: real anonymised statements from as many brokers and
   locales as we can get, each with a hand-verified expected output (trade count,
   net P&L, per-symbol totals). Every parser change runs against all of them.
2. **Property tests on derivation**: for any random deal sequence,
   `sum(trade.net_pnl) == sum(execution.profit + commission + swap + fee)`.
   Reconciliation against the broker's own bottom line is the acceptance test.
3. **Metric unit tests** with worked examples from textbooks, so "profit factor"
   means the same thing here as everywhere else.
4. **Edge-case corpus**: partial closes, scale-ins, `DEAL_ENTRY_INOUT` reversals,
   `OUT_BY` hedge closes, zero-volume corrections, deposits mid-month, a symbol
   renamed by the broker, an account that switched currency.
