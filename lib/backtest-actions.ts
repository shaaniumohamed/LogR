"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { btEvents, btPositions, btSessions, btStrategies, btTrades } from "@/lib/db/schema";
import { backtestContext, heldRange, randomHeldDay } from "@/lib/backtest-data";
import { DEFAULT_BT_SETTINGS, DEFAULT_CHART, type BtChartPrefs, type BtSettings } from "@/lib/core/backtest";
import { toDoc } from "@/lib/chart/drawings-convert";

/**
 * Changing backtests. Owners only while the backtester is new; every write is
 * scoped to the person making it, and ids from the browser are only used
 * together with their user id.
 */

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string; conflict?: boolean };
const NOT_ALLOWED = { ok: false as const, error: "The backtester is only open to owners for now." };

const Name = z.string().trim().min(1, "Give it a name.").max(80, "Keep the name under 80 characters.");

/* -------------------------------------------------------------- strategies */

export async function createStrategy(_prev: { error?: string; ok?: string; id?: string } | null, form: FormData): Promise<{ error?: string; ok?: string; id?: string }> {
  const ctx = await backtestContext();
  if (!ctx) return { error: NOT_ALLOWED.error };
  const name = Name.safeParse(form.get("name"));
  if (!name.success) return { error: name.error.issues[0].message };
  const description = String(form.get("description") ?? "").trim().slice(0, 2000) || null;
  const setup = String(form.get("setup") ?? "").trim().slice(0, 80) || null;
  const [row] = await db.insert(btStrategies).values({ userId: ctx.userId, name: name.data, description, setup }).returning({ id: btStrategies.id });
  revalidatePath("/backtest");
  return { ok: "Strategy created.", id: row.id };
}

const StrategyPatch = z.object({
  name: Name.optional(),
  description: z.string().max(2000).nullable().optional(),
  setup: z.string().max(80).nullable().optional(),
  rules: z.array(z.string().trim().min(1).max(200)).max(30).optional(),
  archived: z.boolean().optional(),
});

export async function updateStrategy(id: string, patch: z.input<typeof StrategyPatch>): Promise<Result> {
  const ctx = await backtestContext();
  if (!ctx) return NOT_ALLOWED;
  const p = StrategyPatch.safeParse(patch);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const done = await db.update(btStrategies).set({ ...p.data, updatedAt: new Date() })
    .where(and(eq(btStrategies.id, id), eq(btStrategies.userId, ctx.userId))).returning({ id: btStrategies.id });
  if (!done.length) return { ok: false, error: "No such strategy." };
  revalidatePath("/backtest");
  return { ok: true };
}

export async function deleteStrategy(id: string): Promise<Result> {
  const ctx = await backtestContext();
  if (!ctx) return NOT_ALLOWED;
  await db.delete(btStrategies).where(and(eq(btStrategies.id, id), eq(btStrategies.userId, ctx.userId)));
  revalidatePath("/backtest");
  return { ok: true };
}

/* ---------------------------------------------------------------- sessions */

const Settings = z.object({
  balance: z.number().min(10).max(100_000_000),
  leverage: z.number().int().min(1).max(5000),
  commissionPerLot: z.number().min(0).max(1000),
  spread: z.union([
    z.object({ mode: z.literal("recorded") }),
    z.object({ mode: z.literal("fixed"), value: z.number().min(0).max(100) }),
    z.object({ mode: z.literal("minus"), value: z.number().min(0).max(100) }),
  ]),
  slippage: z.number().min(0).max(100),
  swapLong: z.number().min(-10_000).max(10_000),
  swapShort: z.number().min(-10_000).max(10_000),
  stopOutLevel: z.number().min(0).max(1000),
}).partial();

const NewSession = z.object({
  strategyId: z.string().min(1),
  name: z.string().trim().max(80).optional(),
  start: z.union([
    z.object({ at: z.number().int().positive() }),
    z.object({ random: z.literal(true), from: z.string().optional(), to: z.string().optional() }),
  ]),
  settings: Settings.optional(),
  timeframe: z.string().max(4).optional(),
});

export async function createSession(input: z.input<typeof NewSession>): Promise<Result<{ id: string }>> {
  const ctx = await backtestContext();
  if (!ctx) return NOT_ALLOWED;
  const p = NewSession.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const [strategy] = await db.select({ id: btStrategies.id }).from(btStrategies)
    .where(and(eq(btStrategies.id, p.data.strategyId), eq(btStrategies.userId, ctx.userId)));
  if (!strategy) return { ok: false, error: "No such strategy." };

  const range = await heldRange("XAUUSD");
  if (!range) return { ok: false, error: "There is no price history yet. Import it under Settings → Price history." };
  let at: number;
  if ("at" in p.data.start) {
    at = p.data.start.at;
    const first = Date.parse(`${range.first}T00:00:00Z`) / 1000, last = Date.parse(`${range.last}T23:59:59Z`) / 1000;
    if (at < first || at > last) return { ok: false, error: `Pick a moment between ${range.first} and ${range.last}.` };
  } else {
    const day = await randomHeldDay("XAUUSD", p.data.start.from, p.data.start.to);
    if (!day) return { ok: false, error: "No trading day is held in that range." };
    at = Date.parse(`${day}T00:00:00Z`) / 1000;
  }

  const settings: BtSettings = { ...DEFAULT_BT_SETTINGS, ...(p.data.settings ?? {}) } as BtSettings;
  const start = new Date(at * 1000);
  const name = p.data.name?.trim()
    || `From ${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: ctx.timeZone }).format(start)}`;
  const [row] = await db.insert(btSessions).values({
    userId: ctx.userId, strategyId: strategy.id, name, startedAt: start, clockAt: start,
    timeframe: p.data.timeframe ?? "5m", chart: DEFAULT_CHART, settings,
  }).returning({ id: btSessions.id });
  revalidatePath("/backtest");
  return { ok: true, id: row.id };
}

export async function deleteSession(id: string): Promise<Result> {
  const ctx = await backtestContext();
  if (!ctx) return NOT_ALLOWED;
  await db.delete(btSessions).where(and(eq(btSessions.id, id), eq(btSessions.userId, ctx.userId)));
  revalidatePath("/backtest");
  return { ok: true };
}

const Indicator = z.object({ id: z.string().max(40), kind: z.enum(["ema", "sma", "vwap"]), period: z.number().int().min(1).max(1000), color: z.string().max(20) });
const ChartPrefs = z.object({
  type: z.enum(["candles", "line"]), volume: z.boolean(), sessions: z.boolean(), news: z.enum(["off", "high", "medium"]),
  indicators: z.array(Indicator).max(10),
});
const View = z.object({
  clockAt: z.number().int().positive(),
  timeframe: z.string().max(4),
  chart: ChartPrefs.optional(),
  name: z.string().trim().min(1).max(80).optional(),
  notes: z.string().max(10_000).optional(),
  status: z.enum(["active", "finished"]).optional(),
});

/** Where the replay is and how the chart is set up. Saved often; never touches the account. */
export async function saveSessionView(id: string, view: z.input<typeof View>): Promise<Result> {
  const ctx = await backtestContext();
  if (!ctx) return NOT_ALLOWED;
  const p = View.safeParse(view);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const { clockAt, chart, ...rest } = p.data;
  const done = await db.update(btSessions).set({
    clockAt: new Date(clockAt * 1000), ...(chart ? { chart: chart as BtChartPrefs } : {}), ...rest, updatedAt: new Date(),
  }).where(and(eq(btSessions.id, id), eq(btSessions.userId, ctx.userId))).returning({ id: btSessions.id });
  return done.length ? { ok: true } : { ok: false, error: "No such session." };
}

export async function saveSessionDrawings(id: string, drawings: unknown, times: Record<string, number>): Promise<Result> {
  const ctx = await backtestContext();
  if (!ctx) return NOT_ALLOWED;
  const doc = toDoc(drawings);
  const keep = new Set(doc.drawings.map((d) => d.id));
  const cleanTimes = Object.fromEntries(Object.entries(times ?? {}).filter(([k, v]) => keep.has(k) && Number.isFinite(v)));
  const done = await db.update(btSessions).set({ drawings: doc, drawingTimes: cleanTimes, updatedAt: new Date() })
    .where(and(eq(btSessions.id, id), eq(btSessions.userId, ctx.userId))).returning({ id: btSessions.id });
  return done.length ? { ok: true } : { ok: false, error: "No such session." };
}

/* ------------------------------------------------------- the simulated account */

const Leg = z.object({
  ticket: z.string().max(40), positionId: z.string().max(40), ideaId: z.string().max(40),
  direction: z.enum(["long", "short"]), lots: z.number().positive().max(10_000),
  openedAt: z.number(), closedAt: z.number(), openPrice: z.number(), closePrice: z.number(),
  stopLoss: z.number().nullable(), takeProfit: z.number().nullable(),
  commission: z.number(), swap: z.number(), profit: z.number(),
  closeReason: z.enum(["user", "tp", "sl", "so", "unknown"]),
});
const Trade = z.object({
  id: z.string().max(40), side: z.enum(["buy", "sell"]), legs: z.array(Leg).min(1).max(500),
  openedAt: z.number(), closedAt: z.number(), pnl: z.number(), risk: z.number().nullable(), r: z.number().nullable(),
});
const Record_ = z.object({
  expectedVersion: z.number().int().min(0),
  clockAt: z.number().int().positive(),
  events: z.array(z.object({
    seq: z.number().int().positive(), at: z.number(), kind: z.string().max(24), payload: z.record(z.string(), z.unknown()),
  })).max(500),
  state: z.record(z.string(), z.unknown()),
  trades: z.array(Trade).max(200),
});

/**
 * Save what happened in the account: the actions taken, the trades they
 * finished and the account as it now stands.
 *
 * The trades and actions are written first and are safe to write twice (each
 * is keyed); the account is written last and only if nobody else saved it in
 * the meantime — a second tab open on the same session gets told to reload
 * rather than overwriting the first.
 */
export async function recordSession(id: string, payload: z.input<typeof Record_>): Promise<Result<{ version: number }>> {
  const ctx = await backtestContext();
  if (!ctx) return NOT_ALLOWED;
  const p = Record_.safeParse(payload);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  if (JSON.stringify(p.data.state).length > 1_000_000) return { ok: false, error: "The account is too large to save." };
  const [session] = await db.select({ id: btSessions.id, strategyId: btSessions.strategyId, version: btSessions.version })
    .from(btSessions).where(and(eq(btSessions.id, id), eq(btSessions.userId, ctx.userId)));
  if (!session) return { ok: false, error: "No such session." };
  if (session.version !== p.data.expectedVersion) return { ok: false, conflict: true, error: "This session was saved from another tab. Reload to carry on from there." };

  if (p.data.events.length) {
    await db.insert(btEvents).values(p.data.events.map((e) => ({
      sessionId: id, userId: ctx.userId, seq: e.seq, at: new Date(e.at), kind: e.kind, payload: e.payload,
    }))).onConflictDoNothing();
  }

  for (const t of p.data.trades) {
    const lots = t.legs.reduce((a, l) => a + l.lots, 0);
    const avg = (f: (l: z.infer<typeof Leg>) => number) => t.legs.reduce((a, l) => a + f(l) * l.lots, 0) / lots;
    const [row] = await db.insert(btTrades).values({
      userId: ctx.userId, sessionId: id, strategyId: session.strategyId, ideaId: t.id,
      direction: t.side === "buy" ? "long" : "short",
      openedAt: new Date(t.openedAt), closedAt: new Date(t.closedAt),
      lots: Math.round(lots * 100) / 100, avgEntry: avg((l) => l.openPrice), avgExit: avg((l) => l.closePrice),
      pnl: t.pnl, risk: t.risk, r: t.r, legs: t.legs.length, closeReasons: [...new Set(t.legs.map((l) => l.closeReason))],
    }).onConflictDoNothing({ target: [btTrades.sessionId, btTrades.ideaId] }).returning({ id: btTrades.id });
    if (!row) continue; // already saved by an earlier attempt
    await db.insert(btPositions).values(t.legs.map((l) => ({
      userId: ctx.userId, sessionId: id, tradeId: row.id, ticket: l.ticket, direction: l.direction, lots: l.lots,
      openedAt: new Date(l.openedAt), closedAt: new Date(l.closedAt), openPrice: l.openPrice, closePrice: l.closePrice,
      stopLoss: l.stopLoss, takeProfit: l.takeProfit, commission: l.commission, swap: l.swap, profit: l.profit, closeReason: l.closeReason,
    })));
  }

  const lastSeq = p.data.events.reduce((m, e) => Math.max(m, e.seq), 0);
  const done = await db.update(btSessions).set({
    state: p.data.state, clockAt: new Date(p.data.clockAt * 1000),
    eventSeq: sql`greatest(${btSessions.eventSeq}, ${lastSeq})`,
    version: sql`${btSessions.version} + 1`, updatedAt: new Date(),
  }).where(and(eq(btSessions.id, id), eq(btSessions.userId, ctx.userId), eq(btSessions.version, p.data.expectedVersion)))
    .returning({ version: btSessions.version });
  if (!done.length) return { ok: false, conflict: true, error: "This session was saved from another tab. Reload to carry on from there." };
  return { ok: true, version: done[0].version };
}

/** A random held weekday for a "random date" jump. */
export async function randomDay(from?: string, to?: string): Promise<Result<{ day: string }>> {
  const ctx = await backtestContext();
  if (!ctx) return NOT_ALLOWED;
  const day = await randomHeldDay("XAUUSD", from, to);
  return day ? { ok: true, day } : { ok: false, error: "No trading day is held in that range." };
}
