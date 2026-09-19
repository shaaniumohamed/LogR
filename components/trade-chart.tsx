import type { Position } from "@/lib/core/types";

/**
 * The trade drawn from its own fills.
 *
 * There are no candles here, and that is a data limit rather than a design
 * choice: the broker export carries fills, not price history. What it does carry
 * is every entry and exit with a price and a timestamp, which is enough to show
 * where the zone sat, how deep the ladder filled, where each exit landed and
 * whether the invalidation was respected. Candles need a market-data feed on top.
 */
export function TradeChart({ legs, zoneLow, zoneHigh, invalidation, direction, timeZone }: {
  legs: Position[];
  zoneLow: number;
  zoneHigh: number;
  invalidation: number | null;
  direction: "long" | "short";
  timeZone: string;
}) {
  if (!legs.length) return null;

  const events = [
    ...legs.map((l) => ({ t: l.openedAt.getTime(), price: l.openPrice, kind: "in" as const, leg: l })),
    ...legs.map((l) => ({ t: l.closedAt.getTime(), price: l.closePrice, kind: "out" as const, leg: l })),
  ].sort((a, b) => a.t - b.t);

  const t0 = events[0].t, t1 = events[events.length - 1].t;
  const span = Math.max(1, t1 - t0);

  const prices = [...events.map((e) => e.price), zoneLow, zoneHigh, ...(invalidation ? [invalidation] : [])];
  let lo = Math.min(...prices), hi = Math.max(...prices);
  const padP = Math.max((hi - lo) * 0.18, 0.25);
  lo -= padP; hi += padP;

  const W = 340, H = 190, L = 6, R = 46, T = 12, B = 22;
  const pw = W - L - R, ph = H - T - B;
  const X = (t: number) => L + ((t - t0) / span) * pw;
  const Y = (p: number) => T + (1 - (p - lo) / (hi - lo)) * ph;

  const fmtTime = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone,
  });

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img"
           aria-label="Entries, exits and zone plotted against price and time"
           className="block w-full" style={{ height: "auto" }}>
        {/* the zone the ladder filled into */}
        <rect x={L} y={Y(zoneHigh)} width={pw} height={Math.max(2, Y(zoneLow) - Y(zoneHigh))}
              fill="var(--c1)" opacity={0.13} />
        <rect x={L} y={Y(zoneHigh)} width={pw} height={Math.max(2, Y(zoneLow) - Y(zoneHigh))}
              fill="none" stroke="var(--c1)" strokeOpacity={0.45} strokeWidth={1} />
        <text x={L + 4} y={Y(zoneHigh) - 3} style={{ fontSize: 8, fill: "var(--c1)", fontWeight: 700 }}>zone</text>

        {invalidation && invalidation > lo && invalidation < hi && (
          <>
            <line x1={L} y1={Y(invalidation)} x2={W - R} y2={Y(invalidation)}
                  stroke="var(--loss)" strokeWidth={1.5} strokeDasharray="5 4" />
            <text x={L + 4} y={Y(invalidation) + (Y(invalidation) < T + 16 ? 10 : -4)}
                  style={{ fontSize: 8, fill: "var(--loss)", fontWeight: 700 }}>idea dead</text>
          </>
        )}

        {/* the path price took through your fills — real points, not a guess */}
        <polyline points={events.map((e) => `${X(e.t).toFixed(1)},${Y(e.price).toFixed(1)}`).join(" ")}
                  fill="none" stroke="var(--ink3)" strokeWidth={1.25} strokeDasharray="3 3" opacity={0.75} />

        {events.map((e, i) => {
          const x = X(e.t), y = Y(e.price);
          const won = e.leg.profit >= 0;
          return e.kind === "in" ? (
            <path key={i} d={`M${(x - 4).toFixed(1)} ${(y - 4).toFixed(1)} L${(x + 4).toFixed(1)} ${y.toFixed(1)} L${(x - 4).toFixed(1)} ${(y + 4).toFixed(1)} Z`}
                  fill="var(--c1)">
              <title>{`Entry ${e.price.toFixed(2)} · ${e.leg.lots} lots · ${fmtTime.format(e.leg.openedAt)}`}</title>
            </path>
          ) : (
            <circle key={i} cx={x} cy={y} r={3.6} fill="var(--s1)"
                    stroke={won ? "var(--profit)" : "var(--loss)"} strokeWidth={2}>
              <title>{`Exit ${e.price.toFixed(2)} · ${e.leg.lots} lots · ${won ? "+" : "−"}$${Math.abs(e.leg.profit).toFixed(2)} · ${fmtTime.format(e.leg.closedAt)}`}</title>
            </circle>
          );
        })}

        {[hi - padP * 0.5, lo + padP * 0.5].map((p) => (
          <text key={p} x={W - 3} y={Y(p) + 3} textAnchor="end"
                style={{ fontSize: 8, fill: "var(--ink3)" }} className="num">{p.toFixed(2)}</text>
        ))}
        <text x={L} y={H - 6} style={{ fontSize: 8, fill: "var(--ink3)" }}>{fmtTime.format(new Date(t0))}</text>
        <text x={W - R} y={H - 6} textAnchor="end" style={{ fontSize: 8, fill: "var(--ink3)" }}>
          {fmtTime.format(new Date(t1))}
        </text>
      </svg>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px]" style={{ color: "var(--ink3)" }}>
        <span className="inline-flex items-center gap-1.5">
          <span style={{ color: "var(--c1)" }}>▶</span> entry ({direction === "long" ? "buy" : "sell"})
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full" style={{ border: "2px solid var(--profit)" }} /> exit in profit
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full" style={{ border: "2px solid var(--loss)" }} /> exit at a loss
        </span>
      </div>
    </div>
  );
}
