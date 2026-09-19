/**
 * Chart primitives. Rules applied throughout (docs/18, docs/19):
 *  - one scale, never a second y-axis
 *  - profit/loss colour is always reinforced by a sign and a printed value,
 *    because that hue pair alone is not distinguishable to every reader
 *  - sample size is rendered in words next to every bar, not as "n="
 *  - the grid recedes; the zero baseline is the strongest line in the drawing
 */

export interface BarRow {
  label: string;
  value: number;
  /** Shown verbatim, e.g. "61 trades". */
  meta?: string;
  /** Extra emphasis for a row worth noticing. */
  flag?: boolean;
}

export function BarChart({ rows, format, labelWidth = 104, aria }: {
  rows: BarRow[];
  format: (v: number) => string;
  labelWidth?: number;
  aria: string;
}) {
  if (rows.length === 0) return null;
  const rowH = 34;
  const W = 340, padR = 4, H = rows.length * rowH + 6;
  const max = Math.max(...rows.map((r) => Math.abs(r.value)), 0.0001);
  const zero = labelWidth + (W - labelWidth - padR) / 2;
  const half = (W - labelWidth - padR) / 2;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={aria}
         className="mt-3 block w-full" style={{ height: "auto", overflow: "visible" }}>
      <line x1={zero} y1={2} x2={zero} y2={H - 4} stroke="var(--ink3)" strokeWidth={1} opacity={0.5} />
      {rows.map((r, i) => {
        const y = 3 + i * rowH;
        const w = (Math.abs(r.value) / max) * half * 0.9;
        const positive = r.value >= 0;
        const x = positive ? zero : zero - w;
        const col = positive ? "var(--profit)" : "var(--loss)";
        return (
          <g key={r.label}>
            <text x={labelWidth - 8} y={y + 13} textAnchor="end"
                  style={{ fontSize: 11, fill: "var(--ink)", fontWeight: r.flag ? 700 : 500 }}>
              {r.label}
            </text>
            {r.meta && (
              <text x={labelWidth - 8} y={y + 25} textAnchor="end" style={{ fontSize: 9.5, fill: "var(--ink3)" }}>
                {r.meta}
              </text>
            )}
            <rect x={x} y={y + 5} width={Math.max(2, w)} height={rowH - 16} rx={3} fill={col} />
            <text x={positive ? x + w + 6 : x - 6} y={y + 17} textAnchor={positive ? "start" : "end"}
                  className="num" style={{ fontSize: 11, fill: col, fontWeight: 700 }}>
              {format(r.value)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Cumulative line with the drawdown shaded beneath it. One series, one scale. */
export function CurveChart({ points, format, aria, height = 120 }: {
  points: number[]; format: (v: number) => string; aria: string; height?: number;
}) {
  if (points.length < 2) return null;
  const W = 340, H = height, L = 4, R = 52, T = 10, B = 12;
  const pw = W - L - R, ph = H - T - B;
  const min = Math.min(0, ...points), max = Math.max(...points);
  const X = (i: number) => L + (i / (points.length - 1)) * pw;
  const Y = (v: number) => T + (1 - (v - min) / (max - min || 1)) * ph;

  let peak = -Infinity;
  const dd = points.map((v) => { peak = Math.max(peak, v); return v - peak; });
  const worst = Math.min(...dd);
  const last = points[points.length - 1];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={aria}
         className="mt-3 block w-full" style={{ height: "auto", overflow: "visible" }}>
      {[0, 0.5, 1].map((f) => (
        <line key={f} x1={L} y1={T + f * ph} x2={W - R} y2={T + f * ph} stroke="var(--grid)" strokeWidth={1} />
      ))}
      {worst < 0 && (
        <path
          d={`M${X(0)} ${T + ph} ${dd.map((v, i) => `L${X(i).toFixed(1)} ${(T + ph - (v / worst) * ph * 0.26).toFixed(1)}`).join(" ")} L${X(points.length - 1)} ${T + ph} Z`}
          fill="var(--loss)" opacity={0.15}
        />
      )}
      <polyline
        points={points.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" ")}
        fill="none" stroke="var(--c1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
      />
      <circle cx={X(points.length - 1)} cy={Y(last)} r={3} fill="var(--c1)" />
      <text x={W - R + 6} y={Y(last) + 4} className="num" style={{ fontSize: 11, fill: "var(--c1)", fontWeight: 700 }}>
        {format(last)}
      </text>
      <text x={W - R + 6} y={T + ph - 2} style={{ fontSize: 9, fill: "var(--ink3)" }}>worst dip</text>
      <text x={W - R + 6} y={T + ph + 9} className="num" style={{ fontSize: 10, fill: "var(--loss)" }}>
        {format(worst)}
      </text>
    </svg>
  );
}

/** Two bars that must be read against each other, e.g. win rate vs what it needs. */
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
          <div className="flex items-baseline justify-between text-[12px]">
            <span style={{ color: "var(--ink2)" }}>{b.l}</span>
            <span className="num font-semibold" style={{ color: b.c }}>{format(b.v)}</span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full" style={{ background: "var(--s3)" }}>
            <div className="h-full rounded-full" style={{ width: `${(b.v / max) * 100}%`, background: b.c }} />
          </div>
        </div>
      ))}
    </div>
  );
}
