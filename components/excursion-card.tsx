import type { Excursion } from "@/lib/core/excursion";
import { keptShare } from "@/lib/core/excursion";
import { Info } from "@/components/info";
import { money } from "@/components/ui";

/**
 * How the trade moved while you were in it.
 *
 * Three numbers and the shape between them. The sentence picks the one thing
 * about this particular path that is worth knowing — a winner that survived
 * heavy heat, a loser that was green first, a winner given most of the way
 * back — because those are the trades that teach something, and a row of
 * figures leaves the reader to find which one it is.
 */
export function ExcursionCard({ x }: { x: Excursion }) {
  const kept = keptShare(x);
  const sentence =
    x.final < 0 && x.best > Math.abs(x.final) * 0.3 && x.best >= 5
      ? `It was up ${money(x.best)} before it turned. You closed it ${money(x.final)}.`
      : x.final > 0 && kept !== null && kept < 0.5 && x.best >= 5
        ? `You kept ${Math.round(kept * 100)}% of the best it got — it was up ${money(x.best)} at one point.`
        : x.final > 0 && Math.abs(x.heat) > x.final
          ? `It went ${money(x.heat)} against you before it worked.`
          : x.final < 0
            ? `It never got far in your favour — the best it reached was ${money(x.best)}.`
            : `It went your way and you held on to most of it.`;

  return (
    <section className="card p-5">
      <h2 className="eyebrow">How it moved while you were in</h2>
      <p className="mt-2 text-[15px] leading-relaxed">{sentence}</p>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <Tile label="Heat taken" value={money(x.heat)} tone="neg" sub="at least" />
        <Tile label="Best it got" value={x.best > 0 ? `+${money(x.best)}` : money(0)} tone="pos" sub="at least" />
        <Tile label="Closed at" value={money(x.final)} tone={x.final >= 0 ? "pos" : "neg"} />
      </div>

      <RunningBand x={x} />

      <Info title="How this is measured">
        From the one-minute candles and your own fills, with the size you actually held at each
        minute: a ladder counts only the entries filled so far, and a partial you took out is
        banked and stops moving with price. That is why this can differ from simply asking how
        far price moved against your average entry.
        <br /><br />
        Both figures are floors. A one-minute candle cannot say whether its low came before or
        after your fill, so in the minute you entered only prices from your fill onwards are
        counted, and in the minute you left only prices up to your exit. The heat you really
        took was at least this much — never less, and never invented.
      </Info>
    </section>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone: "pos" | "neg" }) {
  return (
    <div className="tile rounded-xl px-3 py-2.5">
      <div className="text-[11.5px] font-medium" style={{ color: "var(--ink2)" }}>{label}</div>
      <div className={`num mt-0.5 text-[17px] font-semibold tracking-tight ${tone}`}>{value}</div>
      {sub && <div className="text-[11px]" style={{ color: "var(--ink3)" }}>{sub}</div>}
    </div>
  );
}

/**
 * The running result as a band: the low edge is the worst price each minute,
 * the high edge the best. Green above the zero line, red below, so "how long
 * was I underwater" is a glance rather than a calculation.
 */
function RunningBand({ x }: { x: Excursion }) {
  const p = x.path;
  if (p.length < 2) return null;
  const W = 600, H = 120, P = 6;
  const min = Math.min(0, x.heat), max = Math.max(0, x.best);
  const X = (i: number) => (i / (p.length - 1)) * W;
  const Y = (v: number) => P + (1 - (v - min) / (max - min || 1)) * (H - 2 * P);
  const zero = Y(0);

  const upper = p.map((q, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(q.hi).toFixed(1)}`).join(" ");
  const lower = [...p].reverse().map((q, i) => `L${X(p.length - 1 - i).toFixed(1)} ${Y(q.lo).toFixed(1)}`).join(" ");
  const band = `${upper} ${lower} Z`;
  const mid = p.map((q, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y((q.lo + q.hi) / 2).toFixed(1)}`).join(" ");

  return (
    <div className="mt-4">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block w-full" style={{ height: H }}
           role="img" aria-label={`Running result from ${money(x.heat)} to ${money(x.best)}, closing at ${money(x.final)}`}>
        <defs>
          <clipPath id="above"><rect x={0} y={0} width={W} height={zero} /></clipPath>
          <clipPath id="below"><rect x={0} y={zero} width={W} height={H - zero} /></clipPath>
        </defs>
        <path d={band} fill="var(--profit)" opacity={0.22} clipPath="url(#above)" />
        <path d={band} fill="var(--loss)" opacity={0.22} clipPath="url(#below)" />
        <path d={mid} fill="none" stroke="var(--ink2)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        <line x1={0} x2={W} y1={zero} y2={zero} stroke="var(--ink3)" strokeDasharray="3 4" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="mt-1 flex justify-between text-[11.5px]" style={{ color: "var(--ink3)" }}>
        <span>Entry</span>
        <span>Running result, worst to best each minute</span>
        <span>Exit</span>
      </div>
    </div>
  );
}
