import Link from "next/link";

/**
 * Chart primitives.
 *
 * Bars are HTML, not SVG, on purpose. An SVG with a fixed viewBox scales its
 * text with the container, so the same chart renders with huge type on a desktop
 * and unreadable type on a phone — and positioning a value label relative to a
 * bar's end makes it collide with the category label whenever the bar is long.
 * Laying the row out as three fixed columns (label · track · value) removes both
 * problems, keeps the text real and selectable, and makes the numbers line up
 * vertically so they can actually be compared.
 *
 * Rules kept throughout (docs/18, docs/19): one scale; profit/loss colour always
 * reinforced by a sign and a printed value, never carried by hue alone; sample
 * size in plain words; the zero baseline the strongest line in the drawing.
 */

export interface BarRow {
  label: string;
  value: number;
  /** Shown verbatim under the label, e.g. "61 trades · won 43%". */
  meta?: string;
  flag?: boolean;
  /**
   * Where this bar's trades live.
   *
   * A finding you cannot open is a dead end: the chart says your FOMO trades
   * cost you four hundred dollars and there is no way to go and read them. Every
   * bar that stands for a group of trades should be the door to that group.
   */
  href?: string;
}

export function BarChart({ rows, format }: { rows: BarRow[]; format: (v: number) => string }) {
  if (rows.length === 0) return null;
  const max = Math.max(...rows.map((r) => Math.abs(r.value)), 0.0001);
  const anyNegative = rows.some((r) => r.value < 0);
  const anyPositive = rows.some((r) => r.value >= 0);
  const diverging = anyNegative && anyPositive;

  return (
    <div className="mt-3 space-y-2.5">
      {rows.map((r) => {
        const positive = r.value >= 0;
        const colour = positive ? "var(--profit)" : "var(--loss)";
        const width = `${(Math.abs(r.value) / max) * (diverging ? 50 : 100)}%`;
        const cls = "flex items-center gap-3";
        const body = (
          <>
            <div className="w-[34%] min-w-0 shrink-0 sm:w-[30%]">
              <div className="truncate text-[13px] leading-tight"
                   style={{ fontWeight: r.flag ? 700 : 500 }}>{r.label}</div>
              {r.meta && (
                <div className="truncate text-[11px] leading-tight" style={{ color: "var(--ink3)" }}>
                  {r.meta}
                </div>
              )}
            </div>

            <div className="relative h-5 flex-1" aria-hidden>
              {diverging && (
                <span className="absolute inset-y-0 left-1/2 w-px" style={{ background: "var(--ink3)", opacity: 0.45 }} />
              )}
              <span
                className="absolute top-1/2 h-4 -translate-y-1/2 rounded-[3px]"
                style={{
                  width,
                  background: colour,
                  ...(diverging
                    ? positive ? { left: "50%" } : { right: "50%" }
                    : { left: 0 }),
                }}
              />
            </div>

            <div className="num w-[68px] shrink-0 text-right text-[12.5px] font-bold sm:w-[80px] sm:text-[13px]"
                 style={{ color: colour }}>
              {format(r.value)}
            </div>
            {r.href && <span className="-ml-1.5 shrink-0 text-[12px]" style={{ color: "var(--ink3)" }} aria-hidden>›</span>}
          </>
        );
        return r.href
          ? <Link key={r.label} href={r.href} scroll={false} className={cls}>{body}</Link>
          : <div key={r.label} className={cls}>{body}</div>;
      })}
    </div>
  );
}

/**
 * Cumulative line with drawdown shaded beneath. SVG is right for a line — but the
 * readouts are HTML beside it, so they never scale with the drawing.
 */
export function CurveChart({ points, format, aria, height = 120 }: {
  points: number[]; format: (v: number) => string; aria: string; height?: number;
}) {
  if (points.length < 2) return null;
  const W = 340, H = height, T = 6, B = 6;
  const ph = H - T - B;
  const min = Math.min(0, ...points), max = Math.max(...points);
  const X = (i: number) => (i / (points.length - 1)) * W;
  const Y = (v: number) => T + (1 - (v - min) / (max - min || 1)) * ph;

  let peak = -Infinity;
  const dd = points.map((v) => { peak = Math.max(peak, v); return v - peak; });
  const worst = Math.min(...dd);
  const last = points[points.length - 1];

  return (
    <div className="mt-3">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={aria}
           preserveAspectRatio="none" className="block w-full" style={{ height }}>
        {[0, 0.5, 1].map((f) => (
          <line key={f} x1={0} y1={T + f * ph} x2={W} y2={T + f * ph} stroke="var(--grid)" strokeWidth={1}
                vectorEffect="non-scaling-stroke" />
        ))}
        {worst < 0 && (
          <path
            d={`M0 ${T + ph} ${dd.map((v, i) => `L${X(i).toFixed(1)} ${(T + ph - (v / worst) * ph * 0.26).toFixed(1)}`).join(" ")} L${W} ${T + ph} Z`}
            fill="var(--loss)" opacity={0.15}
          />
        )}
        <polyline points={points.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" ")}
                  fill="none" stroke="var(--c1)" strokeWidth={2} strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="mt-2 flex justify-between text-[11px]" style={{ color: "var(--ink3)" }}>
        <span>ends at <b className="num" style={{ color: "var(--c1)" }}>{format(last)}</b></span>
        <span>worst dip <b className="num" style={{ color: "var(--loss)" }}>{format(worst)}</b></span>
      </div>
    </div>
  );
}

/** Two bars read against each other, e.g. win rate vs the rate it needs. */
export function VersusBar({ actual, target, actualLabel, targetLabel, format }: {
  actual: number; target: number; actualLabel: string; targetLabel: string; format: (v: number) => string;
}) {
  const max = Math.max(actual, target) * 1.15;
  const ahead = actual >= target;
  return (
    <div className="mt-4 space-y-3">
      {[{ v: actual, l: actualLabel, c: ahead ? "var(--profit)" : "var(--loss)" },
        { v: target, l: targetLabel, c: "var(--ink3)" }].map((b) => (
        <div key={b.l}>
          <div className="flex items-baseline justify-between gap-3 text-[12px]">
            <span style={{ color: "var(--ink2)" }}>{b.l}</span>
            <span className="num shrink-0 font-semibold" style={{ color: b.c }}>{format(b.v)}</span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full" style={{ background: "var(--s3)" }}>
            <div className="h-full rounded-full" style={{ width: `${(b.v / max) * 100}%`, background: b.c }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Calendar heatmap. Colour carries magnitude and sign, and the value is printed
 * in every cell — so the grid never depends on hue alone to be read.
 */
export function CalendarHeatmap({ days, timeZone }: {
  days: { date: string; net: number; trades: number }[];
  timeZone: string;
}) {
  if (!days.length) return null;
  const max = Math.max(...days.map((d) => Math.abs(d.net)), 0.0001);
  const byDate = new Map(days.map((d) => [d.date, d]));

  const first = new Date(`${days[0].date}T12:00:00Z`);
  const last = new Date(`${days[days.length - 1].date}T12:00:00Z`);
  const start = new Date(first);
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));

  const cells: { key: string; d?: { date: string; net: number; trades: number }; day: number }[] = [];
  for (let t = start.getTime(); t <= last.getTime() + 86400000; t += 86400000) {
    const dt = new Date(t);
    const key = dt.toISOString().slice(0, 10);
    cells.push({ key, d: byDate.get(key), day: dt.getUTCDate() });
  }

  return (
    <div className="mt-3">
      <div className="grid grid-cols-7 gap-1">
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
          <div key={i} className="pb-1 text-center text-[9.5px] font-semibold" style={{ color: "var(--ink3)" }}>{d}</div>
        ))}
        {cells.map((c) => {
          const net = c.d?.net;
          const bg = net == null || net === 0
            ? "var(--s1)"
            : `color-mix(in srgb, var(${net > 0 ? "--profit" : "--loss"}) ${Math.round(14 + Math.min(1, Math.abs(net) / max) * 54)}%, var(--s1))`;
          return (
            <div key={c.key}
                 title={c.d ? `${c.key}: ${net! >= 0 ? "+" : "−"}$${Math.abs(net!).toFixed(2)} from ${c.d.trades} trades` : c.key}
                 className="flex aspect-square flex-col items-center justify-center rounded-[5px] p-0.5"
                 style={{ background: bg, border: `1px solid ${c.d ? "var(--line)" : "transparent"}` }}>
              <span className="num text-[8px] leading-none" style={{ color: "var(--ink3)" }}>{c.day}</span>
              {c.d && (
                <span className={`num text-[9px] font-bold leading-tight ${net! > 0 ? "pos" : net! < 0 ? "neg" : ""}`}>
                  {Math.abs(net!) < 0.5 ? "0" : `${net! > 0 ? "+" : "−"}${Math.abs(net!).toFixed(0)}`}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[11px]" style={{ color: "var(--ink3)" }}>
        Each square is one day in your local time, with the amount printed in it.
      </p>
    </div>
  );
}

/**
 * One day's running total, in the order the exits happened.
 *
 * Separate from CurveChart because the question is different. Across months you
 * want the trend and the drawdown shading; inside a single day you want to know
 * where the high point was and how much of it survived to the close — so the
 * peak is marked, the zero line is drawn properly, and the axis is clock time
 * rather than an index.
 */
export function DayCurve({ points, format, aria, height = 132 }: {
  points: { at: string; value: number }[];
  format: (v: number) => string;
  aria: string;
  height?: number;
}) {
  if (points.length < 2) return null;
  const W = 340, H = height, T = 10, B = 10;
  const ph = H - T - B;
  const values = points.map((p) => p.value);
  const min = Math.min(0, ...values), max = Math.max(0, ...values);
  const X = (i: number) => (i / (points.length - 1)) * W;
  const Y = (v: number) => T + (1 - (v - min) / (max - min || 1)) * ph;

  let peakAt = 0;
  for (let i = 1; i < values.length; i++) if (values[i] > values[peakAt]) peakAt = i;
  const last = values[values.length - 1];
  const peak = values[peakAt];
  const zeroY = Y(0);

  return (
    <div className="mt-3">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={aria}
           preserveAspectRatio="none" className="block w-full" style={{ height }}>
        {/* The zero line is the one that matters, so it is the only solid rule. */}
        <line x1={0} y1={zeroY} x2={W} y2={zeroY} stroke="var(--ink3)" strokeWidth={1}
              opacity={0.5} vectorEffect="non-scaling-stroke" />
        <polyline points={points.map((p, i) => `${X(i).toFixed(1)},${Y(p.value).toFixed(1)}`).join(" ")}
                  fill="none" stroke={last >= 0 ? "var(--profit)" : "var(--loss)"} strokeWidth={2}
                  strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {peak > 0 && peak > last && (
          <>
            <line x1={0} y1={Y(peak)} x2={W} y2={Y(peak)} stroke="var(--ink3)" strokeWidth={1}
                  strokeDasharray="4 4" opacity={0.6} vectorEffect="non-scaling-stroke" />
            <circle cx={X(peakAt)} cy={Y(peak)} r={3} fill="var(--profit)" />
          </>
        )}
      </svg>
      <div className="mt-1 flex justify-between text-[11px]" style={{ color: "var(--ink3)" }}>
        <span className="num">{points[0].at}</span>
        <span className="num">{points[points.length - 1].at}</span>
      </div>
    </div>
  );
}

/**
 * A tiny cumulative line, for a row in a list.
 *
 * One series, so no legend and no axis — the surrounding row says what it is.
 * Its whole job is the shape: an aggregate can say a setup made four hundred
 * dollars and cannot say whether it made six hundred three months ago and has
 * been bleeding since, which is the difference between a setup to lean on and
 * one to retire.
 */
export function Sparkline({ values, width = 76, height = 22, aria }: {
  values: number[]; width?: number; height?: number; aria: string;
}) {
  if (values.length < 2) return null;
  const min = Math.min(0, ...values), max = Math.max(0, ...values);
  const span = max - min || 1;
  const X = (i: number) => (i / (values.length - 1)) * width;
  const Y = (v: number) => height - 1 - ((v - min) / span) * (height - 2);
  const last = values[values.length - 1];
  const colour = last >= 0 ? "var(--profit)" : "var(--loss)";

  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={aria}
         width={width} height={height} className="block shrink-0">
      <line x1={0} y1={Y(0)} x2={width} y2={Y(0)} stroke="var(--ink3)" strokeWidth={1}
            opacity={0.35} vectorEffect="non-scaling-stroke" />
      <polyline points={values.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" ")}
                fill="none" stroke={colour} strokeWidth={1.5} strokeLinejoin="round"
                vectorEffect="non-scaling-stroke" />
      <circle cx={X(values.length - 1)} cy={Y(last)} r={1.8} fill={colour} />
    </svg>
  );
}

const compact = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1000) return `${(a / 1000).toFixed(a >= 10000 ? 0 : 1)}k`;
  return String(Math.round(a));
};

export interface HeatCell { row: string; col: number; value: number; count: number; href?: string }

/**
 * Two categorical dimensions against one value.
 *
 * A diverging scale, so the midpoint is the page's own surface rather than a
 * third hue: zero has to read as nothing, and a colour there would make an
 * ordinary cell look like a finding. The amount is printed in every cell, which
 * on a continuous colour scale is not optional — green and red are the pair
 * most readers with a colour deficiency cannot separate, so the number is what
 * actually carries the meaning and the colour only helps it be found.
 *
 * Scrolls sideways with the labels pinned, rather than shrinking cells to fit.
 * A grid squeezed to phone width has cells too small to print a number in, and
 * at that point it is decoration.
 */
export function Heatmap({ cells, rows, cols, colLabel, scale, empty = "—" }: {
  cells: HeatCell[];
  rows: string[];
  cols: number[];
  colLabel: (c: number) => string;
  /** Largest absolute value anywhere, so every cell is on one scale. */
  scale: number;
  empty?: string;
}) {
  const at = new Map(cells.map((c) => [`${c.row}|${c.col}`, c]));

  return (
    <div className="-mx-5 mt-3 overflow-x-auto px-5">
      <div className="inline-grid gap-0.5"
           style={{ gridTemplateColumns: `52px repeat(${cols.length}, minmax(40px, 1fr))` }}>
        <div />
        {cols.map((c) => (
          <div key={c} className="num pb-1 text-center text-[9.5px] font-semibold"
               style={{ color: "var(--ink3)" }}>{colLabel(c)}</div>
        ))}

        {rows.map((r) => (
          <div key={r} className="contents">
            <div className="flex items-center pr-2 text-[11px] font-medium"
                 style={{ color: "var(--ink2)" }}>{r.slice(0, 3)}</div>
            {cols.map((c) => {
              const cell = at.get(`${r}|${c}`);
              if (!cell) {
                return (
                  <div key={c} className="grid h-9 place-items-center rounded-[5px] text-[10px]"
                       style={{ background: "var(--s3)", color: "var(--ink3)", opacity: 0.5 }}>
                    {empty}
                  </div>
                );
              }
              const strength = Math.round(14 + Math.min(1, Math.abs(cell.value) / scale) * 56);
              const bg = cell.value === 0
                ? "var(--s3)"
                : `color-mix(in srgb, var(${cell.value > 0 ? "--profit" : "--loss"}) ${strength}%, var(--s1))`;
              const body = (
                <span className={`num text-[10.5px] font-bold ${cell.value > 0 ? "pos" : cell.value < 0 ? "neg" : ""}`}>
                  {cell.value > 0 ? "+" : cell.value < 0 ? "−" : ""}{compact(cell.value)}
                </span>
              );
              const style = { background: bg, border: "1px solid var(--line)" };
              const cls = "grid h-9 place-items-center rounded-[5px]";
              const title = `${r} ${colLabel(c)} · ${cell.count} ${cell.count === 1 ? "trade" : "trades"}`;

              return cell.href
                ? <Link key={c} href={cell.href} scroll={false} className={cls} style={style} title={title}>{body}</Link>
                : <div key={c} className={cls} style={style} title={title}>{body}</div>;
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export interface HistogramBin {
  from: number; to: number; count: number; total: number; overflow: boolean;
}

/**
 * How results are spread, rather than what they average to.
 *
 * Built for one question that the averages elsewhere in this app structurally
 * cannot answer: when it goes wrong, how wrong, and how often. Zero is a bin
 * edge and is drawn as a solid rule, so no bar ever mixes money made with money
 * lost. The two end bins collect everything past the second and ninety-eighth
 * percentile and are outlined rather than filled, because they mean "and worse"
 * rather than a range — and they are labelled, since they are the bars a reader
 * came for.
 */
export function Histogram({ bins, format, height = 128 }: {
  bins: HistogramBin[];
  format: (v: number) => string;
  height?: number;
}) {
  const shown = bins.filter((b, i) => b.count > 0 || (i > 0 && i < bins.length - 1));
  if (shown.length < 2) return null;
  const tallest = Math.max(...shown.map((b) => b.count), 1);
  const zeroIndex = shown.findIndex((b) => b.from >= 0);

  return (
    <div className="mt-3">
      <div className="relative flex items-end gap-[2px]" style={{ height }}>
        {shown.map((b, i) => {
          const h = Math.max(b.count > 0 ? 3 : 0, (b.count / tallest) * (height - 18));
          const win = b.from >= 0;
          const colour = win ? "var(--profit)" : "var(--loss)";
          const label = b.overflow
            ? `${win ? "better than" : "worse than"} ${format(win ? b.from : b.to)}`
            : `${format(b.from)} to ${format(b.to)}`;
          return (
            <div key={i} className="relative flex flex-1 flex-col items-center justify-end"
                 style={{ height }} title={`${label} · ${b.count} ${b.count === 1 ? "trade" : "trades"} · ${format(b.total)} in total`}>
              {b.overflow && b.count > 0 && (
                <span className="num pb-0.5 text-[9.5px] font-bold" style={{ color: colour }}>{b.count}</span>
              )}
              <div className="w-full rounded-t-[3px]"
                   style={b.overflow
                     ? { height: h, border: `1.5px solid ${colour}`, background: `color-mix(in srgb, ${colour} 16%, transparent)` }
                     : { height: h, background: colour }} />
            </div>
          );
        })}
        {zeroIndex > 0 && (
          <span className="pointer-events-none absolute inset-y-0"
                style={{
                  left: `calc(${(zeroIndex / shown.length) * 100}% - 1px)`,
                  width: 1, background: "var(--ink3)", opacity: 0.55,
                }} />
        )}
      </div>
      <div className="mt-1.5 flex justify-between text-[10.5px]" style={{ color: "var(--ink3)" }}>
        <span className="num">{format(shown[0].to)} and worse</span>
        <span>losses ← 0 → wins</span>
        <span className="num">{format(shown[shown.length - 1].from)} and better</span>
      </div>
    </div>
  );
}
