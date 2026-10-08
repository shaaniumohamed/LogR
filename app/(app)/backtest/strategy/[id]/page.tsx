import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, Empty, Eyebrow, Note, money } from "@/components/ui";
import { backtestContext, heldRange, loadBtTrades, loadSessionList, loadStrategy } from "@/lib/backtest-data";
import { fromRow } from "../../s/[id]/model";
import { History, StatsView } from "../../s/[id]/panels";
import { ArchiveButton, NewSession, RemoveButton } from "../../forms";

export const dynamic = "force-dynamic";

/** One strategy across every session it has been tested in. */
export default async function StrategyPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await backtestContext();
  if (!ctx) return <Empty title="Backtesting is not open yet" body="It is only available to the owners while it is being finished." />;
  const { id } = await params;
  const strategy = await loadStrategy(ctx.userId, id);
  if (!strategy) notFound();
  const [sessions, trades, range] = await Promise.all([
    loadSessionList(ctx.userId, id), loadBtTrades(ctx.userId, { strategyId: id }), heldRange("XAUUSD"),
  ]);
  const props = trades.map(fromRow);
  const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: ctx.timeZone });

  return (
    <div className="space-y-4 pt-2">
      <Link href="/backtest" className="tap text-[13px]" style={{ color: "var(--c1)" }}>‹ Backtest</Link>
      <div>
        <h1 className="text-[24px] font-semibold tracking-tight">{strategy.name}</h1>
        {strategy.description && <Note>{strategy.description}</Note>}
        {strategy.setup && <p className="mt-1 text-[12.5px]" style={{ color: "var(--ink3)" }}>Journal setup: {strategy.setup}</p>}
      </div>

      <Card>
        <Eyebrow>Across every session</Eyebrow>
        <StatsView trades={props} />
      </Card>

      <Card>
        <Eyebrow>Sessions</Eyebrow>
        {sessions.length === 0 && <Note>No sessions yet.</Note>}
        <ul className="divide-y" style={{ borderColor: "var(--line)" }}>
          {sessions.map((s) => {
            const ts = trades.filter((t) => t.sessionId === s.id);
            const net = ts.reduce((a, t) => a + t.pnl, 0);
            return (
              <li key={s.id} className="flex items-center gap-3 py-2.5 text-[13.5px]" style={{ borderColor: "var(--line)" }}>
                <Link href={`/backtest/s/${s.id}`} className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{s.name}</span>
                  <span className="num block text-[12px]" style={{ color: "var(--ink3)" }}>{day.format(s.startedAt)} → {day.format(s.clockAt)} · {ts.length} trades</span>
                </Link>
                {ts.length > 0 && <span className="num font-semibold" style={{ color: net >= 0 ? "var(--profit)" : "var(--loss)" }}>{money(net)}</span>}
                <RemoveButton what="session" id={s.id} kind="session" />
              </li>
            );
          })}
        </ul>
        {range && <div className="mt-3"><NewSession strategyId={strategy.id} timeZone={ctx.timeZone} range={range} /></div>}
      </Card>

      <Card>
        <Eyebrow>Every trade</Eyebrow>
        <History trades={props} timeZone={ctx.timeZone} />
      </Card>

      <div className="flex gap-4 px-1">
        <ArchiveButton id={strategy.id} archived={strategy.archived} />
        <RemoveButton what="strategy" id={strategy.id} kind="strategy" />
      </div>
    </div>
  );
}
