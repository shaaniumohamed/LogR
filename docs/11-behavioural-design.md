# Behavioural Design — the daily loop, intervention, and accountability

The analytics are retrospective. This document is about the parts of the product
that operate *while you are still able to change the outcome*, and about the loop
that keeps data flowing in.

---

## 1. The daily loop — exactly when the app speaks

A journal that only exists when you open it will be opened less and less.
A journal that pesters you gets muted. The loop has to be small, predictable, and
weighted toward the moments where information changes a decision.

| When | Surface | Content | Why here |
|---|---|---|---|
| Pre-session (−30m) | Push, optional | Yesterday's one lesson + today's rules + high-impact news times | Priming beats review. The rule you read at 07:30 is the one you follow at 09:15 |
| **In session** | Push, protective only | See §2 | The only moment where a message can prevent a loss rather than describe one |
| Post-session | Push | "3 trades to review — 40 seconds" with the actual count | The data-collection prompt. Specific and small, never "don't forget to journal!" |
| Evening | In-app | The review flow | Where R, tags and invalidation levels come from |
| Sunday | Email + in-app | Weekly digest: what changed, one experiment for next week | Reflection at a distance, when no position is open |
| Monthly | Email | Playbook report card, cost report, risk-model coverage | Long enough horizon for sample size to mean something |

**Rules for every notification:**
- It carries a number, or it doesn't get sent.
- It never encourages a trade. Ever.
- Everything except protective in-session alerts is individually switch-off-able,
  and the app works fully with all of them off.

---

## 2. In-session intervention — the highest-value thing this app can do

With the read-only bridge polling every ~30s, LogR knows, live: trade count today,
realised and floating P&L, whether an open position has no stop, minutes since the
last loss, current size vs your normal size, current equity against your daily
loss limit. For an intraday phone trader, a well-timed sentence is worth more than
any monthly report.

The distinction that keeps this ethical and useful:

> **An alert that stops an action is legitimate. An alert that prompts an action is not.**

Everything below is the first kind.

### Interventions worth building, ranked

**1. Personal tilt threshold** — computed from your own history, not a generic rule.
> *"This is trade 4. Your expectancy on trades 1–3 is +0.34R. On trade 4 and
> beyond it's −0.41R across 140 trades. You've made £680 today."*

This is the single most valuable notification in the product. It's true, it's
derived from your own data, and it can only land in-session. Most intraday traders
have a hard per-day trade count past which they are net negative, and almost none
of them know what their number is.

**2. Behavioural tilt detection (measured, not self-reported)**
Fires on the *pattern*, not the feeling:
- re-entry within N minutes of a loss (N from your own distribution)
- size increase after a loss — the clearest single tilt signal in trading data
- symbol outside your usual set
- trading outside your usual hours
- trade count above your 90-day p90

> *"Your last trade was 2.4x your average size, 3 minutes after a loss. The last
> 11 times you did that: −£1,830."*

**3. Naked position warning** — you often run without a platform stop by design,
so this must be smart rather than nagging. Only fires when position is open beyond
your usual hold time *and* floating loss exceeds your typical MAE:
> *"US30 has been open 47m (your average is 12m) and is −£210 against you, past
> your usual worst excursion. Is the idea still valid?"*

That is the mental-stop trader's actual failure mode: not the absence of a stop,
but **losing track of the invalidation while watching something else.**

**4. Daily loss limit proximity** — hard requirement once a prop challenge is live.
Fires at 60% / 80% of limit, and at 80% it states the consequence in account terms.

**5. Invalidation level breach** — if you logged an invalidation pre-trade and price
has gone through it while the position is still open, say so once. This is the
whole point of recording the level.

### Escalation policy
Warn → require acknowledgement → (only if the user explicitly arms it) lock the
journal's "log a trade" flow and show a cooldown timer. LogR cannot and should not
block MT5 from a phone — but making the journal itself refuse to proceed is a real
speed bump, and the user chose it in advance when calm.

**Defaults are conservative: warn only.** Nothing escalates unless armed.

---

## 3. Accountability group (fits "me + a few trader friends" exactly)

A small private group. The deliberate design choice:

> **Members see each other's discipline grades, streaks and rule breaks.
> Nobody ever sees anybody's P&L.**

Why that split:
- P&L sharing creates comparison, envy, and size escalation to keep up. It is the
  mechanism by which trading communities make their members worse.
- Process sharing creates exactly the pressure you want: it is uncomfortable to
  report a D when three friends reported A's, and the way to fix it is to follow
  your own rules.

Features: a weekly group digest (grades, rule-break counts, review streaks), the
ability to share a single trade for feedback (opt-in, per trade), and a "call me
out" flag where a nominated friend gets notified if you break a specific rule.

This also happens to be the cheapest real growth mechanism the product has — and
it grows on the right axis.

---

## 4. Gamification — what to use and what to refuse

Reward mechanics are powerful enough that pointing them at the wrong target does
measurable financial harm. The rule: **reward only what is under your control.**

| Build | Refuse | Reason |
|---|---|---|
| Review-completed streak | Win streak | You control whether you review. You don't control whether you win |
| Zero-rule-break streak | Profit target badges | Rule adherence is a skill; profit is an outcome |
| "Every trade tagged" streak | Days-traded streak | Not trading is often the correct action — never punish it |
| Personal bests on *process* metrics | Leaderboards by return | Comparison on returns drives size escalation |
| Grade improvement over time | Celebration animations on big wins | Celebrating outliers rewards variance-seeking |

Streak forgiveness matters: one missed day should not reset a 60-day streak, or
the mechanic turns into an anxiety generator that people escape by uninstalling.
Use a "freeze" allowance — a couple of skipped days per month absorbed silently.

---

## 5. Honesty features — the journal as a check on self-deception

A journal you can lie to is a journal that tells you what you want to hear.
Lightweight, non-accusatory checks:

- **Tag drift**: if trades tagged "followed plan" have systematically worse
  outcomes than untagged ones, flag it gently. Usually it means the plan is the
  problem, not the tagging — either way it's worth surfacing.
- **Retro-fitting detection**: an invalidation level tapped *after* seeing the
  outcome is less reliable than one logged before entry. Store which it was, weight
  the stats accordingly, and show pre-logged coverage as a quality metric.
- **Survivorship in playbooks**: if a playbook's trades are mostly tagged after the
  fact, say the sample is contaminated rather than reporting a clean expectancy.
- **Sample-size gates everywhere**: no conclusion rendered below N, full stop.

None of these scold. They all say the same thing: *here is how much to trust this
number.*

---

## 6. First-run experience

The first five minutes decide whether this becomes a habit.

1. **Land on a live demo.** Realistic CFD data, full dashboard, no signup. The
   product explains itself by being used.
2. **"Import your history"** → Exness CSV drag-drop → parse client-side →
   **reconciliation screen** showing net P&L next to what their statement says.
   Matching to the cent is the trust moment; treat it as the hero, not a detail.
3. **Instant payoff, before any configuration.** From backfilled data alone we can
   already compute: best/worst session, best/worst symbol, trade-number-of-day
   tilt curve, cost ratio, hold-time asymmetry. Show three findings immediately —
   *"most of your profit comes from London; you gave back 40% of it after 11:00"*.
   This is the moment the user decides whether to come back.
4. **Then, and only then**, ask for the email-forwarding rule (one generated filter
   to click) and optionally the investor password.
5. Rules, playbooks and prop settings come later, prompted in context, never as a
   setup wizard. Nobody configures a journal before they believe in it.
