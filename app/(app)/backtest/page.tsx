import Link from "next/link";
import { Card, Empty, Eyebrow, Note, money, pct } from "@/components/ui";
import { Info } from "@/components/info";
import { backtestContext, heldRange, loadBtTrades, loadSessionList, loadStrategies } from "@/lib/backtest-data";
import { backtestStats, type BtTradeRow } from "@/lib/core/backtest";
import { NewSession, NewStrategy } from "./forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Backtest" };

/**
 * Strategies, each with the replays it has been tested in. A strategy's
 * figures add up every session under it; a session's are its own.
 */
export default async function Backtest() {
  const ctx = await backtestContext();
  if (!ctx) return <Empty title="Backtesting is not open yet" body="It is only available to the owners while it is being finished." />;
  const [strategies, sessions, trades, range] = await Promise.all([
    loadStrategies(ctx.userId), loadSessionList(ctx.userId), loadBtTrades(ctx.userId, {}), heldRange("XAUUSD"),
  ]);
  const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: ctx.timeZone });

  const bySession = new Map<string, BtTradeRow[]>();
  const byStrategy = new Map<string, BtTradeRow[]>();
  for (const t of trades) {
    bySession.set(t.sessionId, [...(bySession.get(t.sessionId) ?? []), t]);
    const s = sessions.find((x) => x.id === t.sessionId);
    if (s) byStrategy.set(s.strategyId, [...(byStrategy.get(s.strategyId) ?? []), t]);
  }

  const active = strategies.filter((s) => !s.archived), archived = strategies.filter((s) => s.archived);

  return (
    <div className="space-y-5 pt-2">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight">Backtest</h1>
        <Note>Replay any day of gold, trade it like the real account, and see what a strategy is worth before risking money on it.</Note>
      </div>

      {!range && (
        <Card>
          <Eyebrow>No price history yet</Eyebrow>
          <Note>Import your Exness tick files first, under <Link href="/settings/market" style={{ color: "var(--c1)" }}>Settings → Price history</Link>.</Note>
        </Card>
      )}

      <NewStrategy />

      {active.length === 0 && (
        <Card>
          <Eyebrow>Start with a strategy</Eyebrow>
          <Note>
            A strategy is one way of trading you want to test — say, the London sweep of the Asian low. Each replay
            you run for it is a session, and the strategy adds up every trade across them.
          </Note>
        </Card>
      )}

      {active.map((s) => {
        const st = backtestStats(byStrategy.get(s.id) ?? []);
        const own = sessions.filter((x) => x.strategyId === s.id);
        return (
          <Card key={s.id}>
            <div className="flex items-baseline gap-2">
              <Link href={`/backtest/strategy/${s.id}`} className="min-w-0 flex-1 truncate text-[16px] font-semibold">{s.name}</Link>
              <span className="num shrink-0 text-[12.5px]" style={{ color: "var(--ink3)" }}>{own.length} session{own.length === 1 ? "" : "s"}</span>
            </div>
            {s.description && <p className="mt-1 line-clamp-2 text-[13px]" style={{ color: "var(--ink2)" }}>{s.description}</p>}
            {st.n > 0 && (
              <p className="num mt-2 text-[13px]">
                <b style={{ color: st.net >= 0 ? "var(--profit)" : "var(--loss)" }}>{money(st.net)}</b>
                <span style={{ color: "var(--ink3)" }}> · {st.n} trades · {pct(st.winRate)} won{st.avgR !== null ? ` · ${st.avgR >= 0 ? "+" : ""}${st.avgR.toFixed(2)}R average` : ""}</span>
              </p>
            )}
            {own.length > 0 && (
              <ul className="mt-3 divide-y" style={{ borderColor: "var(--line)" }}>
                {own.map((x) => {
                  const ts = bySession.get(x.id) ?? [];
                  const net = ts.reduce((a, t) => a + t.pnl, 0);
                  return (
                    <li key={x.id} style={{ borderColor: "var(--line)" }}>
                      <Link href={`/backtest/s/${x.id}`} className="row-link flex items-center gap-3 py-2.5 text-[13.5px]">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{x.name}</span>
                          <span className="num block text-[12px]" style={{ color: "var(--ink3)" }}>
                            {day.format(x.startedAt)} → {day.format(x.clockAt)} · {ts.length} trade{ts.length === 1 ? "" : "s"}
                          </span>
                        </span>
                        {ts.length > 0 && <span className="num shrink-0 font-semibold" style={{ color: net >= 0 ? "var(--profit)" : "var(--loss)" }}>{money(net)}</span>}
                        <span aria-hidden style={{ color: "var(--ink3)" }}>›</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
            {range && <div className="mt-3"><NewSession strategyId={s.id} timeZone={ctx.timeZone} range={range} /></div>}
          </Card>
        );
      })}

      {archived.length > 0 && (
        <details className="card">
          <summary className="cursor-pointer text-[13.5px] font-medium">Archived strategies ({archived.length})</summary>
          <ul className="mt-2 space-y-1.5">
            {archived.map((s) => <li key={s.id}><Link href={`/backtest/strategy/${s.id}`} className="text-[13.5px]" style={{ color: "var(--c1)" }}>{s.name}</Link></li>)}
          </ul>
        </details>
      )}

      <Info title="How the replay works">
        The chart only ever shows what had happened by the replay&rsquo;s clock. Play it at any speed,
        step one candle at a time, or jump to the next London open or news release; switching timeframe
        keeps you at the same moment.
        <br /><br />
        Trades fill the way MT5 fills them, tick by tick from Exness&rsquo;s own prices: buys at the ask,
        sells at the bid, stops and targets checked against the side that would close them. Nothing is
        guessed inside a candle. Every trade is measured in R from the stop it had when it opened, and
        a session can be left and picked up again exactly where it stopped.
      </Info>
    </div>
  );
}
