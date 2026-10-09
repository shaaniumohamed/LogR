import { notFound } from "next/navigation";
import { Empty } from "@/components/ui";
import { backtestContext, heldRange, loadBtTrades, loadSession, loadStrategy } from "@/lib/backtest-data";
import { DEFAULT_CHART, DEFAULT_BT_SETTINGS } from "@/lib/core/backtest";
import { toKit } from "@/lib/chart/drawings-convert";
import type { SimState } from "@/lib/core/sim/broker";
import { Workspace } from "./workspace";
import { fromRow, type SessionProps } from "./model";

export const dynamic = "force-dynamic";

export default async function BacktestSession({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ pick?: string }>;
}) {
  const ctx = await backtestContext();
  if (!ctx) return <Empty title="Backtesting is not open yet" body="It is only available to the owners while it is being finished." />;
  const { id } = await params;
  const { pick } = await searchParams;
  const session = await loadSession(ctx.userId, id);
  if (!session) notFound();
  const [strategy, trades, range] = await Promise.all([
    loadStrategy(ctx.userId, session.strategyId),
    loadBtTrades(ctx.userId, { sessionId: id }),
    heldRange(session.symbol),
  ]);
  const start = Math.floor(session.startedAt.getTime() / 1000);
  const props: SessionProps = {
    id: session.id, name: session.name, symbol: session.symbol,
    strategy: { id: session.strategyId, name: strategy?.name ?? "Strategy" },
    startedAt: session.startedAt.getTime(), clockAt: session.clockAt.getTime(),
    timeframe: session.timeframe, chart: { ...DEFAULT_CHART, ...(session.chart ?? {}) },
    settings: { ...DEFAULT_BT_SETTINGS, ...session.settings },
    state: (session.state as unknown as SimState | null) ?? null,
    eventSeq: session.eventSeq, version: session.version,
    drawings: toKit(session.drawings, { from: start - 3600, to: start }),
    drawingTimes: session.drawingTimes ?? {},
    range,
  };
  return <Workspace session={props} trades={trades.map(fromRow)} timeZone={ctx.timeZone} startInPick={pick === "1"} />;
}
