"use client";

import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Drawing } from "@/lib/core/types";
import { colorToken, magnet } from "@/lib/core/drawings";

export type Tool = "level" | "zone" | "box" | "trend" | "note";

/** A drawing as placed, before it has an id, a name or a colour. */
export type NewDrawing =
  | { kind: "level" | "zone"; low: number; high: number }
  | { kind: "box" | "trend"; t1: number; p1: number; t2: number; p2: number }
  | { kind: "note"; t1: number; p1: number };

/** Where prices and times sit on screen right now. Pane pixels, origin top-left. */
export interface Geom {
  rightPad: number;
  paneW: number;
  paneH: number;
  /** Pixels per candle. */
  spacing: number;
  x: (t: number) => number;
  y: (p: number) => number | null;
  /** Fractional candle index under an x position. */
  idx: (x: number) => number;
  price: (y: number) => number | null;
  /** Open time of the candle at an index (rounded). */
  time: (i: number) => number;
  /** Fractional candle index of a time. */
  tIdx: (t: number) => number;
  bar: (i: number) => { open: number; high: number; low: number; close: number } | undefined;
}

type Handle = "a" | "b" | "body";
interface Drag {
  id: string;
  handle: Handle;
  start: { i: number; p: number };
  orig: Drawing;
  live: Drawing;
  moved: boolean;
}

const HIT = 16; // a fingertip, in pixels, around every line that can be tapped

/**
 * The trader's mark-up, drawn over the chart.
 *
 * SVG for the shapes, HTML for the words, both positioned from prices and
 * candle times on every pan and zoom. Only the edges of a zone or box can be
 * tapped, never the inside: a band across the whole chart that swallowed
 * touches would make the chart impossible to scroll anywhere inside it.
 *
 * A tap selects; a selected drawing shows round handles that drag its corners
 * or ends, and its outline drags the whole thing. Nothing is saved from here —
 * the finished position is handed up once the finger lifts.
 */
export function DrawingLayer({
  geom, drawings, tool, draft, hover, selected, onSelect, onMove, decimals,
}: {
  geom: Geom;
  drawings: Drawing[];
  tool: Tool | null;
  draft: { t: number; p: number } | null;
  hover: { t: number; p: number } | null;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onMove: (d: Drawing) => void;
  decimals: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  // With a tool in hand every tap belongs to the chart underneath.
  const live = !tool;
  const { paneW, paneH } = geom;

  const local = (e: ReactPointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  function begin(e: ReactPointerEvent, d: Drawing, handle: Handle) {
    if (!live || d.id !== selected) return;
    const { x, y } = local(e);
    const p = geom.price(y);
    if (p === null) return;
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    setDrag({ id: d.id, handle, start: { i: geom.idx(x), p }, orig: d, live: d, moved: false });
  }

  function move(e: ReactPointerEvent) {
    if (!drag) return;
    const { x, y } = local(e);
    const i = geom.idx(x), p = geom.price(y);
    if (p === null) return;
    setDrag({ ...drag, live: moved(drag, i, p), moved: true });
  }

  function end() {
    if (!drag) return;
    if (drag.moved) onMove(normalise(drag.live));
    setDrag(null);
  }

  function moved(d: Drag, i: number, p: number): Drawing {
    const o = d.orig;
    if (d.handle === "body") {
      const dI = Math.round(i - d.start.i), dP = p - d.start.p;
      const shift = (t: number) => geom.time(Math.round(geom.tIdx(t)) + dI);
      switch (o.kind) {
        case "level": return { ...o, low: o.low + dP, high: o.high + dP };
        case "zone": return { ...o, low: o.low + dP, high: o.high + dP };
        case "box": case "trend":
          return { ...o, t1: shift(o.t1), p1: o.p1 + dP, t2: shift(o.t2), p2: o.p2 + dP };
        case "note": return { ...o, t1: shift(o.t1), p1: o.p1 + dP };
      }
    }
    const at = Math.round(i);
    const T = geom.time(at);
    const P = magnet(p, geom.bar(at), geom.y);
    switch (o.kind) {
      case "level": return { ...o, low: P, high: P };
      case "zone": return d.handle === "a" ? { ...o, high: P } : { ...o, low: P };
      case "box": case "trend":
        return d.handle === "a" ? { ...o, t1: T, p1: P } : { ...o, t2: T, p2: P };
      case "note": return { ...o, t1: T, p1: P };
    }
  }

  const shown = drawings.map((d) => (drag && d.id === drag.id ? drag.live : d));
  const hitStyle = { pointerEvents: live ? ("stroke" as const) : ("none" as const), cursor: "pointer" };
  const pick = (d: Drawing) => (e: React.MouseEvent) => { if (!live) return; e.stopPropagation(); onSelect(d.id); };

  const shapes: React.ReactNode[] = [];
  const words: React.ReactNode[] = [];
  const handles: React.ReactNode[] = [];

  const handle = (d: Drawing, h: Handle, x: number, y: number, color: string) => (
    <g key={`${d.id}-${h}`}>
      <circle cx={x} cy={y} r={6.5} fill="var(--s1)" stroke={color} strokeWidth={2} pointerEvents="none" />
      <circle cx={x} cy={y} r={HIT} fill="transparent"
              style={{ pointerEvents: "all", cursor: "grab", touchAction: "none" }}
              onPointerDown={(e) => begin(e, d, h)} onPointerMove={move} onPointerUp={end} onPointerCancel={end} />
    </g>
  );
  // The outline of a selected drawing moves the whole thing.
  const bodyProps = (d: Drawing) => (d.id === selected && live
    ? { style: { pointerEvents: "stroke" as const, cursor: "move", touchAction: "none" as const },
        onPointerDown: (e: ReactPointerEvent) => begin(e, d, "body"), onPointerMove: move, onPointerUp: end, onPointerCancel: end }
    : { style: hitStyle });

  const tag = (d: Drawing, left: number, top: number, color: string) =>
    d.label ? (
      <button key={`${d.id}-tag`} type="button" onClick={pick(d)} tabIndex={-1}
              className="absolute whitespace-nowrap rounded px-1 text-[9.5px] font-bold uppercase tracking-wide before:absolute before:-inset-x-1 before:-inset-y-2.5 before:content-['']"
              style={{
                left, top, color, pointerEvents: live ? "auto" : "none", lineHeight: "12px",
                // A backing, so the words stay readable over candles and over each other.
                background: "color-mix(in srgb, var(--s1) 82%, transparent)",
              }}>
        {d.label}
      </button>
    ) : null;

  for (const d of shown) {
    const color = `var(${colorToken(d.color)})`;
    const sel = d.id === selected;
    const w = sel ? 2 : 1.25;

    if (d.kind === "level") {
      const y = geom.y(d.low);
      if (y === null) continue;
      shapes.push(
        <g key={d.id}>
          <line x1={0} x2={paneW} y1={y} y2={y} stroke={color} strokeWidth={w} strokeDasharray="6 4" pointerEvents="none" />
          <line x1={0} x2={paneW} y1={y} y2={y} stroke="transparent" strokeWidth={HIT} onClick={pick(d)} {...bodyProps(d)} />
        </g>,
      );
      words.push(tag(d, 4, y - 14, color));
      if (sel) handles.push(handle(d, "a", paneW / 2, y, color));
    } else if (d.kind === "zone") {
      const yT = geom.y(Math.max(d.low, d.high)), yB = geom.y(Math.min(d.low, d.high));
      if (yT === null || yB === null) continue;
      const top = Math.min(yT, yB), h = Math.max(2, Math.abs(yB - yT));
      shapes.push(
        <g key={d.id}>
          <rect x={0} y={top} width={paneW} height={h} fill={color} fillOpacity={0.13} pointerEvents="none" />
          <line x1={0} x2={paneW} y1={top} y2={top} stroke={color} strokeWidth={w} strokeDasharray="6 4" pointerEvents="none" />
          <line x1={0} x2={paneW} y1={top + h} y2={top + h} stroke={color} strokeWidth={w} strokeDasharray="6 4" pointerEvents="none" />
          <rect x={0} y={top} width={paneW} height={h} fill="none" stroke="transparent" strokeWidth={HIT}
                onClick={pick(d)} {...bodyProps(d)} />
        </g>,
      );
      words.push(tag(d, 4, top + 2, color));
      if (sel) {
        handles.push(handle(d, "a", paneW / 2, yT, color));
        handles.push(handle(d, "b", paneW / 2, yB, color));
      }
    } else if (d.kind === "box" || d.kind === "trend") {
      const xa = geom.x(d.t1), xb = geom.x(d.t2);
      const ya = geom.y(d.p1), yb = geom.y(d.p2);
      if (ya === null || yb === null) continue;
      if (d.kind === "box") {
        const left = Math.min(xa, xb), right = d.extend ? paneW + HIT : Math.max(xa, xb);
        const top = Math.min(ya, yb), h = Math.max(2, Math.abs(yb - ya));
        shapes.push(
          <g key={d.id}>
            <rect x={left} y={top} width={Math.max(2, right - left)} height={h} fill={color} fillOpacity={0.13}
                  stroke={color} strokeWidth={w} rx={2} pointerEvents="none" />
            <rect x={left} y={top} width={Math.max(2, right - left)} height={h} fill="none" stroke="transparent"
                  strokeWidth={HIT} onClick={pick(d)} {...bodyProps(d)} />
          </g>,
        );
        words.push(tag(d, left + 4, top + 2, color));
      } else {
        // A ray carries on past its second point to the edge of the chart.
        let ex = xb, ey = yb;
        if (d.extend && xb !== xa) {
          const dir = xb > xa ? 1 : -1;
          ex = dir > 0 ? paneW + HIT : -HIT;
          ey = ya + ((yb - ya) / (xb - xa)) * (ex - xa);
        }
        shapes.push(
          <g key={d.id}>
            <line x1={xa} y1={ya} x2={ex} y2={ey} stroke={color} strokeWidth={w + 0.5} strokeLinecap="round" pointerEvents="none" />
            <line x1={xa} y1={ya} x2={ex} y2={ey} stroke="transparent" strokeWidth={HIT} strokeLinecap="round"
                  onClick={pick(d)} {...bodyProps(d)} />
          </g>,
        );
        words.push(tag(d, Math.max(xa, xb) + 6, (xb >= xa ? yb : ya) - 14, color));
      }
      if (sel) {
        handles.push(handle(d, "a", xa, ya, color));
        handles.push(handle(d, "b", xb, yb, color));
      }
    } else if (d.kind === "note") {
      const x = geom.x(d.t1), y = geom.y(d.p1);
      if (y === null) continue;
      // Above the candle unless that would run off the top; to the left of the
      // pin when it sits near the right edge, so the words stay on screen.
      const below = y < 64;
      const flip = x > paneW - 150;
      shapes.push(
        <g key={d.id} pointerEvents="none">
          <line x1={x} y1={y} x2={x} y2={below ? y + 10 : y - 10} stroke={color} strokeWidth={1.5} />
          <circle cx={x} cy={y} r={sel ? 5 : 4} fill={color} stroke="var(--s1)" strokeWidth={1.5} />
        </g>,
      );
      words.push(
        <button key={`${d.id}-note`} type="button" onClick={pick(d)} tabIndex={-1}
                className="absolute max-w-[180px] rounded-lg px-2 py-1 text-left text-[11px] font-medium leading-snug"
                style={{
                  left: x, top: y,
                  transform: `translate(${flip ? "calc(-100% + 12px)" : "-12px"}, ${below ? "10px" : "calc(-100% - 10px)"})`,
                  background: "var(--s1)", color: d.label ? "var(--ink)" : "var(--ink3)",
                  border: `${sel ? 2 : 1.5}px solid ${color}`,
                  boxShadow: "0 2px 8px rgb(0 0 0 / 0.12)",
                  pointerEvents: live ? "auto" : "none",
                }}>
          {/* Clamped on an inner box: clamping the padded one lets a sliver of
              the fourth line show through the bottom padding. */}
          <span style={{ display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
            {d.label || "New note"}
          </span>
        </button>,
      );
      if (sel) handles.push(handle(d, "a", x, y, color));
    }
  }

  // The drawing being placed: its first point, and the shape so far.
  if (tool && draft) {
    const c = "var(--c1)";
    const xa = geom.x(draft.t), ya = geom.y(draft.p);
    const xb = hover ? geom.x(hover.t) : null, yb = hover ? geom.y(hover.p) : null;
    if (ya !== null) {
      shapes.push(<circle key="draft-a" cx={tool === "zone" ? paneW / 2 : xa} cy={ya} r={4.5} fill={c} pointerEvents="none" />);
      if (yb !== null && xb !== null) {
        if (tool === "zone") {
          shapes.push(<rect key="draft" x={0} y={Math.min(ya, yb)} width={paneW} height={Math.abs(yb - ya)}
                            fill={c} fillOpacity={0.1} stroke={c} strokeDasharray="4 4" pointerEvents="none" />);
        } else if (tool === "box") {
          shapes.push(<rect key="draft" x={Math.min(xa, xb)} y={Math.min(ya, yb)} width={Math.abs(xb - xa)}
                            height={Math.abs(yb - ya)} fill={c} fillOpacity={0.1} stroke={c} strokeDasharray="4 4"
                            pointerEvents="none" />);
        } else if (tool === "trend") {
          shapes.push(<line key="draft" x1={xa} y1={ya} x2={xb} y2={yb} stroke={c} strokeWidth={1.5}
                            strokeDasharray="4 4" pointerEvents="none" />);
        }
      }
    }
  }

  return (
    <div ref={box} className="pointer-events-none absolute left-0 top-0 overflow-hidden"
         style={{ width: paneW, height: paneH }} aria-hidden={drawings.length === 0}>
      <svg width={paneW} height={paneH} className="absolute inset-0" style={{ overflow: "hidden" }}>
        {shapes}
        {handles}
      </svg>
      {words}
      {selected && live && (() => {
        // Price of the selected line, at the right edge, for drawings that are one.
        const d = shown.find((x) => x.id === selected);
        if (!d || d.kind !== "level") return null;
        const y = geom.y(d.low);
        return y === null ? null : (
          <span className="num absolute right-1 rounded px-1 text-[10px] font-semibold"
                style={{ top: y - 8, background: `var(${colorToken(d.color)})`, color: "#fff" }}>
            {d.low.toFixed(decimals)}
          </span>
        );
      })()}
    </div>
  );
}

/** Zones keep low under high however their edges were dragged past each other. */
function normalise(d: Drawing): Drawing {
  if (d.kind === "zone") return { ...d, low: Math.min(d.low, d.high), high: Math.max(d.low, d.high) };
  return d;
}
