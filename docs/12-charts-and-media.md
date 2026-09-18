# Charts & Media — visual journaling without an Expert Advisor

Screenshotting is the #2 reason people abandon trade journals (manual data entry
is #1). The original plan solved it with `ChartScreenShot()` in an EA. With no
desktop terminal, that's gone — so this has to be solved differently, and the
replacement turns out to be better.

## 1. Reconstructed charts beat screenshots

The read-only bridge can pull M1/M5 bars for any window
(`copy_rates_range(symbol, TIMEFRAME_M1, from, to)`) **from your broker's own feed**
— which for CFDs is the only price series that matches your actual fills, since
US30 on Exness is not US30 anywhere else.

Store those bars and render the trade with lightweight-charts, marked up with:
entry fills (each leg), exits (each partial), the invalidation level, the
breakeven move, MAE and MFE extremes, and the "what happened after you left"
region extending past your exit.

**Why this is better than a screenshot, not just a substitute:**

| Screenshot | Reconstructed chart |
|---|---|
| One timeframe, whatever you had open | Any timeframe, switchable |
| Fixed zoom and window | Pan, zoom, extend |
| Only exists if you remembered | Exists for **every** trade, automatically, retroactively |
| Can't show what happened after | Shows exactly what happened after you exited |
| Nothing computable from it | MAE/MFE, runner analysis and BE-cost are all computed from these same bars |

It also works **backwards**: connect the bridge today and we can pull bars for
trades you closed months ago and reconstruct charts you never took.

Storage: M1 bars around trades only (not continuous history) — roughly
`(hold_time + padding) × symbols` rows per trade, which is trivial. Don't store a
full tick history; the value is in the trade window.

## 2. Your own annotated screenshots — the capture path depends on your phone

You'll still want to attach your own marked-up TradingView charts sometimes. The
frictionless path is platform-dependent, and this is worth knowing before we build:

**Android (installed PWA)** — clean. Register LogR as a [share target](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/share_target)
in the web manifest:
```json
"share_target": {
  "action": "/share",
  "method": "POST",
  "enctype": "multipart/form-data",
  "params": { "files": [{ "name": "image", "accept": ["image/*"] }] }
}
```
Then it's: screenshot in TradingView → Share → LogR → auto-attached to your most
recent trade. Two taps, no app switch.

**iOS** — [not supported](https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide).
Safari still doesn't let a PWA register as a share target in 2026. Workarounds,
best first:
1. **An iOS Shortcut** that appears in the share sheet and POSTs the image to our
   API with the user's key. Genuinely two taps, needs a one-time install of a
   shortcut we provide. Best available option.
2. **Paste-from-clipboard** — copy the screenshot, one tap to paste in the review
   flow. Reliable, slightly clunkier.
3. Standard file picker — the fallback nobody enjoys.

If the answer is iOS, the reconstructed charts carry proportionally more weight,
because the manual path will always have friction there.

## 3. Voice notes

For a phone-first journal this matters more than typing. `MediaRecorder` in the
PWA, upload to blob, transcribe (Whisper or equivalent), store both audio and
transcript. The transcript makes it **searchable and analysable** — which is the
real prize:

> *"Trades where you mentioned feeling 'rushed' or 'behind': 23 trades,
> expectancy −0.52R. Trades where you mentioned 'waited': 41 trades, +0.38R."*

That is emotional-state analysis with zero mood sliders, built from something you
were willing to do anyway. Mood sliders get filled in dishonestly or not at all;
a 30-second voice ramble after a session is a thing people actually sustain.

## 4. Chart styling credibility

Non-obvious but important: candles have to look right. Anyone who stares at MT5
all day will instantly reject charts drawn with a generic charting library — wrong
wick weights, wrong body proportions, wrong gridlines. Use lightweight-charts
(TradingView's own) for anything price-shaped, and Recharts only for statistics.
The credibility cost of getting this wrong is out of all proportion to the effort
of getting it right.

## 5. What we cannot get, and how to say so

Being explicit beats silently degrading:

| Not available | Consequence | How the UI handles it |
|---|---|---|
| Initial SL on trades before the bridge connects | R is estimated for old trades | `risk_source` badge; R shown in a muted style; offer the tap-to-set-invalidation flow to upgrade it |
| Tick-level data | MAE/MFE accurate to M1, not to the tick | State the resolution next to the number |
| Your screen at the moment of entry | No record of what you were actually looking at | Reconstructed chart + your note; optional manual screenshot |
| Why you entered | Unknowable without you | This is what the review flow is for — it's the one thing only you can supply |

The last row is the point of the whole product: automate everything a machine can
know, so the only thing asked of you is the thing only you know.
