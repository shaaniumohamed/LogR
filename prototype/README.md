# Prototype

`logr.html` — a single self-contained page, no backend. Open it in a browser
(phone width, ~412px, is the design target).

**All data is synthetic.** It is generated at load time from a seeded PRNG, tuned
to the shape of a high-frequency XAUUSD account, and no real account data is used
or committed (see the data-handling rule in the root README).

## Generated dataset

| | |
|---|---|
| Period | 30 days, ~20 active trading days |
| Zone trades | ~375 (~19/day) |
| Orders | ~1,570 (~78/day) |
| Win rate | ~53% |
| Profit factor | ~1.54 |
| Payoff ratio | ~1.38 |
| Spread cost | ~48% of net profit — and reported as $0.00, which is the point |
| Execution score | mean ~81, p10 68, p90 93 — spread across C to A |

The generator deliberately encodes one finding so the analytics have something
true to surface: **full-ladder fills return ≈ −0.04R against ≈ +0.29R for partial
fills**, i.e. a fill that runs the whole zone means price disrespected it.

## What it covers

- **Home** — execution score as the headline, P&L secondary, one rotating insight,
  calendar, review prompt
- **Calendar** — diverging ramp, value printed in every cell, toggle P&L / R / execution
- **Day → zone trades** — clustered layers, not raw orders
- **Trade detail** — reconstructed chart (entries, partials, zone, invalidation,
  target, post-exit region), execution score with driver rows, legs, cost
- **Review** — the critical flow. Tap the chart to set invalidation, confirm setup
  and confluences, swipe on. Timed against the 2-minute budget
- **Cost** — the $0.00 vs actual comparison, cost as a share of the winning move,
  account-type arithmetic, minimum viable target
- **Settings** — colour-safe profit/loss toggle

## Deliberately out of scope

Auth, persistence, real import or sync, deep analytics, lightweight-charts
(inline SVG is enough to judge layout), light-mode polish.

## Design notes

Every colour was run through a colour-vision validator rather than chosen by eye
(`../docs/18-design-system.md`). The profit/loss pair sits in the band where hue
alone is insufficient, so secondary encoding is mandatory throughout: signed
values, zero baselines, and the value printed in every calendar cell.

Candles are drawn in neutral grey on purpose — **the chart is context, the trade
is the subject** — so colour is reserved for the annotations that matter.

## The success test

Open the review flow on a phone, run one day, and time it. Under two minutes means
the design works at ~100 orders/day. Over means cut inputs until it does.
