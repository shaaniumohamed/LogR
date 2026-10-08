# Backtesting — replay, simulated trading, and a backtest journal

The journal answers "what did I do?". The backtester answers "what would this
idea have done?", and — because both live in the same app — "am I trading my
idea the way I tested it?". No competitor joins those two up properly: replay
tools keep simulated trades in their own silo, and journals do not replay.

## What it must do

| Need | Why it matters |
|---|---|
| Pick any date in the history and replay forward | Practice reading price as it unfolded, without knowing what came next |
| Switch timeframes mid-replay without losing the moment | Bias is read on the 4H, entry on the 1m — one idea, many timeframes |
| The full drawing kit, with magnet | Fewer tools means less analysis; levels, zones and fibs are the method |
| Trade like a real broker | Limit orders, stop and target dragged on the chart, partials, breakeven, ladders — the way the trader actually trades |
| Fills that are not guesses | A five-minute scalp's stop and target often sit inside one minute candle; only ticks settle which came first |
| Log and measure every backtest trade | A backtest nobody can read back is a game, not research |
| Strategy → Sessions | Many sessions test one idea; the idea is what gets judged |
| iPhone as good as laptop | Backtesting happens wherever the trader is |

## Decisions

### Price data: the broker's own ticks, stored as files in R2

The trader's Exness tick history, 2015–2026, as downloaded from Exness (yearly
zips, ~2 GB each unzipped). Columns `Exness, Symbol, Timestamp, Bid, Ask`,
UTC timestamps with milliseconds, three-decimal prices, symbol `XAUUSDm`.

| Figure | Value |
|---|---|
| Bytes per CSV line | ~55 |
| Ticks per year | ~36 million (~140k per trading day) |
| Ticks 2015–2026 | ~430 million |
| Compressed binary | ~3–4 bytes per tick → ~120–150 MB a year, ~1.5–2 GB in total |

That rules Postgres out (Neon's free tier is 0.5 GB) and puts the data in
**Cloudflare R2** — 10 GB free, no egress fees, already wired up for
screenshots (`lib/storage.ts`). Postgres keeps only a catalogue of files
(`market_chunk`).

Three resolutions, all built from the same ticks by the same code
(`lib/core/market/bars.ts`), so they can never disagree with each other:

| File | Granularity | Used for |
|---|---|---|
| tick, period `YYYY-MM-DD` | one UTC day | fills, seconds charts, the forming candle |
| m1, period `YYYY-MM` | one month | 1m–30m charts |
| h1, period `YYYY` | one year | 1h, 4h, and the context behind them |
| d1, period `YYYY` | one year (raw UTC days) | 1d and 1w over years |

Objects are named `market/v1/{SYMBOL}/{resolution}/{YYYY}/{period}-{sha256 prefix}.{lgrt|lgrb}.gz`.
The content hash in the name means a re-import writes beside the old file, the
catalogue row switches to it, and only then is the old object removed — a
reader mid-download never loses the file under it. The browser caches files in
IndexedDB keyed by that hash, so nothing it holds can ever be stale.

Import runs in a Web Worker on the owner's laptop (`lib/market/importer.ts`):
the zip is unzipped as a stream, each finished UTC day is encoded and uploaded
straight to R2 through a short-lived signed link, and month and year files are
built as the import passes their end. Where the store already holds part of a
month or year, only the days the import brings are replaced; a file's first and
last day are joined with any stored half from the neighbouring file. Every
upload is "describe → signed link → PUT → commit", and the describe step answers
"skip" for a file already held byte-for-byte — so an interrupted import is
simply run again. Removal is by whole year, the unit every file kind lines up on.

The spread in these files is the **Standard** account's (`m` suffix). The
trader's live account is Pro, so every session carries a spread setting: as
recorded, fixed, or recorded minus an offset.

The data never enters the public repository. It is shared with the trader's
invited friends inside the app; only owners can import or delete it.

### Charting: lightweight-charts plus the MIT 86-tool kit, made touch-first

TradingView's Advanced Charts library is ruled out: it is licensed only to
companies for public, non-paywalled products, and no part of it may sit in a
public repository. LogR is invite-only and its repository is public.

[lightweight-charts-drawing](https://github.com/deepentropy/lightweight-charts-drawing)
(MIT) provides 86 TradingView-style tools on lightweight-charts v5, which this
app already uses. Its input layer is already built on pointer events, so touch
half-works; a touch layer around it (see the trial below) gives it what touch
needs: finger-sized hit areas, `touch-action` control, a
precision cursor that sits above the finger, double-tap and long-press
equivalents, two-finger pass-through to pinch-zoom, frame-coalesced redraws,
and a bodies-only magnet for MSNR. The host adds undo/redo, toolbars, an
object list and templates. The journal's trade chart moves to the same engine.

#### Trial results (kit 0.5.0, 8 Oct 2026)

Every tool was placed by script on a synthetic gold chart, once with a mouse at
1280 px and once by touch on a 390 px phone viewport.

| Check | Mouse | Touch, kit as shipped | Touch, with the touch layer |
|---|---|---|---|
| Tools placed (of 83 that need no host input*) | 83 | 77 | 83 |
| Tap selects a drawing, drag moves it | yes | yes | yes |
| Chart still pans when nothing is armed | yes | yes | yes |
| Press, slide, lift places the point where the finger lifts | — | — | yes |

\* Image, table and font icon wait for the host to supply a file, cells or a
glyph; they are wired up with the rest of the host UI.

What failed by touch, and the fix each needs (all host-side, no fork):

- **Brush and highlighter** — the browser claims the drag as a scroll and
  sends `pointercancel`. Fix: `touch-action: none` on the chart while a tool is
  armed (confirmed).
- **Finishing a polyline or path** — the kit finishes on double-click, which
  a double-tap does not reliably produce. Fix: the touch layer recognises the
  double-tap itself and sends the kit a double-click, plus a Done button.
- **Precision** — the kit has no notion of a finger hiding the point. Fix:
  hold the press back while a tool is armed, show a magnifier above the
  finger, and replay the press where the finger lifts (confirmed: the kit
  accepts replayed events and places the point at the lift position).

Panning frame times (no GPU in the test machine, so absolute numbers are
pessimistic; the comparison is what matters):

| Drawings on screen | 1280 px median / p95 | 390 px median / p95 |
|---|---|---|
| 0 | 16.6 / 18.1 ms | 16.6 / 18.8 ms |
| 20 | 17.5 / 24.1 ms | 16.6 / 21.8 ms |
| 100 heavy (fibs, channels, position boxes) | 51.8 / 71.8 ms | 38.3 / 57.5 ms |

Of the 100-drawing frame, 52% is rasterising pixels (software here), 22% the
kit's JavaScript and 12% the chart's. The kit's hottest function rebuilds a
number formatter on every call (`toLocaleString` with options, in the
position tools' labels) — a cached `Intl.NumberFormat` removes it; offered
upstream. Typical charts carry 10–40 drawings, which stay at 60 fps.

**Decision:** depend on the published package, pinned to an exact version,
rather than vendoring a fork — it is releasing several times a week and a fork
would fall behind at once. The touch layer wraps it from outside. Fixes the
kit itself needs go upstream as pull requests; a patch is applied locally only
if one is not accepted in time.

### Simulation: tick-exact, deterministic, and shaped like the journal

The replay engine (`lib/core/replay/`) and simulated broker (`lib/core/sim/`)
are pure TypeScript with no I/O, so they are tested in isolation and give the
same result every time for the same inputs.

Fill rules are MT5's, hedging mode: buys fill at ask and sells at bid; a long's
stop and target trigger off bid, a short's off ask; pending orders trigger on
the side they would fill on. Jumping forward with positions open processes
every tick in between — nothing is skipped.

The simulator emits the same `Position` shape the Exness statement import
produces (`lib/core/types.ts`), so the journal's statistics — `computeStats`,
`segmentBy`, the leaks ranking, heat taken, Levels — work on backtests with no
second implementation to drift.

Every action is appended to an event log, and an engine snapshot is stored
after each one: resume is instant, and there is an audit trail.

### Integrity: no peeking

The chart is only ever given data up to the replay clock. Drawings are stored
per session and stamped with the replay time they were made at, so jumping
back in time hides the ones made "in the future". Optional blind mode hides
dates and prices.

## File formats (v1)

All integers little-endian. Prices are stored as integers at a fixed number of
decimals per symbol (XAUUSD: 3), parsed straight from the text so no floating
point error is introduced. Files are gzip-compressed as a whole; bodies are
columnar (all times, then all prices, …) because similar numbers next to each
other compress far better.

### Tick day — `LGRT`

| Field | Type | Notes |
|---|---|---|
| magic | 4 bytes | `LGRT` |
| version | u8 | 1 |
| decimals | u8 | price scale |
| reserved | u16 | 0 |
| dayStart | u32 | UTC midnight, epoch seconds |
| count | u32 | ticks |
| times | varint × count | ms since the previous tick (first: since dayStart) |
| bids | zigzag varint × count | change from the previous bid (first: from 0) |
| spreads | zigzag varint × count | change in (ask − bid) from the previous tick |

### Bars — `LGRB`

| Field | Type | Notes |
|---|---|---|
| magic | 4 bytes | `LGRB` |
| version | u8 | 1 |
| decimals | u8 | price scale |
| reserved | u16 | 0 |
| resolution | u32 | seconds per bar (60, 3600, 86400) |
| start | u32 | first bar's open time, epoch seconds |
| count | u32 | bars |
| gaps | varint × count | bars skipped since the previous one (first: 0) |
| opens | zigzag varint × count | change from the previous close (first: from 0) |
| highs | varint × count | high − max(open, close) |
| lows | varint × count | min(open, close) − low |
| closes | zigzag varint × count | close − open |
| volumes | varint × count | tick count |
| spreadAvg | varint × count | mean ask − bid, price units |
| spreadMax | varint × count | widest ask − bid |

Bars are bid prices, like MT5's. Bar times are open times. Day boundaries are
UTC — Exness's MT5 server time — so daily candles match the trader's platform.
Weeks start on Monday; Sunday's evening open belongs to the week that follows.

## Timeframes

1m, 3m, 5m, 10m, 15m, 30m from M1; 1h and 4h from H1 (4h aligned to 00:00
UTC); 1d and 1w from D1; the candle currently forming is always built from
ticks up to the replay clock. Optional 5s, 15s and 30s from ticks.

## Data model

| Table | Holds |
|---|---|
| `market_chunk` | one row per file in R2: symbol, source symbol, resolution, period, rows, first/last time, bytes, sha256, source. Shared; owner-only writes |
| `bt_strategy` | a named idea, the setup it corresponds to in the journal, its rules |
| `bt_session` | a replay run: clock, settings (balance, leverage, costs, spread mode, risk), engine snapshot, chart layout, drawings |
| `bt_event` | append-only action log |
| `bt_position` | closed simulated deals, `Position`-shaped |
| `bt_trade` | an idea grouping positions: R, risk, invalidation, write-up, chart snapshot, screenshots |

Every `bt_*` row is scoped to its user and covered by both isolation suites.

## Milestones

| # | Ships | Done when |
|---|---|---|
| 0 | R2 set up (owner); this document | — |
| 1 | Market data: parser, formats, candles, streaming import worker, signed upload/read routes, IndexedDB cache, coverage calendar | 2015–2026 imported; any day opens from cache in under a second |
| 2 | Chart engine on the drawing kit: touch layer, undo/redo, toolbars, object list; journal chart migrated | All 86 tools usable with mouse and finger |
| 3 | Replay workspace: strategies, sessions, clock, all timeframes, jumps, line/candles, volume, indicators, session boxes, news, resume | Replay any date on laptop and iPhone |
| 4 | Simulated broker: ticket, orders, chart lines, partials, breakeven, trailing, ladders, position tool, costs | Golden-scenario tests pass; trades play out tick-exact |
| 5 | Backtest journal and analytics: write-ups, screenshots, dashboards, R statistics, exit what-ifs, backtest vs live | Owner-only flag removed |
| 6 | Performance, accessibility, upstream contributions | Budgets below met |

## Budgets

| Measure | Target |
|---|---|
| Pan with 5,000 bars and 100 drawings | 60 fps laptop, ≥ 45 fps iPhone |
| Decode a tick day (worker) | < 100 ms |
| First chart | < 1.5 s on 4G, < 300 ms from cache |
| Import | ~1–2 min of processing per year of ticks, resumable |
