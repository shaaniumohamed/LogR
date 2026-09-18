# MT5 Integration — Options, Trade-offs, Decision

This is the highest-risk, highest-value part of the product. Everything else is
CRUD. Get this wrong and the app is a spreadsheet with charts.

## 0. The constraint that shapes everything

**MetaTrader 5 has no public REST API for retail account holders.** The MetaQuotes
Web API is licensed to brokers only. So there is no "enter your credentials and
we'll pull your trades" path that works natively — unlike Interactive Brokers,
Alpaca, or Tradovate, which is why US-equity journals have it easy and MT5
journals do not.

Everything below is a workaround for that one fact.

## 1. Option analysis

### Option A — MQL5 Expert Advisor pushing to our API  ★ PRIMARY
An EA (`LogR-Sync.ex5`) runs on any one chart in the user's terminal. It reacts to
`OnTradeTransaction` and a periodic `OnTimer`, and POSTs JSON to
`https://app.logr.xyz/api/v1/ingest` with an API key.

**Can capture (uniquely):**
- `ORDER_SL` / `ORDER_TP` **at the moment of fill** → true initial risk → real R
- spread, bid/ask and slippage at execution
- account equity/balance/margin snapshot at every event → real equity curve and
  intraday drawdown (prop firms measure equity DD, not closed-trade DD)
- `ChartScreenShot()` images at entry, at exit, and +N bars after exit
- `CopyRates()` M1/M5 bars around the trade window, from **the broker's own feed**,
  which is the only price series that matches the user's actual fills for CFDs
- symbol contract specs (`SYMBOL_TRADE_CONTRACT_SIZE`, `TICK_VALUE`, `TICK_SIZE`,
  `SYMBOL_TRADE_CALC_MODE`, profit/margin currency) → correct money maths per symbol
- magic number + comment → distinguishes manual trades from EA trades

**Costs / risks:**
- Terminal must be running (fine for VPS users; a gap for phone-only traders)
- User must whitelist the URL: *Tools → Options → Expert Advisors → Allow WebRequest
  for listed URL*. `WebRequest` returns `-1` with error **4060** if not whitelisted.
  This is the single biggest onboarding drop-off point → the installer flow must
  hand-hold it with screenshots and a "Test connection" button.
- `WebRequest` is **synchronous and blocks the EA thread**. Never call it from
  `OnTick`. Queue events, flush from `OnTimer` with a short timeout, retry with
  backoff, persist the queue to file so a terminal restart doesn't lose events.
- MQL5 has no JSON library in the stdlib — hand-roll a small serializer, and be
  strict about escaping (broker comments contain quotes and non-ASCII).
- Distribution: a `.ex5` from an unknown source triggers reasonable paranoia.
  Publish the MQL5 source in the repo so it is auditable; consider MQL5 Market
  listing later for trust.

**Verdict: this is the product's moat.** Ship it as the flagship "Connect MT5".

### Option B — Local bridge agent (Python + `MetaTrader5` package)
A small signed desktop app calls `mt5.initialize()` / `mt5.history_deals_get()` /
`mt5.positions_get()` against the running terminal and pushes to our API.

- **Pros:** far easier to develop and iterate than MQL5; full history in one call;
  can drive multiple terminals; no WebRequest whitelist step.
- **Cons:** the `MetaTrader5` Python package is **Windows-only** (macOS users run
  MT5 under Wine/PlayOnMac where the package does not attach); shipping a signed
  desktop binary is real work (code-signing cert, auto-update, antivirus false
  positives); it *still* cannot retroactively recover the initial SL for past
  trades — it only wins from install date forward, same as the EA.
- **Verdict:** keep as a v2 alternative for users who refuse the WebRequest step,
  or for power users with many accounts. Not first.

### Option C — Statement / report import  ★ REQUIRED FALLBACK
MT5 → *Toolbox → History → right-click → Report* → HTML/XLSX. Also CSV exports
from some brokers, and `Positions`/`Deals` tab copies.

- **Pros:** zero install, works on any broker, any platform, any account the user
  can log into — including read-only investor access and prop-firm dashboards.
  Works for **backfilling years of history** before the EA was installed.
- **Cons:** no initial SL, no equity curve granularity, no spread, no screenshots.
  Broker-localised column headers (Russian, Chinese, Spanish reports exist),
  inconsistent decimal separators, and several brokers ship subtly broken HTML.
- **Verdict: build this first.** It is the fastest path to a demo-able product, it
  is the onboarding hook ("drag your statement here, see your stats, no signup"),
  and it is the permanent backfill mechanism. Every user will use it once.

### Option D — Third-party cloud bridge (MetaApi.cloud and similar)
Commercial services that host MT4/MT5 terminals and expose REST/WebSocket, using
the account's **investor (read-only) password**.

- **Pros:** no user install at all; works on mobile-only users; real-time streaming;
  historical deals via API; some offer risk-management endpoints.
- **Cons:** per-account monthly cost that scales with users (kills free-tier
  economics); we'd be asking users to hand over a password to a third party
  (investor password is read-only, which helps, but it is still a trust ask and a
  support/liability surface); vendor dependency for a core feature; **still no
  initial SL** for past trades and only best-effort for live ones.
- **Verdict:** optional paid "No-install sync" tier later. Never the default, never
  the only path, and never with a *master* password.

### Option E — Native broker/platform APIs
Where the trader's broker or prop firm offers something better than MT5:
- **cTrader Open API** — OAuth2 + Protobuf over TCP/WebSocket. Genuinely good.
  Real OAuth means no credential storage. Worth an adapter once cTrader users show up.
- **DXtrade / Match-Trader / TradeLocker** — increasingly common at prop firms;
  most have partner APIs, availability varies by firm.
- **Verdict:** design the ingest layer platform-agnostic from day one so these drop
  in as adapters. Do not build them until a user asks.

## 2. Decision

| Phase | Path | Purpose |
|---|---|---|
| v0.1 | **C — statement import** | Onboarding hook, backfill, works for everyone |
| v0.2 | **A — MQL5 EA** | Real-time auto-sync, initial SL, screenshots, equity curve |
| v1.x | **E — cTrader adapter** | Second platform, proves the adapter abstraction |
| v1.x | **D — MetaApi** (paid tier) | Mobile-only / install-averse users |
| v2 | **B — desktop agent** | Power users, multi-account, WebRequest refuseniks |

Critical design rule: **A and C must converge on the same normalised
`executions` rows**, with the EA's richer fields treated as optional enrichment.
The same trade arriving from both paths must dedupe, not duplicate, and the EA's
version must win on conflict.

## 3. The data model problem nobody warns you about

MT5's history is a stream of **deals**, not trades. Turning deals into things a
human calls "a trade" is where every MT5 journal has bugs.

### 3.1 Deals → positions
Each deal carries `DEAL_POSITION_ID`. Group by it. But:

- `DEAL_ENTRY_IN` opens or **adds to** a position (scale-in). Multiple INs per
  position id are normal.
- `DEAL_ENTRY_OUT` closes or **partially closes**. Multiple OUTs per position id.
- `DEAL_ENTRY_INOUT` is a **reversal** on a netting account: one deal closes the
  existing position and opens an opposite one. A naive parser records this as one
  trade and gets both the direction and the P&L wrong. It must be split into a
  close leg and an open leg.
- `DEAL_ENTRY_OUT_BY` is a **close-by** between two opposing hedged positions —
  it touches *two* position ids and the profit lands on one of them.

### 3.2 Netting vs hedging accounts
`AccountInfoInteger(ACCOUNT_MARGIN_MODE)` returns `RETAIL_NETTING` or
`RETAIL_HEDGING`. On netting, one symbol = one position, so three separate trade
ideas on US30 collapse into a single position id. On hedging (the retail default
for most CFD brokers), each entry is its own position. **The same user behaviour
produces completely different history shapes.** Store the account mode and branch.

### 3.3 Non-trade deals must be filtered, not summed
`DEAL_TYPE_BALANCE`, `CREDIT`, `CHARGE`, `CORRECTION`, `BONUS`, `COMMISSION*`,
`INTEREST` appear in the same history. Deposits must not count as profit; swaps
and commissions are sometimes booked as separate deals rather than fields on the
trade deal, depending on the broker. Both cases have to be handled, or P&L will
disagree with the broker's statement — which instantly destroys trust.

### 3.4 Three layers, not one
```
execution   one MT5 deal, immutable, idempotent on (account_id, deal_ticket)
   |
position    deals grouped by position_id -> VWAP entry/exit, net volume, fees
   |
trade       one or more positions grouped by the USER's intent
```
That third layer matters: a trader who scales into US30 with three separate
tickets thinks of it as *one trade*. Auto-group by heuristic
(same symbol + same direction + overlapping in time + within N minutes) and let
the user merge/split manually. Stats run on `trades`, never on raw deals.

### 3.5 Money is decimal, and multi-currency
Use `NUMERIC`, never floats. An account in GBP trading XAUUSD has profit currency
USD; the broker converts at its own rate. Trust the broker's reported
`DEAL_PROFIT` in **account currency** as the source of truth, and store the
instrument's own currency separately for analysis. Never recompute the user's P&L
from prices and pretend it's authoritative — if our number differs from their
statement by one cent they will stop using the app.

### 3.6 Instrument specs per broker
`US30` on one broker is `US30.cash`, `DJ30`, `WS30`, `USA30` on others, with
different contract sizes and tick values. Maintain:
- `broker_symbol` (raw) + `canonical_symbol` (mapped) + `asset_class`
- specs captured from the terminal (`SYMBOL_TRADE_CONTRACT_SIZE`, `TICK_SIZE`,
  `TICK_VALUE`, `SYMBOL_TRADE_CALC_MODE`, `DIGITS`) — the EA can just send these,
  which is far more reliable than a hardcoded table
- a fuzzy mapper + manual override UI for statement-only users

## 4. EA design sketch

```
OnInit()
  read API key from input; GET /api/v1/handshake -> validates key, returns
    server time, last_known_deal_ticket, feature flags
  if WebRequest returns -1 && GetLastError()==4060 -> show clear whitelist
    instructions in the Experts log AND on the chart comment
  register account: login, server, company, currency, leverage, margin mode,
    trade mode (demo/real/contest)
  EventSetTimer(10)

OnTradeTransaction(trans, request, result)
  if trans.type == TRADE_TRANSACTION_DEAL_ADD:
      snapshot: deal fields, position SL/TP *now*, spread, equity, balance
      if this is an opening deal -> ChartScreenShot() entry image
      if this is a closing deal  -> ChartScreenShot() exit image
                                  + schedule a follow-up shot in N bars
      enqueue(event)   // file-backed queue, survives restart

OnTimer()
  flush queue in batches of <=50 with WebRequest POST (timeout 5000ms)
  exponential backoff on failure, cap the queue, never block on error
  every 60s: push an equity/balance/margin/open-positions heartbeat
  every 15m: reconcile -> HistorySelect(last_sync-2d, now), diff against
             server's known tickets, push anything missing (self-healing)

OnDeinit()
  flush, EventKillTimer()
```

Key robustness rules:
- **Idempotency**: every event carries `deal_ticket`; server upserts. Replay-safe.
- **Backfill on install**: after handshake, walk `HistorySelect()` from account
  open date in monthly chunks and push everything. Show progress on the chart.
- **Clock**: send both `DEAL_TIME` (broker server time, usually GMT+2/+3) and the
  broker server's UTC offset. Storing broker-local time without the offset makes
  all session analysis wrong. Store UTC in the DB, display in the user's tz.
- **Auth**: per-account API key, HMAC-SHA256 signature over the body with a
  timestamp + nonce to prevent replay. Key is revocable from the web UI.
- **Screenshots**: `ChartScreenShot()` writes to `MQL5/Files`; read with
  `FileOpen`/`FileReadArray`, base64 with `CryptEncode(CRYPT_BASE64, ...)`.
  These are large — upload to a presigned URL out of band, not inline in the
  event batch, and make them best-effort (never block trade sync on an image).

## 5. Optional: the EA as a risk guard (v2, opt-in, big differentiator)

The EA is already on the terminal and already knows the user's rules. It can
enforce them:
- block/close new orders once the daily loss limit is hit
- refuse an order whose size exceeds max risk %
- warn when no SL is attached
- hard-stop after N consecutive losses

This is the difference between a journal that *reports* indiscipline and a tool
that *prevents* it — and for prop-firm traders whose account dies at −5% in a day,
it is worth more than every chart in the app.

Must be explicitly opt-in, per-rule, with a visible kill switch, and it must never
close a position without the user having armed that specific behaviour.
**This feature touches real money: it needs its own test plan on demo accounts
and very conservative defaults (warn-only first, block second, close last).**

## 6. Statement parser notes (Option C)

- Parse **client-side** with `DOMParser`. A 5MB HTML statement is trivial in the
  browser and completely sidesteps serverless payload and duration limits. Only
  normalised JSON rows get POSTed.
- Match sections by structure, not by localised header text where possible;
  keep a header synonym dictionary for the common locales.
- Show a **reconciliation screen** before committing: rows parsed, date range,
  net P&L, deposits/withdrawals, and "does this match your statement's bottom
  line?" with the broker's own totals side by side. Never silently import.
- Store the raw file (blob) so a parser improvement can re-run historical imports.
- Same idempotency key as the EA path so an import after an EA sync is a no-op.
