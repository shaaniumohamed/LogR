import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { btPositions, btSessions, btStrategies, btTrades, marketChunks } from "@/lib/db/schema";
import { readOrDegrade } from "@/lib/db/schema-check";
import { requestContext } from "@/lib/session";
import type { BtTradeRow } from "@/lib/core/backtest";
import type { CloseReason } from "@/lib/core/types";

/**
 * Reading backtests. Every query is scoped by the person asking; an id from
 * the browser is only ever used together with their user id.
 */

/** Who may use the backtester while it is new: owners only. */
export async function backtestContext() {
  const ctx = await requestContext();
  if (!ctx?.hasAccess || !ctx.isOwner) return null;
  return ctx;
}

export type StrategyRow = typeof btStrategies.$inferSelect;
export type SessionRow = typeof btSessions.$inferSelect;

export function loadStrategies(userId: string): Promise<StrategyRow[]> {
  return readOrDegrade(() => db.select().from(btStrategies).where(eq(btStrategies.userId, userId)).orderBy(asc(btStrategies.archived), desc(btStrategies.updatedAt)), []);
}

export async function loadStrategy(userId: string, id: string): Promise<StrategyRow | null> {
  const [s] = await readOrDegrade(() => db.select().from(btStrategies).where(and(eq(btStrategies.userId, userId), eq(btStrategies.id, id))), []);
  return s ?? null;
}

/** Sessions without the heavy columns (drawings, engine state), for lists. */
export function loadSessionList(userId: string, strategyId?: string) {
  return readOrDegrade(() => db.select({
    id: btSessions.id, strategyId: btSessions.strategyId, name: btSessions.name, symbol: btSessions.symbol,
    startedAt: btSessions.startedAt, clockAt: btSessions.clockAt, status: btSessions.status, updatedAt: btSessions.updatedAt,
  }).from(btSessions)
    .where(strategyId ? and(eq(btSessions.userId, userId), eq(btSessions.strategyId, strategyId)) : eq(btSessions.userId, userId))
    .orderBy(desc(btSessions.updatedAt)), []);
}

export async function loadSession(userId: string, id: string): Promise<SessionRow | null> {
  const [s] = await readOrDegrade(() => db.select().from(btSessions).where(and(eq(btSessions.userId, userId), eq(btSessions.id, id))), []);
  return s ?? null;
}

/** Finished trades with their legs, for one session or a whole strategy. */
export async function loadBtTrades(userId: string, where: { sessionId?: string; strategyId?: string }): Promise<(BtTradeRow & { sessionId: string })[]> {
  const cond = [eq(btTrades.userId, userId)];
  if (where.sessionId) cond.push(eq(btTrades.sessionId, where.sessionId));
  if (where.strategyId) cond.push(eq(btTrades.strategyId, where.strategyId));
  const trades = await readOrDegrade(() => db.select().from(btTrades).where(and(...cond)).orderBy(asc(btTrades.closedAt)), []);
  if (!trades.length) return [];
  const legs = await readOrDegrade(() => db.select().from(btPositions)
    .where(and(eq(btPositions.userId, userId), inArray(btPositions.tradeId, trades.map((t) => t.id)))), []);
  const byTrade = new Map<string, typeof legs>();
  for (const l of legs) byTrade.set(l.tradeId, [...(byTrade.get(l.tradeId) ?? []), l]);
  return trades.map((t) => ({
    id: t.id, sessionId: t.sessionId, ideaId: t.ideaId, direction: t.direction as "long" | "short",
    openedAt: t.openedAt, closedAt: t.closedAt, lots: t.lots, avgEntry: t.avgEntry, avgExit: t.avgExit,
    pnl: t.pnl, risk: t.risk, r: t.r, closeReasons: t.closeReasons,
    legs: (byTrade.get(t.id) ?? []).sort((a, b) => a.closedAt.getTime() - b.closedAt.getTime()).map((l) => ({
      ticket: l.ticket, openedAt: l.openedAt, closedAt: l.closedAt, direction: l.direction as "long" | "short",
      lots: l.lots, symbol: "XAUUSD", openPrice: l.openPrice, closePrice: l.closePrice,
      stopLoss: l.stopLoss, takeProfit: l.takeProfit, commission: l.commission, swap: l.swap, profit: l.profit,
      closeReason: l.closeReason as CloseReason,
    })),
  }));
}

/** The first and last day held for a symbol (for date pickers). */
export async function heldRange(symbol: string): Promise<{ first: string; last: string } | null> {
  const [r] = await readOrDegrade(() => db.select({
    first: sql<string>`min(${marketChunks.period})`, last: sql<string>`max(${marketChunks.period})`,
  }).from(marketChunks).where(and(eq(marketChunks.symbol, symbol), eq(marketChunks.resolution, "tick"))), []);
  return r?.first && r?.last ? { first: r.first, last: r.last } : null;
}

/** A random held weekday, optionally between two days (YYYY-MM-DD). */
export async function randomHeldDay(symbol: string, from?: string, to?: string): Promise<string | null> {
  const cond = [eq(marketChunks.symbol, symbol), eq(marketChunks.resolution, "tick"),
    sql`extract(isodow from ${marketChunks.period}::date) between 1 and 5`];
  if (from) cond.push(sql`${marketChunks.period} >= ${from}`);
  if (to) cond.push(sql`${marketChunks.period} <= ${to}`);
  const [r] = await readOrDegrade(() => db.select({ period: marketChunks.period }).from(marketChunks)
    .where(and(...cond)).orderBy(sql`random()`).limit(1), []);
  return r?.period ?? null;
}
