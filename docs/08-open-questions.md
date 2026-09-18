# Open Questions — decisions needed before design starts

Each of these changes what gets built. Grouped by how much they change.

## A. Blocking-ish (changes M2 substantially)

**A1. Where does your MT5 terminal run?**
- Windows PC that's on during the session → EA works, gaps when the PC sleeps
- **VPS running 24/7 → ideal**; EA never misses a fill, and the risk-guard becomes viable
- Mac → MT5 runs under Wine/Parallels; EA still works, a Python agent would not
- Phone only → EA is impossible; MetaApi or manual import are the only paths

**A2. Who is this for?**
- Just you (personal tool) → skip billing, skip multi-tenant polish, ship faster,
  keep the schema multi-tenant anyway so the option stays open
- You + friends → add auth hardening and quotas
- A real product → add Stripe, onboarding, support surface, and a legal page from day one

**A3. Broker + account shape.** Which broker(s), and is the account **netting or
hedging**? This directly changes the derivation logic (see `03-mt5-integration.md` §3.2).
Fastest way to answer: export a statement now and drop it in `/fixtures` — real
data beats any amount of planning here.

**A4. Prop firm accounts?** If yes, the challenge tracker moves from Tier 2 to
Tier 0 — it becomes the reason you open the app daily, and the roadmap reorders.

## B. Shapes the analytics

**B1. Do you set a hard stop on every trade?**
If yes → R works everywhere, expectancy is real, MAE/MFE is powerful.
If no (mental stops) → we need a per-trade risk-entry flow, and "no stop" becomes
the first auto-detected mistake with a cost attached.

**B2. Typical hold time?** Intraday scalps → session/hour analytics and tilt
detection dominate. Multi-day swings → swap/carry costs and correlation exposure
dominate. Drives which Tier-1 features come first.

**B3. Do you scale in/out?** If yes, the trade-grouping layer and per-leg R
matter a lot more, and partial-close handling needs to be right in M1 rather than M3.

**B4. How much history do you want back-loaded?** Statements are usually available
for the life of the account. Anything before EA install has no initial-SL data —
so old trades get dollar stats but estimated R, clearly flagged.

## C. Product / scope

**C1. Manual logging for non-MT5 trades?** (Crypto exchange, spread bet account,
another platform.) Cheap to add a manual entry form; decides whether `platform`
= 'manual' is a first-class path in M1.

**C2. Mobile priority.** PWA is the plan. Is on-the-go journaling (voice note
after a session, from your phone) important enough to pull forward from M4?

**C3. What do you want on the dashboard headline?** My strong recommendation is
the **discipline grade**, with P&L secondary — the top-left number is what you
will optimise for, and optimising for daily P&L is how traders blow up. Worth
disagreeing with explicitly if you disagree.

**C4. AI budget.** LLM features (weekly narrative, note search, chat-with-data)
cost per call. Fine for one user, needs metering for many.

## D. Things I'd want to test early (cheap experiments, big information)

1. **Drop a real statement into a throwaway parser** → confirms the HTML shape for
   your specific broker before any schema is committed.
2. **Hello-world EA `WebRequest`** to a dummy endpoint → confirms the whitelist
   flow and measures how painful the onboarding really is. If this is awful, the
   whole M2 plan changes and we reach for MetaApi instead.
3. **Hand-build the calendar view from a CSV** → does the heatmap actually create
   the pull it's supposed to? Costs a day, validates the core hook.
