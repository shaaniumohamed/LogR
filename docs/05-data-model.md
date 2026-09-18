# Data Model (first draft)

Postgres. All money `NUMERIC(20,8)`. All timestamps `TIMESTAMPTZ`, stored UTC.
Every user-owned table carries `user_id` for row-level authorisation.

## Identity & accounts

```sql
users(id, email, name, timezone, base_currency, created_at)

trading_accounts(
  id, user_id,
  platform            text,      -- 'mt5' | 'mt4' | 'ctrader' | 'dxtrade' | 'manual'
  broker_name         text,      -- ACCOUNT_COMPANY
  server_name         text,      -- ACCOUNT_SERVER
  login               text,      -- ACCOUNT_LOGIN (not a credential)
  nickname            text,
  currency            char(3),   -- ACCOUNT_CURRENCY
  leverage            int,
  margin_mode         text,      -- 'netting' | 'hedging'
  account_type        text,      -- 'live' | 'demo' | 'prop_challenge' | 'prop_funded' | 'backtest'
  server_utc_offset_m int,       -- broker server tz offset; REQUIRED for session analytics
  initial_balance     numeric,
  is_active           bool,
  last_sync_at        timestamptz,
  sync_method         text,      -- 'ea' | 'import' | 'api' | 'manual'
  created_at
)

api_keys(id, user_id, account_id, key_hash, key_prefix, last_used_at, revoked_at)
```

## Instruments

```sql
instruments(
  id, account_id,
  broker_symbol     text,     -- 'US30.cash'
  canonical_symbol  text,     -- 'US30'
  asset_class       text,     -- 'index_cfd'|'fx'|'metal'|'energy'|'crypto_cfd'|'share_cfd'
  contract_size     numeric,  -- SYMBOL_TRADE_CONTRACT_SIZE
  tick_size         numeric,  -- SYMBOL_TRADE_TICK_SIZE
  tick_value        numeric,  -- SYMBOL_TRADE_TICK_VALUE (account ccy)
  digits            int,
  calc_mode         int,      -- SYMBOL_TRADE_CALC_MODE: forex/cfd/cfdindex/cfdleverage...
  profit_currency   char(3),
  margin_currency   char(3),
  UNIQUE(account_id, broker_symbol)
)
```
Captured from the terminal by the EA — vastly more reliable than a hardcoded
symbol table. For import-only users, inferred + user-correctable.

## The three layers

```sql
-- LAYER 1: immutable raw. One MT5 deal.
executions(
  id, account_id, instrument_id,
  deal_ticket        bigint,        -- idempotency key
  order_ticket       bigint,
  position_id        bigint,        -- DEAL_POSITION_ID: the grouping key
  deal_type          text,          -- 'buy'|'sell'|'balance'|'credit'|'charge'|...
  entry_type         text,          -- 'in'|'out'|'inout'|'out_by'
  volume             numeric,       -- lots
  price              numeric,
  executed_at        timestamptz,   -- UTC
  broker_time        timestamptz,   -- as reported, for auditing
  commission         numeric,
  swap               numeric,
  fee                numeric,
  profit             numeric,       -- broker's number, account ccy. SOURCE OF TRUTH
  -- EA-only enrichment (null for statement imports)
  sl_at_execution    numeric,       -- THE critical field: true initial risk
  tp_at_execution    numeric,
  bid_at_execution   numeric,
  ask_at_execution   numeric,
  spread_points      int,
  equity_after       numeric,
  balance_after      numeric,
  magic              bigint,
  comment            text,
  source             text,          -- 'ea'|'import'|'manual'|'api'
  raw                jsonb,
  UNIQUE(account_id, deal_ticket)
)

-- LAYER 2: derived. Deals grouped by position_id. Fully rebuildable.
positions(
  id, account_id, instrument_id, position_id bigint,
  direction text,                  -- 'long'|'short'
  opened_at, closed_at,
  volume_opened, volume_closed, is_open bool,
  avg_entry_price numeric,         -- volume-weighted
  avg_exit_price  numeric,
  initial_sl numeric, initial_tp numeric,      -- from the FIRST 'in' execution
  final_sl numeric,                            -- SL at close: detects stop-moving
  gross_pnl, commission, swap, fee, net_pnl numeric,
  UNIQUE(account_id, position_id)
)

-- LAYER 3: the user's mental model. One or more positions.
trades(
  id, account_id, user_id,
  identity_hash text,              -- hash(account_id, sorted position_ids) - STABLE
  instrument_id, direction,
  opened_at, closed_at, duration_s int,
  volume numeric, avg_entry, avg_exit numeric,
  initial_sl, initial_tp numeric,
  risk_amount numeric,             -- money at risk at entry (account ccy)
  risk_source text,                -- 'measured_sl'|'user_entered'|'account_default' ← honesty flag
  r_multiple numeric,              -- net_pnl / risk_amount
  planned_rr numeric,
  gross_pnl, commission, swap, fee, net_pnl numeric,
  mae_price, mfe_price numeric,    -- worst/best excursion
  mae_r, mfe_r numeric,
  is_backtest bool,
  grouping text,                   -- 'auto'|'manual'
  UNIQUE(account_id, identity_hash)
)

trade_positions(trade_id, position_id)     -- many-to-many
```

**Why `identity_hash`**: trades get rebuilt constantly (parser fixes, re-imports,
manual regrouping). User-authored content must survive that. Keying notes and tags
to a serial id that changes on rebuild loses people's journals — an unrecoverable
trust failure.

## User-authored layer (survives all re-derivation)

```sql
playbooks(id, user_id, name, description, entry_criteria jsonb, invalidation,
          target_logic, expected_r, allowed_sessions text[], allowed_symbols text[],
          is_active, archived_at)

trade_playbooks(trade_id, playbook_id, criteria_met jsonb, adherence_score)

tags(id, user_id, name, kind)        -- 'mistake'|'emotion'|'context'|'custom'
trade_tags(trade_id, tag_id, auto_detected bool, confidence numeric)

trade_notes(id, trade_id, user_id, body_md, rating int, created_at, updated_at)

attachments(id, user_id, trade_id, kind, blob_url, width, height, captured_at,
            source)                  -- 'ea_entry'|'ea_exit'|'ea_after'|'user_upload'

plans(id, user_id, account_id, symbol, direction, thesis, entry_zone, planned_sl,
      planned_tp, planned_volume, playbook_id, created_at,
      matched_trade_id, match_confidence)    -- pre-trade intent, auto-matched

journal_entries(id, user_id, date, kind, body_md, mood int, energy int,
                voice_url, transcript)       -- 'premarket'|'postmarket'|'weekly'|'freeform'
```

## Rules & compliance

```sql
rules(id, user_id, account_id, kind, params jsonb, severity, is_active)
-- kind: 'max_risk_pct'|'max_trades_day'|'max_losses_day'|'daily_loss_limit'
--     | 'stop_required'|'allowed_symbols'|'allowed_sessions'|'cooldown_after_loss'
--     | 'min_rr'|'playbook_required'|'no_news_trading'

rule_evaluations(id, rule_id, trade_id, date, passed bool, detail jsonb)

prop_challenges(id, user_id, account_id, firm, phase, start_balance,
  profit_target, max_daily_loss, max_total_dd, dd_type,     -- 'static'|'trailing'
  min_trading_days, consistency_pct, started_at, deadline, status)
```

## Rollups & time series

```sql
daily_stats(account_id, date, trade_count, wins, losses, gross, net,
            commission, swap, r_sum, r_avg, max_intraday_dd, discipline_grade,
            rule_breaks int, PRIMARY KEY(account_id, date))

account_snapshots(account_id, at, balance, equity, margin, free_margin,
                  open_positions int)      -- EA heartbeat; the REAL equity curve

price_bars(instrument_id, timeframe, ts, o, h, l, c, volume,
           PRIMARY KEY(instrument_id, timeframe, ts))   -- MAE/MFE + replay

import_batches(id, user_id, account_id, filename, raw_blob_url, status,
               rows_parsed, rows_imported, rows_duplicate, error jsonb,
               parser_version)             -- enables re-parse on parser upgrade
```

## Key indexes

```sql
executions(account_id, executed_at)
executions(account_id, position_id)
trades(account_id, closed_at DESC)
trades(account_id, instrument_id, closed_at)
trades(user_id, closed_at DESC) WHERE is_backtest = false
daily_stats(account_id, date DESC)
price_bars(instrument_id, timeframe, ts)
```

## Open modelling questions

- Partial closes at different R: does a trade scaled out in thirds have one
  R-multiple (weighted) or three? **Proposal:** one weighted R at trade level,
  plus per-leg R available in the detail view.
- Swap on multi-day positions: attribute to the trade (current plan) or report
  separately as carry? Both — `net_pnl` includes it, and there is a dedicated
  cost report so it can't hide.
- Currency conversion for multi-currency accounts: store everything in account
  currency (broker's own conversion), convert to the user's base currency only in
  the aggregate portfolio view, with the rate and date recorded.
