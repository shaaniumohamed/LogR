import { buildNewDrawing, defaultStyleFor, parseDrawings, type Drawing, type DrawingKind } from "lightweight-charts-drawing";
import type { Drawing as LegacyDrawing } from "@/lib/core/types";
import { isDocV2, isLegacy, type DrawingsDocV2, type StoredDrawings } from "@/lib/core/drawings-doc";
import { COLOURS } from "@/lib/chart/kit";

/**
 * Old five-tool mark-up into the kit's drawings, and back out as a document.
 *
 * The old tools were designed around the same ideas, so each has a natural
 * equivalent: a line is a horizontal line, a zone (a band across the whole
 * chart) is a rectangle extended both ways, a box is a rectangle, a trend line
 * is a trend line (a ray when it was extended), and a note pinned to a candle
 * is a callout pointing at it. Names become the drawings' own text, so search
 * and Levels keep finding them.
 */

/** Things the kit does not allow us to keep — they need host input this app does not offer yet. */
const NOT_STORED = new Set(["image", "table", "font-icon"]);
export const MAX_DRAWINGS = 300;

function make(kind: DrawingKind, points: { time: number; price: number }[], id: string, colour: string, text?: string, extra: Record<string, unknown> = {}): Drawing | null {
  const nd = buildNewDrawing(kind, points as unknown as Parameters<typeof buildNewDrawing>[1]);
  if (!nd) return null;
  const style = { ...defaultStyleFor(kind), color: colour, ...extra, ...(text ? { text } : {}) };
  return { ...nd, id, style } as unknown as Drawing;
}

/**
 * `span` is the trade's window in epoch seconds; zones that used to run the
 * full width of the chart are anchored inside it and extended both ways.
 */
export function legacyToKit(list: LegacyDrawing[], span: { from: number; to: number }): Drawing[] {
  const out: Drawing[] = [];
  for (const d of list) {
    const colour = COLOURS[d.color ?? "amber"];
    let made: Drawing | null = null;
    switch (d.kind) {
      case "level":
        made = make("horizontal-line", [{ time: span.from, price: d.low }], d.id, colour, d.label);
        break;
      case "zone":
        made = make("rectangle", [{ time: span.from, price: d.high }, { time: span.to, price: d.low }], d.id, colour, d.label,
          { extendLeft: true, extendRight: true, backgroundColor: colour, transparency: 85, width: 1 });
        break;
      case "box":
        made = make("rectangle", [{ time: d.t1, price: d.p1 }, { time: d.t2, price: d.p2 }], d.id, colour, d.label,
          { extendRight: !!d.extend, backgroundColor: colour, transparency: 85, width: 1 });
        break;
      case "trend":
        made = make(d.extend ? "ray" : "trend-line", [{ time: d.t1, price: d.p1 }, { time: d.t2, price: d.p2 }], d.id, colour, d.label);
        break;
      case "note": {
        // The callout's second point is where its text box sits: just above the
        // candle. Smaller, wrapped and nearly solid, so a sentence reads as a
        // note rather than a banner across the candles.
        made = make("callout", [{ time: d.t1, price: d.p1 }, { time: d.t1, price: d.p1 * 1.0015 }], d.id, colour, undefined,
          { backgroundColor: colour, transparency: 10, fontSize: 11, wordWrap: true, wordWrapWidth: 160 });
        if (made) made = { ...made, text: d.label } as Drawing;
        break;
      }
    }
    if (made) out.push(made);
  }
  return out;
}

/** Whatever is stored, as drawings the kit can load. */
export function toKit(stored: StoredDrawings, span: { from: number; to: number }): Drawing[] {
  if (isDocV2(stored)) return parseDrawings(stored.drawings);
  if (isLegacy(stored)) return legacyToKit(stored, span);
  return [];
}

/**
 * The kit's drawings as the document the server stores — validated by the
 * kit's own parser, without the kinds this app cannot store, and capped.
 * Used on the server before writing, so a browser cannot store something the
 * chart would choke on next time.
 */
export function toDoc(input: unknown): DrawingsDocV2 {
  const raw = Array.isArray(input) ? input : isDocV2(input) ? input.drawings : [];
  const parsed = parseDrawings(raw).filter((d) => !NOT_STORED.has(d.kind)).slice(0, MAX_DRAWINGS);
  return { v: 2, drawings: JSON.parse(JSON.stringify(parsed)) };
}
