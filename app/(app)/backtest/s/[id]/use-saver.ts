"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { recordSession } from "@/lib/backtest-actions";
import type { ClosedIdea, SimAction, SimState } from "@/lib/core/sim/broker";

export type SaveStatus = "idle" | "saving" | "saved" | "error" | "conflict";

interface Pending { seq: number; at: number; kind: string; payload: Record<string, unknown> }

/**
 * Saving the simulated account as it changes.
 *
 * Every action (an order placed, a stop moved) and every finished trade goes
 * into a queue; a moment later the queue is written along with a snapshot of
 * the account. One write at a time; whatever arrives during a write goes in
 * the next. A failed write is retried; a write refused because another tab
 * saved first stops the queue and asks for a reload rather than overwriting.
 */
export function useSaver(sessionId: string, version: number, eventSeq: number, snapshot: () => { state: SimState; clockSec: number }) {
  const q = useRef({ events: [] as Pending[], trades: [] as ClosedIdea[], version, seq: eventSeq, inFlight: false, timer: 0, retry: 0, dirty: false, stopped: false });
  const [status, setStatus] = useState<SaveStatus>("idle");
  const snap = useRef(snapshot);
  snap.current = snapshot;

  const flush = useCallback(async () => {
    const s = q.current;
    if (s.inFlight || s.stopped || !s.dirty) return;
    s.inFlight = true;
    window.clearTimeout(s.timer);
    try {
      while (s.dirty && !s.stopped) {
        s.dirty = false;
        const events = s.events.splice(0), trades = s.trades.splice(0);
        const { state, clockSec } = snap.current();
        setStatus("saving");
        let r;
        try {
          r = await recordSession(sessionId, { expectedVersion: s.version, clockAt: clockSec, events, state: state as unknown as Record<string, unknown>, trades });
        } catch {
          r = { ok: false as const, error: "Network" };
        }
        if (r.ok) { s.version = r.version; s.retry = 0; continue; }
        if ("conflict" in r && r.conflict) { s.stopped = true; setStatus("conflict"); return; }
        // Put it back and try again shortly, a little later each time.
        s.events.unshift(...events);
        s.trades.unshift(...trades);
        s.dirty = true;
        s.retry++;
        setStatus("error");
        s.timer = window.setTimeout(() => { void flush(); }, Math.min(30_000, 1500 * 2 ** s.retry));
        return;
      }
      setStatus("saved");
    } finally {
      s.inFlight = false;
    }
  }, [sessionId]);

  const schedule = useCallback((delay = 700) => {
    const s = q.current;
    s.dirty = true;
    window.clearTimeout(s.timer);
    s.timer = window.setTimeout(() => { void flush(); }, delay);
  }, [flush]);

  /** An action the trader took, at a replay time (ms). */
  const action = useCallback((at: number, a: SimAction) => {
    const s = q.current;
    s.events.push({ seq: ++s.seq, at, kind: a.kind, payload: a as unknown as Record<string, unknown> });
    schedule();
  }, [schedule]);

  /** Trades the account finished (by a stop, a target or by hand). */
  const finished = useCallback((ideas: ClosedIdea[]) => {
    if (!ideas.length) return;
    q.current.trades.push(...ideas);
    schedule();
  }, [schedule]);

  // Whatever is waiting goes when the page is hidden or left.
  useEffect(() => {
    const now = () => { if (q.current.dirty) void flush(); };
    const onHide = () => { if (document.visibilityState === "hidden") now(); };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", now);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", now);
      now();
    };
  }, [flush]);

  return { status, action, finished, flush, pending: () => q.current.dirty || q.current.inFlight };
}
