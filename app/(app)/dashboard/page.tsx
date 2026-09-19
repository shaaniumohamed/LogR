import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { zoneTrades } from "@/lib/db/schema";
import { getOrCreateAccount } from "@/lib/account";
import { computeStats, costPicture, hourIn, segmentBy } from "@/lib/core/metrics";
import type { ZoneTrade } from "@/lib/core/types";

export const dynamic = "force-dynamic";

const money = (n: number, d = 2) => `${n < 0 ? "−" : ""}$${Math.abs(n).toFixed(d)}`;
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

export default async function Dashboard() {
  const session = await auth();
  const userId = session!.user!.id!;
  const tz = "Asia/Kuala_Lumpur"; // TODO: from users.timeZone once the settings screen lands
  const account = await getOrCreateAccount(userId);

  const rows = await db.select().from(zoneTrades)
    .where(eq(zoneTrades.accountId, account.id))
    .orderBy(desc(zoneTrades.closedAt));

  if (rows.length === 0) {
    return (
      <div className="card p-10 text-center">
        <h1 className="text-lg font-semibold">Nothing imported yet</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm" style={{ color: "var(--ink2)" }}>
          Import a broker CSV and this fills in. You get the numbers before you get a
          single form to fill out.
        </p>
        <Link href="/import" className="mt-5 inline-block rounded-lg px-4 py-2.5 text-sm font-semibold"
              style={{ background: "var(--ink)", color: "var(--plane)" }}>
          Import trade history
        </Link>
      </div>
    );
  }

  const trades: ZoneTrade[] = rows.map((r) => ({
    id: r.identityHash, symbol: r.symbol, direction: r.direction as "long" | "short",
    legs: [], openedAt: r.openedAt, closedAt: r.closedAt, holdMinutes: r.holdMinutes,
    lots: r.lots, avgEntry: r.avgEntry, avgExit: r.avgExit, zoneLow: r.zoneLow,
    zoneHigh: r.zoneHigh, zoneHeight: r.zoneHigh - r.zoneLow, netPnl: r.netPnl,
    commission: 0, swap: 0, legCount: r.legCount,
    closeReasons: r.closeReasons as ZoneTrade["closeReasons"], hadStop: r.hadStop,
  }));

  const s = computeStats(trades);
  const cost = costPicture(s.net, s.totalLots);
  const byHour = segmentBy(trades, (t) => `${String(hourIn(t.openedAt, tz)).padStart(2, "0")}:00`, 15);
  const worstHours = byHour.slice(-3).reverse();
  const layered = trades.filter((t) => t.legCount > 1).length;

  return (
    <div className="space-y-5">
      {/* The edge, not the win rate. A 57% win rate is excellent at a 1.5 payoff
          and exactly break-even at 0.77 — only the gap tells you which. */}
      <div className="card p-6">
        <div className="eyebrow">Edge over break-even</div>
        <div className="mt-1 flex items-end gap-3">
          <div className={`num text-5xl font-semibold tracking-tight ${(s.edgePoints ?? 0) > 0 ? "pos" : "neg"}`}>
            {s.edgePoints !== null ? `${s.edgePoints > 0 ? "+" : "−"}${Math.abs(s.edgePoints).toFixed(2)}` : "—"}
          </div>
          <div className="pb-2 text-sm" style={{ color: "var(--ink2)" }}>points of win rate</div>
        </div>
        <p className="mt-3 text-sm leading-relaxed" style={{ color: "var(--ink2)" }}>
          You win <b className="num">{pct(s.winRate)}</b> of trades. At your payoff ratio of{" "}
          <b className="num">{s.payoff?.toFixed(2) ?? "—"}</b> you need{" "}
          <b className="num">{s.breakEvenWinRate ? pct(s.breakEvenWinRate) : "—"}</b> just to break even.
          {(s.edgePoints ?? 0) < 2 && (s.edgePoints ?? 0) > -99 && (
            <> That margin is thin — a small drop in win rate or win size puts it underwater.</>
          )}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl sm:grid-cols-4"
           style={{ background: "var(--line)", border: "1px solid var(--line)" }}>
        <Tile label="Net P&L" value={money(s.net)} tone={s.net >= 0 ? "pos" : "neg"} sub={`${s.n} zone trades`} />
        <Tile label="Profit factor" value={s.profitFactor?.toFixed(3) ?? "—"} sub={`${money(s.grossProfit, 0)} / ${money(-s.grossLoss, 0)}`} />
        <Tile label="Avg win : loss" value={s.payoff?.toFixed(2) ?? "—"} sub={`$${s.avgWin} / $${s.avgLoss}`} />
        <Tile label="Per trade" value={money(s.expectancy)} sub={`${s.avgHoldMinutes.toFixed(0)} min avg hold`} />
      </div>

      <div className="card p-5">
        <div className="eyebrow">What the spread costs</div>
        <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--ink2)" }}>
          It is inside your fill price, so your net is <b>already after it</b> — not a hidden
          charge, a hurdle each trade cleared. Over {s.totalLots} lots that hurdle was{" "}
          <b className="num">{money(cost.costLo, 0)}–{money(cost.costHi, 0)}</b>, which makes your
          gross edge <b className="num">{money(cost.grossLo, 0)}–{money(cost.grossHi, 0)}</b>. You keep{" "}
          <b className="num">{cost.keptLo !== null ? `${(cost.keptLo * 100).toFixed(0)}–${(cost.keptHi! * 100).toFixed(0)}%` : "—"}</b> of it.
        </p>
      </div>

      {worstHours.length > 0 && (
        <div className="card p-5">
          <div className="eyebrow">Your worst hours — your local time</div>
          <p className="mt-1 text-xs" style={{ color: "var(--ink3)" }}>
            The export is UTC. These are converted to {tz.replace("_", " ")}, because
            &ldquo;avoid 13:00 UTC&rdquo; is an abstraction and &ldquo;avoid 9pm&rdquo; is a decision.
          </p>
          <div className="mt-3 space-y-2">
            {worstHours.map((h) => (
              <div key={h.key} className="flex items-baseline justify-between text-sm">
                <span className="num">{h.key}</span>
                <span style={{ color: "var(--ink3)" }} className="text-xs">n={h.stats.n}</span>
                <span className={`num font-semibold ${h.stats.net >= 0 ? "pos" : "neg"}`}>
                  {money(h.stats.net, 0)}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs" style={{ color: "var(--ink3)" }}>
            Check per-day consistency before acting — one catastrophic day inside a window
            can look exactly like a pattern.
          </p>
        </div>
      )}

      <div className="card p-5">
        <div className="eyebrow">How you trade</div>
        <p className="mt-2 text-sm" style={{ color: "var(--ink2)" }}>
          {layered} of {trades.length} zone trades ({((layered / trades.length) * 100).toFixed(0)}%)
          were laddered, averaging{" "}
          <b className="num">{(trades.reduce((a, t) => a + t.legCount, 0) / trades.length).toFixed(2)}</b>{" "}
          entries each. Only <b className="num">{trades.filter((t) => t.hadStop).length}</b> carried a
          platform stop — which is why R has to come from a declared invalidation, not the export.
        </p>
      </div>
    </div>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "pos" | "neg" }) {
  return (
    <div className="p-4" style={{ background: "var(--s1)" }}>
      <div className={`num text-xl font-semibold tracking-tight ${tone ?? ""}`}>{value}</div>
      <div className="mt-1 text-[11px] font-medium" style={{ color: "var(--ink3)" }}>{label}</div>
      {sub && <div className="num mt-0.5 text-[10px]" style={{ color: "var(--ink3)" }}>{sub}</div>}
    </div>
  );
}
