# UI / UX Direction

Stated requirement: *"making the ui easy ... the ui should also be beautiful"*.
That is a functional requirement, not decoration — an ugly or fiddly journal does
not get opened, and a journal that does not get opened has no data, and a journal
with no data has no insights. UI quality is upstream of the entire value chain.

## Non-negotiables

1. **Phone-first, genuinely.** Not "responsive desktop". The primary session is
   *evening, on a phone, thumb-reachable, one-handed, five minutes*. Desktop is the
   secondary surface for deep analysis. Design the phone layout first and let the
   desktop view be the expansion.
2. **Never a blank state.** A fresh account shows a real demo dataset with a
   "this is sample data" banner, so the product is legible before any import.
3. **Two-tap rule.** Any single trade's full detail — chart, notes, tags,
   invalidation, playbook — is at most two taps from the home screen.
4. **The daily review is one screen, not a form.** Swipe through today's trades,
   tapping a level and a tag on each. Target: **under 45 seconds for a trading day.**
5. **Numbers never lie by omission.** Sample size next to every statistic;
   estimated values visually distinct from measured ones.

## Visual direction

Dark-first — traders live in dark charts and a bright journal is physically
jarring next to MT5 at night. Light theme exists, but dark is the default and gets
the design attention.

- **Surface:** near-black base (`#0A0B0D`), elevated cards a step lighter, hairline
  borders rather than heavy shadows. Depth from contrast, not drop-shadow.
- **Type:** one geometric sans for UI (Inter / Geist), **tabular figures everywhere
  numbers appear** — misaligned digits in a P&L column look broken, and this is
  a one-line CSS fix that 90% of dashboards miss.
- **Colour discipline:** exactly two semantic colours — profit and loss. Everything
  else is neutral. A dashboard where six things are coloured communicates nothing.
  Use a colourblind-safe pair (teal/amber) rather than red/green, with an option
  to switch, since ~8% of men have red-green deficiency and this is a numbers app.
- **Motion:** only where it conveys state — number transitions, chart draw-in,
  sheet slides. No decorative animation, nothing above ~200ms.
- **Density:** generous on mobile, dense on desktop tables. Two different densities,
  not one compromise.

## Screen inventory

### Home (phone)
```
┌─────────────────────────────┐
│  Discipline    B+           │   ← the headline. Process, not P&L.
│  this week     4 rule breaks│
├─────────────────────────────┤
│  +£412   this week          │   ← P&L, deliberately secondary
│  ▁▂▅▃▇▆█  equity sparkline  │
├─────────────────────────────┤
│  📌  One thing              │   ← rotating auto-insight, always present
│  Your runners returned      │
│  −0.08R over 87 trades.     │
│                    [see →]  │
├─────────────────────────────┤
│  ◻◻▪◻◻  September           │   ← calendar heatmap, tappable
│  ▪◻◻▪◻                      │
├─────────────────────────────┤
│  3 trades need review   [→] │   ← the nudge that produces data
└─────────────────────────────┘
```

### Calendar
Month grid, one cell per day. Toggle colour by **P&L / R / discipline grade** —
the discipline view is the one that changes behaviour. Weekly totals in a rail.
Tap a day → that day's trades, notes and grade.

### Trade detail
Chart with entry, exit(s), invalidation and BE-move marked on it, from the broker's
own M1 bars. Below: the legs (each fill, each partial), costs broken out, tags,
notes, playbook, and — where relevant — "what happened after you left" as a second
chart region.

### Review (the most important screen in the app)
A card stack of today's trades. For each: chart, and two inputs —
**tap the invalidation level** and **tap any mistake tags**. Swipe to the next.
A progress dots row so it visibly ends. Then one free-text or voice prompt for the
day. Nothing else. This screen is the entire data-collection strategy.

### Analytics
Segment picker at the top (symbol / session / hour / playbook / tag / trade-number-of-day),
metric below. Every chart click-through goes to the underlying trade list —
a statistic you can't drill into isn't trusted.

### Prop challenge
Gauges: daily loss used, total DD headroom, profit progress, consistency, trading
days. Plus Monte Carlo pass probability from your own R-distribution.
This screen gets checked multiple times a day during a challenge — it should be
reachable from the home screen in one tap and load instantly.

## Interaction details worth getting right

- **Tap-a-level-on-chart** for invalidation, instead of typing a price. The single
  highest-leverage interaction in the app — it's the difference between R existing
  and not existing for this trader.
- **Tag chips with one-tap toggle**, most-used first, ordered by that user's own
  frequency. No dropdowns, ever.
- **Swipe between trades**, not a back-and-forth to a list.
- **Voice note** on the day review — a 30s ramble beats a typed paragraph that
  never gets written, and transcription makes it searchable later.
- **Pull-to-refresh triggers a sync**, with an honest "last synced 4m ago".
- **Haptics** on tag and level confirm. Small, but it makes data entry feel like
  an action rather than a chore.

## Build approach

Tailwind + shadcn/ui as the base, then **deliberately restyled** — default shadcn
is recognisable and reads as a template. Custom tokens for surface/profit/loss,
custom chart theming, and one distinctive element (the calendar heatmap) designed
properly rather than assembled from primitives.

Charts: Recharts for statistics, **lightweight-charts** for anything price-shaped.
Do not render candles in a general-purpose chart library — it looks wrong to
anyone who stares at MT5 all day, and that credibility gap is fatal for a trading
app.

## Prototype-first

The next concrete step should be a **clickable high-fidelity prototype with
realistic fake CFD data** — home, calendar, trade detail, review flow — before any
backend work. It costs a fraction of building it and it is the only way to find out
whether the review flow is actually under 45 seconds.
