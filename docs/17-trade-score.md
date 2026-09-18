# Trade Score — worth building, but not the way most apps build it

## 1. Why most trade scores fail

The pattern in existing journals (TradeZella's Zella Score is the best-known) is a
composite of **outcome** metrics — win rate, profit factor, average win/loss,
recovery factor, max drawdown, consistency — rendered as a radar chart and a number
out of 100.

It's attractive and it's mostly a marketing artifact. Four concrete problems:

**1. It grades luck.** Any score containing P&L rewards outcomes the trader didn't
control. A perfectly executed trade that lost scores badly; a reckless trade that
won scores well. Repeated a few hundred times, that teaches exactly the wrong
lesson — and at 100 trades a day, "a few hundred times" is a week.

**2. It destroys the diagnostic.** "Your score is 72" is not actionable. The entire
value of this product is specificity — *which* habit, *how much* it costs. A
composite compresses that away and then the user has to go find it again.

**3. The weights are arbitrary.** Why is profit factor 20% and consistency 15%?
There's no principled answer. It's a value judgement wearing a lab coat, and
different weightings would rank the same trader differently.

**4. It's gameable, and people game it.** Whatever the score rewards, behaviour
drifts toward. A score that rewards win rate produces traders who cut winners and
hold losers, which is *precisely* the habit that kills accounts.

## 2. What to build instead: an Execution Score

> **Grade the decision, not the result. The score must be computable before you
> know whether the trade won.**

That single constraint fixes all four problems. It is also the same principle
already governing the dashboard headline (`01-strategy.md`) and the discipline
grade (`02-features.md` §2.1) — this is that idea applied per trade.

**A losing trade can score 100. A winning trade can score 40.** If that ever feels
wrong, the score is working and the instinct is the thing to fix.

### Components (per zone trade)

Each is derived from data the app already has — declared rules, auto-detected
structure (`15-methodology.md`), and the fill record. Nothing here needs the outcome.

| # | Component | Question | Source |
|---|---|---|---|
| 1 | **Setup validity** | Were the required confluences actually present? | auto-detected + tags |
| 2 | **Zone discipline** | Did entries fall inside the declared zone, or chase outside it? | fills vs zone bounds |
| 3 | **Size discipline** | Total risk within the declared max? Ladder within planned size? | fills vs rules |
| 4 | **Invalidation honoured** | Did you exit at or before invalidation? | exit vs invalidation level |
| 5 | **Target discipline** | Partials at planned levels, or improvised? | exits vs structural targets |
| 6 | **Breakeven timing** | Runner moved to BE per the rule, or prematurely? | BE event vs rule trigger |
| 7 | **Context compliance** | Allowed session, outside the news window, within daily count? | timestamps + calendar |

Weighted → 0–100. Weights are **user-editable with sensible defaults**, and the UI
states them, because an opaque weighting is the arbitrary-weights problem again.

### Presentation: score plus drivers, never score alone
Borrow the pattern that makes recovery scores work in fitness wearables — a
headline number is only useful when the **inputs are visible and each one is
something you control**:

```
Execution 78 / 100                          ← headline
  ✓ Setup validity        20/20
  ✓ Zone discipline       15/15
  ⚠ Size discipline       10/20   layer 3 took total risk to 1.8× your max
  ✓ Invalidation          15/15
  ⚠ Target discipline      8/15   partial at 0.4R, structural target was 2.1R
  ✗ Breakeven timing       0/10   moved to BE before price cleared the zone
  ✓ Context               10/10
```

Every deduction names the rule and the evidence. The number is the entry point;
the rows are the product.

## 3. The feature that justifies the whole thing

Once execution is scored **independently of outcome**, the two can be correlated —
and that is a falsifiable test of the trader's own methodology:

> **Plot execution score against R. Do high-scoring trades actually perform better?**

| Result | Meaning | Action |
|---|---|---|
| Strong positive relationship | The rules capture real edge. Adherence is the whole game | Focus entirely on discipline |
| Flat | **Following your rules doesn't help.** The rules aren't capturing the edge | Revise the rules, not the discipline |
| Negative | A scored component is actively harmful | Find it via per-component correlation |

Almost no journal can do this, because almost every journal's score already
contains the outcome — correlating it with the outcome would be circular.

Then go one level down: **correlate each component with R separately.** That tells
you which rules earn their place, and it pairs exactly with the confluence
marginal-value analysis in `15-methodology.md`:

> *"Invalidation discipline: +0.31R when honoured (n=740). Breakeven timing: no
> measurable relationship to outcome (n=610) — this rule may not be worth the
> cognitive load."*

A scoring system that can tell you one of its own rules is worthless is a
scoring system worth trusting.

## 4. Aggregation

- **Per zone trade** → Execution Score (0–100)
- **Per day** → volume-weighted mean, mapped to the A–F discipline grade
- **Per week / month** → trend, plus per-component breakdown showing what's
  improving and what's decaying
- **Per setup** → mean execution score, to catch a setup you systematically
  execute worse than you think

Guard: never average a score over fewer than N trades without showing N. At 100
trades a day this is rarely binding, which is one more way high frequency helps.

## 5. Explicitly out of scope for the score

P&L · win rate · profit factor · R achieved · drawdown · anything else the trader
did not choose. Those all live on the performance side of the app, clearly
separated. **Two panels, never blended into one number.**

## 6. What's worth borrowing from other tools

| Source | Worth taking | Worth avoiding |
|---|---|---|
| TradeZella | Calendar heatmap; playbooks as first-class objects | Zella Score's outcome contamination |
| Tradervue | Restraint — clean lists, fast tagging, share-a-trade for feedback | Dated UI; thin analytics |
| Edgewonk | Entry/exit **efficiency** metrics; a tilt meter | Overwhelming density; everything at once |
| TraderSync | Broad broker sync; structured mistake taxonomy | Generic insights that don't cite sample size |
| Chartlog | Visual polish; genuinely modern feel | Shallow analytics |
| **Whoop / Oura** | Composite score **with visible, controllable drivers** — the pattern that makes a single number legitimate | Score anxiety; daily judgement fatigue |
| **Duolingo** | Streak freezes so one missed day doesn't erase months | Aggressive guilt-based notifications |
| **Strava** | Segments — comparing like-for-like efforts. The analogue is comparing trades of the same setup | Public leaderboards on outcomes |
| **Grammarly** | Score paired with the exact list of specific fixes | — |

The Whoop/Oura comparison is the instructive one. A recovery score works because
it's computed from objective inputs, it predicts something you care about, and the
drivers are visible and controllable. A trade score that meets those three tests is
legitimate. One that doesn't is decoration.
