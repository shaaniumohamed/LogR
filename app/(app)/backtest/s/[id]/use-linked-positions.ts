"use client";

import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import type { Drawing } from "lightweight-charts-drawing";
import type { SimAction, SimEvent } from "@/lib/core/sim/broker";
import type { BtLink } from "@/lib/core/backtest";
import type { Replay } from "@/lib/market/replay";
import type { DrawingApi } from "@/components/chart/drawing-system";
import { desiredDrawing, frozenDrawing, intentFromChange, type LinkedTrade } from "@/lib/chart/linked-position";

const isPosition = (d: Drawing) => d.kind === "long-position" || d.kind === "short-position";

/**
 * Long/Short Position drawings tied to the orders they placed.
 *
 * Two directions, never a loop:
 *  - The trader drags the drawing → once the gesture ends, the change becomes
 *    an order change (a stop or target edge → that level; a pending order's
 *    entry → the whole setup). Undo and redo never reach the broker: they
 *    restore an old picture, and the broker's truth is put back over it.
 *  - The trade changes (dragged on its lines, filled, trailed) → the drawing
 *    is rewritten, but only when it actually differs, and flagged so the
 *    write is not mistaken for the trader's own.
 *
 * When the trade closes the drawing stays, locked, stretched to the exit, as
 * a record of the plan against what happened.
 */
export function useLinkedPositions(o: {
  replay: MutableRefObject<Replay | null>;
  links: Record<string, BtLink>;
  setLinks: (next: Record<string, BtLink>) => void;
  act: (a: SimAction) => string | null;
  toast: (text: string, tone?: "info" | "error") => void;
  /** Settings a new position drawing starts with, so its Qty reads in lots for this account. */
  prefill: () => Partial<Drawing["style"]>;
  /** A replay time (ms) as the candle time it falls in on the chart. */
  candleTime: (ms: number) => number;
}) {
  const api = useRef<DrawingApi | null>(null);
  const linksRef = useRef(o.links);
  linksRef.current = o.links;
  const opts = useRef(o);
  opts.current = o;
  const syncing = useRef(false);
  const pending = useRef(new Map<string, { start: Drawing; latest: Drawing }>());
  const pointerDown = useRef(false);
  const quiet = useRef(0);
  const offs = useRef<(() => void)[]>([]);
  const frame = useRef(0);

  const write = useCallback((d: Drawing) => {
    const a = api.current;
    if (!a) return;
    syncing.current = true;
    try { a.applyExternal(d); } finally { syncing.current = false; }
  }, []);

  /** The trade a link points at, as the broker has it now; null once it is gone. */
  const tradeFor = useCallback((l: BtLink): LinkedTrade | null => {
    const s = opts.current.replay.current?.broker.state;
    if (!s) return null;
    const p = s.positions.find((x) => x.id === l.orderId);
    if (p) return { id: p.id, side: p.side, kind: "position", entry: p.openPrice, sl: p.sl, tp: p.tp };
    const ord = s.orders.find((x) => x.id === l.orderId);
    if (ord) return { id: ord.id, side: ord.side, kind: "order", entry: ord.price, sl: ord.sl, tp: ord.tp };
    return null;
  }, []);

  const update = useCallback((fn: (links: Record<string, BtLink>) => Record<string, BtLink> | null) => {
    const next = fn({ ...linksRef.current });
    if (next) { linksRef.current = next; opts.current.setLinks(next); }
  }, []);

  /** Put every linked drawing back in line with its trade. */
  const reconcile = useCallback(() => {
    const a = api.current;
    if (!a) return;
    let changed = false;
    const links = { ...linksRef.current };
    for (const [id, l] of Object.entries(links)) {
      if (l.frozen || pending.current.has(id)) continue;
      const d = a.dm.get(id);
      if (!d) { if (!l.detached) { links[id] = { ...l, detached: true }; changed = true; } continue; }
      if (l.detached) { links[id] = { ...l, detached: undefined }; changed = true; }
      const t = tradeFor(l);
      if (!t) { delete links[id]; changed = true; continue; }
      const want = desiredDrawing(d, t);
      if (want) write(want);
    }
    if (changed) { linksRef.current = links; opts.current.setLinks(links); }
  }, [tradeFor, write]);

  const reconcileSoon = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => reconcile());
  }, [reconcile]);

  /** The trader's change to a drawing, now that their gesture has ended. */
  const commit = useCallback((id: string) => {
    const p = pending.current.get(id);
    pending.current.delete(id);
    const l = linksRef.current[id];
    if (!p || !l || l.frozen || l.detached) return;
    const t = tradeFor(l);
    if (!t) return;
    const r = intentFromChange(p.start, p.latest, t);
    if (!r) return;
    if ("revert" in r) { opts.current.toast(r.revert); reconcileSoon(); return; }
    for (const a of r.actions) {
      const err = opts.current.act(a);
      if (err) { opts.current.toast(err, "error"); break; }
    }
    reconcileSoon();
  }, [tradeFor, reconcileSoon]);

  const commitAll = useCallback(() => { for (const id of [...pending.current.keys()]) commit(id); }, [commit]);

  const onApi = useCallback((a: DrawingApi | null) => {
    offs.current.forEach((off) => off());
    offs.current = [];
    api.current = a;
    if (!a) return;
    offs.current = [
      a.dm.on("add", (d) => {
        if (!isPosition(d) || syncing.current) return;
        // After the kit has finished adding it, within its own undo step.
        queueMicrotask(() => {
          const cur = api.current?.dm.get(d.id);
          if (cur) write({ ...cur, style: { ...cur.style, ...opts.current.prefill() } } as Drawing);
        });
      }),
      a.dm.on("update", (d, prev) => {
        if (syncing.current) return;
        const l = linksRef.current[d.id];
        if (!l || l.frozen || l.detached) return;
        const was = pending.current.get(d.id);
        pending.current.set(d.id, { start: was?.start ?? prev, latest: d });
        // Edits from the settings sheet come without a gesture: commit after a quiet moment.
        window.clearTimeout(quiet.current);
        quiet.current = window.setTimeout(() => { if (!pointerDown.current) commitAll(); }, 400);
      }),
      a.dm.on("gestureEnd", () => commitAll()),
      a.dm.on("remove", (d) => {
        if (syncing.current) return;
        const l = linksRef.current[d.id];
        if (!l) return;
        pending.current.delete(d.id);
        update((links) => {
          if (l.frozen) { delete links[d.id]; return links; }
          links[d.id] = { ...l, detached: true };
          return links;
        });
      }),
      // Undo, redo, the objects list: restored pictures get the broker's truth back.
      a.dm.on("change", () => { if (!syncing.current) reconcileSoon(); }),
    ];
    reconcileSoon();
  }, [commitAll, reconcileSoon, update, write]);

  useEffect(() => {
    const down = () => { pointerDown.current = true; };
    const up = () => { pointerDown.current = false; };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
      window.clearTimeout(quiet.current);
      cancelAnimationFrame(frame.current);
      offs.current.forEach((off) => off());
    };
  }, []);

  /** What the account did: a closed trade freezes its drawing; a cancelled order lets it go. */
  const onSim = useCallback((events: SimEvent[]) => {
    const a = api.current;
    let touched = false;
    const links = { ...linksRef.current };
    for (const e of events) {
      if (e.kind === "cancel") {
        for (const [id, l] of Object.entries(links)) if (l.orderId === e.orderId && !l.frozen) { delete links[id]; touched = true; }
      } else if (e.kind === "idea") {
        for (const [id, l] of Object.entries(links)) {
          if (l.ideaId !== e.idea.id || l.frozen) continue;
          const d = a?.dm.get(id);
          if (d) write(frozenDrawing(d, opts.current.candleTime(e.idea.closedAt)));
          if (d) links[id] = { ...l, frozen: true, detached: undefined }; else delete links[id];
          touched = true;
        }
      }
    }
    if (touched) { linksRef.current = links; opts.current.setLinks(links); }
    reconcileSoon();
  }, [reconcileSoon, write]);

  const link = useCallback((drawingId: string, l: BtLink) => update((links) => { links[drawingId] = l; return links; }), [update]);
  const unlink = useCallback((drawingId: string) => update((links) => { delete links[drawingId]; return links; }), [update]);

  /** Remove every closed trade's drawing from the chart. */
  const removeFrozen = useCallback(() => {
    const a = api.current;
    update((links) => {
      for (const [id, l] of Object.entries(links)) {
        if (!l.frozen) continue;
        syncing.current = true;
        try { a?.removeExternal(id); } finally { syncing.current = false; }
        delete links[id];
      }
      return links;
    });
  }, [update]);

  /** A trade's id is linked to a live drawing (its stop and target are the drawing's edges). */
  const drawsTrade = useCallback((orderId: string) => {
    for (const l of Object.values(linksRef.current)) if (l.orderId === orderId && !l.frozen && !l.detached) return true;
    return false;
  }, []);

  return { onApi, reconcile, reconcileSoon, onSim, link, unlink, removeFrozen, drawsTrade, api };
}
