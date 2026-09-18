# Design System & Prototype Plan

Supersedes the visual sections of `10-ui-ux.md`. That doc set the direction; this
one sets the parameters, and every colour below has been **run through a
colour-vision validator** rather than chosen by eye.

---

## 1. Design thesis

LogR is a **professional instrument**, not a consumer wellness app. The user is a
high-frequency trader reviewing thousands of decisions. That sets the bar:

> **Calm, dense, and honest.** Nothing decorative. Nothing that implies more
> certainty than the data supports. Every pixel either carries information or
> creates the breathing room that makes information legible.

Four rules that follow:

1. **Restraint over expression.** A financial tool earns trust by looking like it
   respects your attention. No gradients-as-decoration, no glassmorphism, no
   celebratory motion. Depth comes from contrast and hairlines, not shadows.
2. **Density is a feature, applied asymmetrically.** Phone review screens are
   generous and thumb-driven. Desktop analysis tables are dense. These are two
   different densities, not one compromise.
3. **The number is never alone.** Every statistic carries its sample size, and
   estimated values are visually distinct from measured ones.
4. **Colour means exactly one thing.** Two semantic hues (profit, loss), three
   categorical, four reserved status. Nothing else is coloured.

**Reference points:** Linear (restraint, keyboard-first, hairline craft) ·
Stripe Dashboard (best-in-class financial data display) · Whoop/Oura (a composite
score made legitimate by visible drivers) · Copilot Money (dark financial UI on
iOS) · Bloomberg (density done right for professionals).
**Deliberately not:** crypto-app neon, broker-app gamification, dashboard-template
card soup.

---

## 2. Colour — validated, not eyeballed

Dark is the default and gets the design attention; traders sit in dark charts and a
bright journal beside MT5 at night is physically unpleasant.

### Surfaces & ink

| Role | Dark (default) | Light |
|---|---|---|
| Page plane | `#0A0B0D` | `#F7F7F5` |
| Surface 1 (card / chart surface) | `#12141A` | `#FCFCFB` |
| Surface 2 (raised, popovers) | `#191C23` | `#FFFFFF` |
| Hairline border | `rgba(255,255,255,0.08)` | `rgba(11,11,11,0.10)` |
| Text primary | `#F4F5F7` | `#0B0B0B` |
| Text secondary | `#9BA1AC` | `#52514E` |
| Text muted (axes, labels) | `#6B7280` | `#898781` |
| Gridline (hairline) | `#22262E` | `#E1E0D9` |
| Baseline / axis | `#2E333D` | `#C3C2B7` |

### Semantic pair — profit & loss (reserved)

| Role | Dark | Light |
|---|---|---|
| Profit | `#199e70` | `#1baf7a` |
| Loss | `#e66767` | `#e34948` |
| Loss (accessibility mode) | `#d95926` | `#eb6834` |

**Validator results, dark surface `#12141A`, all-pairs:**
- profit ↔ loss: CVD ΔE **6.5** (protan), normal-vision ΔE **27.5**, both ≥3:1 contrast
- 6.5 sits in the 6–8 band, which is **legal only with secondary encoding**

So secondary encoding is **mandatory, not optional**, everywhere the pair appears:

| Context | Secondary encoding |
|---|---|
| P&L bars | position relative to the zero baseline |
| Numeric values | explicit `+` / `−` sign, always |
| Calendar cells | the value printed in the cell |
| Equity curve | single series — no pairing to confuse |

**Accessibility mode** swaps loss to orange: profit `#199e70` ↔ loss `#d95926`
measures CVD ΔE **9.4**, a clean pass with no secondary encoding required. One
toggle in settings. The default keeps the convention traders expect; the toggle
is there because ~8% of men can't reliably separate the default pair.

### Categorical — 3 slots, fixed order, never cycled

For ATR regimes, session buckets, confluence factors. **Deliberately excludes the
semantic hues**, so a chart is never ambiguous about whether colour means
"profitable" or "category 3".

| Slot | Dark | Light |
|---|---|---|
| 1 | `#3987e5` blue | `#2a78d6` |
| 2 | `#c98500` yellow | `#eda100` |
| 3 | `#d55181` magenta | `#e87ba4` |

Validated all-pairs both modes: worst CVD ΔE **13.2** dark / **13.0** light; worst
normal-vision ΔE **19.3** dark / **19.6** light. Light-mode slots 2 and 3 fall
below 3:1 contrast — **relief rule applies**: visible direct labels or a table view
whenever they're used on light.

**Hard rule: a chart uses either the semantic encoding or the categorical palette,
never both.** A fourth category folds into "Other", facets into small multiples, or
switches to a sequential ramp.

### Sequential & diverging

- **Sequential** (single magnitude — MAE distributions, volume): one hue,
  light→dark, blue ramp.
- **Diverging** (the calendar heatmap): profit arm ↔ loss arm with a **neutral grey
  midpoint** (`#22262E` dark / `#F0EFEC` light), equal steps per arm. Never a hue
  at the midpoint. Lightness carries magnitude, hue carries sign, and the printed
  value carries both — three channels, which is why the calendar is safe.

### Status — reserved, never a series colour

`good #0ca30c` · `warning #fab219` · `serious #ec835a` · `critical #d03b3b`
Always shipped with an icon **and** a label. Never colour alone.

---

## 3. Typography

System sans throughout: `system-ui, -apple-system, "Segoe UI", sans-serif`
(or Inter, self-hosted). No display or serif face anywhere.

| Role | Size / weight | Notes |
|---|---|---|
| Hero figure | 40–56px / 600 | **Proportional figures** — a lone big number reads better |
| Section title | 17px / 600 | |
| Body | 15px / 400 | |
| Label | 13px / 500 | |
| Micro (sample size, units) | 11px / 500, `text-muted`, uppercase tracking +0.04em | |
| Table cells, axis ticks | 13px / 400, **`tabular-nums`** | Columns must align vertically |

**Correction to `10-ui-ux.md`**: that doc said tabular figures everywhere. Wrong —
tabular figures belong in *columns*, where alignment matters. Standalone hero
numbers use proportional figures, which are better spaced. Both, correctly placed.

---

## 4. Space, shape, elevation, motion

- **Spacing scale** (4px base): 4 · 8 · 12 · 16 · 24 · 32 · 48 · 64.
  Phone gutter 16px. Card padding 16px phone / 20px desktop.
- **Radius**: 12px cards · 8px controls and chips · 4px on chart data-ends.
- **Elevation**: hairline borders only. **No drop shadows** except on true overlays
  (sheets, popovers), and then a single soft shadow, not a stack.
- **Motion**: 120ms for state changes, 180ms for entrances, `ease-out`. Number
  transitions tween the value, not just opacity. Chart draw-in on first paint only,
  never on re-render. Nothing above 200ms. `prefers-reduced-motion` removes all of it.
- **Touch targets**: 44×44px minimum. Tag chips 32px tall with 44px hit area.

---

## 5. Chart specifications

Following the visualization method, applied to this app's forms:

| Element | Spec |
|---|---|
| Bars | thin, **4px rounded ends anchored to the baseline**, 2px surface gap between adjacent bars |
| Lines | 2px, no shadow, markers ≥8px only where a point is meaningful |
| Overlapping marks | 2px surface-coloured ring |
| Grid | hairline, `gridline` token, horizontal only; no vertical grid on time series |
| Axes | recessive — `text-muted`, no axis line where the baseline already reads |
| Labels | **selective** direct labels (first, last, extremes), never a number on every point |
| Legend | present for ≥2 series; ≤4 series also direct-labelled |
| Hover | crosshair + tooltip on line/area; per-mark tooltip on bars and calendar cells |
| Table view | available on every chart — the accessibility fallback and the trust mechanism |
| **Never** | dual y-axes. Two scales → two charts, or index to a common base |

Price charts use **lightweight-charts**, not a general-purpose library. Candles
drawn by a stats library look wrong to anyone who stares at MT5 all day, and that
credibility gap is fatal.

---

## 6. Screen inventory (phone-first)

Hierarchy rationale is given for each, because *what sits at the top is what the
user optimises for* — the single most consequential design decision in the app.

### Home
```
Execution          78            ← headline: process, not P&L (01-strategy)
this week          B+
─────────────────────────────
+$412  ·  2,280 orders  ·  53.6% ← performance, deliberately secondary
▁▂▅▃▇▆█  withdrawn-profit curve
─────────────────────────────
⚡ One thing
   Spread cost this month: ~$365–730.
   Your broker reports $0.00.        [see →]
─────────────────────────────
◻◻▪◻◻  September calendar
▪◻◻▪◻
─────────────────────────────
14 zone trades to review      [→]
```
Four blocks, in strict priority order: **how you executed → what it produced → the
one thing to act on → the prompt that generates tomorrow's data.**

### Calendar
Month grid, diverging ramp, value printed in each cell. Toggle: P&L / R / execution
grade. Weekly totals rail. Tap a day → that day's blocks and zone trades.

### Zone trade detail
Reconstructed chart (broker M1 bars) with: entry legs, each partial, invalidation,
BE move, MAE/MFE extremes, detected structure, and the post-exit region.
Below: **execution score with its driver rows** (`17-trade-score.md`), legs table,
cost breakdown, tags, notes.

### Review — the most important screen
A card stack of the day's **zone trades** (~15–25), not orders. Per card: chart,
confirm setup, confirm/adjust invalidation, tap confluences. Swipe on. Progress
dots so it visibly ends. One voice note for the day. **Budget: 2 minutes.**

### Analytics
Segment picker (session · ATR regime · setup · confluence · fill depth · time)
above a single chart. Every mark drills through to the underlying trades — a
statistic you can't drill into doesn't get trusted.

### Cost
The spread-cost estimate with its assumption range, cost as a share of the average
winning move, minimum viable target, and the account-type comparison.

### Prop readiness
Retrospective rule check, gauges, Monte Carlo pass probability — and an honest
refusal where the capital model makes the answer unreliable (`16-cost-and-capital.md`).

---

## 7. Interaction patterns

- **Tap-a-level-on-chart** for invalidation — the interaction that makes R possible.
- **Chip grid** for confluences, ordered by that user's own frequency. No dropdowns.
- **Swipe** between trades; never back-out-and-reselect.
- **Long-press** a calendar day for a peek without navigating.
- **Pull-to-refresh** triggers sync, with an honest "last synced 4m ago".
- **Haptics** on tag and level confirm — makes entry feel like an action, not a chore.
- **Keyboard-first on desktop**: `j`/`k` between trades, `1`–`9` for tags, `/` search,
  `⌘K` command palette. A high-frequency user on desktop should never need the mouse.

---

## 8. Prototype build plan

**Goal:** settle the visual direction and *time the review flow* before any backend.
It answers three questions a document cannot: is 2 minutes real, does an execution
score at the top feel motivating or preachy, does the calendar pull you in.

**Scope — one self-contained HTML page, no backend:**

| Build | Skip |
|---|---|
| Home, Calendar, Zone-trade detail, Review flow, Cost screen | Auth, settings, analytics depth |
| Realistic synthetic XAUUSD data at ~$4,300–4,400, ~0.02 lots, layered entries, partial exits, ~20 zone trades/day over ~30 days | Real import, real sync |
| Working execution score with driver rows | Score tuning UI |
| Reconstructed trade chart with markers, from generated M1 bars | lightweight-charts (inline SVG is enough to judge layout) |
| Full token system, both themes, validated palette | Light-mode polish |
| Real swipe/tap interactions in the review flow, **timed** | Persistence |

**Data generator requirements** — fake data that looks wrong to a gold trader
destroys the prototype's purpose:
- gold ~$4,300–4,400 with realistic intraday range for the current regime
- zone clusters: 3–5 layered entries within a price band, 2–3 partial exits, a runner
- win rate ~54%, profit factor ~1.5, average win ≈ 1.3× average loss
- spread $0.15–0.35, widening around the session open and news
- a few high-ATR days and a few quiet ones, so regime segmentation has something to show

**Success test:** open it on a phone, run the review flow for one simulated day,
and time it. Under two minutes → the design works. Over → cut inputs until it isn't.
