import type { Drawing as LegacyDrawing } from "./types";
import { drawingBand } from "./drawings";

/**
 * What is stored in trade_annotation.drawings, in either of its two shapes.
 *
 * Until October 2026 the chart had five tools of its own and stored a plain
 * array of them (`Drawing` in types.ts). It now uses the 86-tool kit
 * (lightweight-charts-drawing) and stores the kit's own JSON inside a versioned
 * document. Old rows are not rewritten in bulk: each converts the first time
 * its chart is opened and saved. Everything that READS drawings — search,
 * Levels, the "traded this band" filter — goes through the helpers here, which
 * understand both shapes, so nothing breaks in between.
 *
 * No import of the kit itself: these run on the server for every page that
 * counts or searches mark-up, and only need a drawing's kind, points and text.
 */

export interface KitDrawingLike {
  id: string;
  kind: string;
  points: ({ time: number; price: number } | null)[];
  text?: string;
  style?: { text?: string; [k: string]: unknown };
  hidden?: boolean;
  locked?: boolean;
}

export interface DrawingsDocV2 {
  v: 2;
  drawings: KitDrawingLike[];
}

export type StoredDrawings = LegacyDrawing[] | DrawingsDocV2 | null | undefined;

export const isDocV2 = (s: unknown): s is DrawingsDocV2 =>
  !!s && !Array.isArray(s) && typeof s === "object" && (s as { v?: unknown }).v === 2
  && Array.isArray((s as { drawings?: unknown }).drawings);

export const isLegacy = (s: unknown): s is LegacyDrawing[] => Array.isArray(s);

export function drawingCount(s: StoredDrawings): number {
  if (isDocV2(s)) return s.drawings.length;
  return isLegacy(s) ? s.length : 0;
}

/** Every word the trader attached to their mark-up, for search. */
export function drawingTexts(s: StoredDrawings): string[] {
  if (isDocV2(s)) return s.drawings.flatMap((d) => [d.text, d.style?.text].filter((x): x is string => !!x));
  return isLegacy(s) ? s.map((d) => d.label).filter(Boolean) : [];
}

/** Kinds that mark a price level or band — the ones Levels pools across trades. */
const LEVEL_KINDS = new Set(["horizontal-line", "horizontal-ray", "rectangle"]);

/**
 * The price bands a trade's mark-up claims, for Levels and the band filter.
 * Horizontal lines and rays are a band of zero height; a rectangle is its
 * price range. Sloped lines, fibs and notes do not say "this price", so they
 * are not pooled.
 */
export function drawingBands(s: StoredDrawings): { low: number; high: number; label: string }[] {
  if (isLegacy(s)) {
    return s.flatMap((d) => {
      const b = drawingBand(d);
      return b ? [{ ...b, label: d.label }] : [];
    });
  }
  if (!isDocV2(s)) return [];
  return s.drawings.flatMap((d) => {
    if (!LEVEL_KINDS.has(d.kind) || d.hidden) return [];
    const prices = d.points.filter((p): p is { time: number; price: number } => !!p && Number.isFinite(p.price)).map((p) => p.price);
    if (!prices.length) return [];
    const ps = d.kind === "rectangle" ? prices.slice(0, 2) : prices.slice(0, 1);
    return [{ low: Math.min(...ps), high: Math.max(...ps), label: d.style?.text || d.text || "" }];
  });
}
