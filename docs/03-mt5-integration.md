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

### Option F — Emailed statement ingestion  ★ NEW PRIMARY for phone-only traders
Exness (like most brokers) **emails daily and monthly account statements** to the
registered address, automatically, forever, with no setup. A Gmail/Outlook filter
auto-forwards them to a unique per-user address (`u_a1b2c3@in.logr.app`); an
inbound-email webhook (Resend/Postmark/SendGrid) hands us the attachment; we parse
and ingest.

- **Pros:** genuinely zero-install and zero-credential. Works if the trader never
  touches a desktop. Nothing to remember — the broker pushes the data at us on a
  schedule. Self-healing: monthly statements re-cover the whole month, so any
  missed day repairs itself. Costs nothing.
- **Cons:** end-of-day granularity, not real-time. No initial SL, no equity
  granularity, no screenshots. Requires a one-time mail-filter setup (~2 min, and
  we can generate the exact Gmail filter for the user to click).
- **Verdict:** for a phone-only trader this is the best automatic path in
  existence, and for an intraday trader who reviews in the evening, end-of-day
  latency costs nothing. **Ship it in v0.1 alongside manual import.**

## 2. Decision (revised for a phone-first Exness trader)

The original plan led with an Expert Advisor. That assumed a desktop or VPS
terminal. For a trader who works from the MT5 mobile app, the EA is unavailable,
so the ranking inverts:

| Phase | Path | Latency | Gets initial SL? | User effort |
|---|---|---|---|---|
| v0.1 | **C — Exness PA CSV import** | manual | no | drag & drop, one-off backfill |
| v0.1 | **F — emailed statements** | end of day | no | one mail filter, then nothing |
| v0.2 | **D — MetaApi bridge** (investor password) | ~30s | **yes, for live trades** | paste read-only password once |
| later | **A — EA** | instant | yes | only if a desktop/VPS terminal ever appears |
| later | **B/D-self-hosted** | ~30s | yes | our own VPS, if MetaApi cost bites |

### Why MetaApi earns its place here
It was ranked last when an EA was viable. For a phone-only trader it is the only
way to get the things that make the analytics good, and two facts make it cheap:

1. **One account is free.** Additional accounts are a small flat monthly fee —
   fine for "me + a few friends".
2. **Investor password is read-only.** It cannot place, modify or close a trade,
   and it cannot withdraw. The blast radius of a leak is "someone can see your
   trades". That is a materially different risk from a master password, and it is
   the only credential we would ever accept.

**The polling trick that recovers the moat:** poll `get_positions()` every 15–30s.
The first time a position appears we record its SL/TP — so when you move your stop
to breakeven after taking a partial, we capture **both** the original state and the
move, with timestamps. We can't get the initial SL for *history*, but from
connection day forward we get it for every live trade, plus an equity snapshot on
every poll → real equity curve, real intraday drawdown, real prop-firm gauges.

### Self-hosted alternative (v2, if per-account cost becomes annoying)
One ~$15/mo Windows VPS running MT5 + a Python poller using the `MetaTrader5`
package, calling `mt5.login(login, investor_password, server)` per account in
rotation. This is "self-hosted MetaApi" and is economic past roughly 5–8 accounts.
It cannot live on Vercel — it's a small always-on companion service (Fly.io/Hetzner
+ Windows, or a Windows VPS). Worth building only once the user count justifies it.

## 2b. Exness specifics

| Source | Format | Notes |
|---|---|---|
| PA → Trading → History of orders → **Download CSV** | CSV | **Capped at 1,000 records** — the importer must chunk by date range automatically and stitch the results |
| PA → account statement with custom dates | HTML/PDF | Better for long backfills than the CSV cap allows |
| **Daily + monthly statements emailed automatically** | attachment | The Option F pipeline. Zero ongoing effort |
| MT5 mobile → History → scroll to end → **Save as PDF** (iOS) | PDF | Fragile to parse; last resort only |
| Exness server names | `Exness-MT5Real`, `-Real2`… `-MT5Trial` | Needed for any bridge login; ask for it explicitly at connect time |

Exness runs several account types (Standard, Raw Spread, Zero, Pro) with different
commission structures. Raw Spread and Zero charge per-lot commission while
Standard bakes it into the spread — so **cost analysis must know the account type**
or the "what your broker costs you" report will be wrong. Capture it at setup.

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

## 5b. Exness export formats — which one is actually usable

Exness offers more than one export and they are **not** interchangeable:

| Export | Contains | Usable for the journal? |
|---|---|---|
| PA → **Trading Analytics / summary report** (PDF) | Account-level aggregates only: gain, drawdown, profit factor, gross profit/loss, commissions, swaps, deposits/withdrawals, trades-per-week, average hold | **No** — no per-deal rows. Useful only for reconciliation and as a header record |
| PA → Trading → **History of orders → Download CSV** | Per-order rows | **Yes** — the primary import. 1,000-row cap, so chunk by date |
| PA → **account statement**, custom dates | Per-deal rows | **Yes** — better for long backfills |
| Emailed daily/monthly statements | Per-deal rows | **Yes** — the automatic pipeline |
| MT5 mobile → Save as PDF (iOS) | Formatted report | Last resort; fragile |

**Onboarding consequence:** the summary PDF is the easiest thing for a user to
find and send, and it is the one that won't work. The import screen must name the
exact export required, with a screenshot of the menu path, and must detect a
summary-only report and say so clearly rather than failing with a parse error.

**Reconciliation gift:** the summary report is still worth accepting as an optional
upload, because it provides an independent check:
```
deposits − withdrawals + net_profit == closing_balance
```
If our parsed deals don't reproduce the broker's own gross profit, gross loss and
closing balance, the import is wrong and we say so before saving anything.

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
