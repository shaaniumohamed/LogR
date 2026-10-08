import type { DrawingKind } from "lightweight-charts-drawing";
import type { DrawColor } from "@/lib/core/types";
import { DRAWING_PRESETS } from "@/lib/core/taxonomy";

/**
 * The drawing tools, as the trader sees them.
 *
 * The kit (lightweight-charts-drawing, MIT) provides 86 TradingView-style
 * tools under machine names. This is the human side: TradingView's own
 * grouping and names, so anyone who has used TradingView finds a tool where
 * they expect it, plus the short list of favourites shown without opening
 * anything.
 *
 * Three tools are left out until the host can supply what they wait for: an
 * image (an upload), a table (a cell editor) and a font icon (a glyph picker).
 */

export interface ToolDef {
  kind: DrawingKind;
  label: string;
}

export interface ToolGroup {
  id: string;
  label: string;
  sections: { label: string; tools: ToolDef[] }[];
}

const t = (kind: DrawingKind, label: string): ToolDef => ({ kind, label });

export const TOOL_GROUPS: ToolGroup[] = [
  {
    id: "lines", label: "Lines",
    sections: [
      { label: "Lines", tools: [
        t("trend-line", "Trend line"), t("ray", "Ray"), t("info-line", "Info line"), t("extended-line", "Extended line"),
        t("trend-angle", "Trend angle"), t("horizontal-line", "Horizontal line"), t("horizontal-ray", "Horizontal ray"),
        t("vertical-line", "Vertical line"), t("cross-line", "Cross line"),
      ] },
      { label: "Channels", tools: [
        t("parallel-channel", "Parallel channel"), t("regression-trend", "Regression trend"),
        t("flat-top-bottom", "Flat top/bottom"), t("disjoint-channel", "Disjoint channel"),
      ] },
      { label: "Pitchforks", tools: [
        t("pitchfork", "Pitchfork"), t("schiff-pitchfork", "Schiff pitchfork"),
        t("modified-schiff-pitchfork", "Modified Schiff pitchfork"), t("inside-pitchfork", "Inside pitchfork"),
      ] },
    ],
  },
  {
    id: "fib", label: "Fib & Gann",
    sections: [
      { label: "Fibonacci", tools: [
        t("fib-retracement", "Fib retracement"), t("trend-based-fib-extension", "Trend-based fib extension"),
        t("fib-channel", "Fib channel"), t("fib-time-zone", "Fib time zone"),
        t("fib-speed-resistance-fan", "Fib speed resistance fan"), t("trend-based-fib-time", "Trend-based fib time"),
        t("fib-circles", "Fib circles"), t("fib-spiral", "Fib spiral"),
        t("fib-speed-resistance-arcs", "Fib speed resistance arcs"), t("fib-wedge", "Fib wedge"), t("pitchfan", "Pitchfan"),
      ] },
      { label: "Gann", tools: [
        t("gann-box", "Gann box"), t("gann-square-fixed", "Gann square fixed"), t("gann-square", "Gann square"), t("gann-fan", "Gann fan"),
      ] },
    ],
  },
  {
    id: "patterns", label: "Patterns",
    sections: [
      { label: "Chart patterns", tools: [
        t("xabcd-pattern", "XABCD pattern"), t("cypher-pattern", "Cypher pattern"), t("head-and-shoulders", "Head and shoulders"),
        t("abcd-pattern", "ABCD pattern"), t("triangle-pattern", "Triangle pattern"), t("three-drives-pattern", "Three drives pattern"),
      ] },
      { label: "Elliott waves", tools: [
        t("elliott-impulse", "Elliott impulse wave"), t("elliott-correction", "Elliott correction wave"),
        t("elliott-triangle", "Elliott triangle wave"), t("elliott-double-combo", "Elliott double combo"),
        t("elliott-triple-combo", "Elliott triple combo"),
      ] },
      { label: "Cycles", tools: [t("cyclic-lines", "Cyclic lines"), t("time-cycles", "Time cycles"), t("sine-line", "Sine line")] },
    ],
  },
  {
    id: "measure", label: "Forecast & measure",
    sections: [
      { label: "Forecasting", tools: [
        t("long-position", "Long position"), t("short-position", "Short position"), t("position-forecast", "Forecast"),
        t("bar-pattern", "Bars pattern"), t("ghost-feed", "Ghost feed"), t("sector", "Sector"),
      ] },
      { label: "Volume-based", tools: [
        t("anchored-vwap", "Anchored VWAP"), t("fixed-range-volume-profile", "Fixed range volume profile"),
        t("anchored-volume-profile", "Anchored volume profile"),
      ] },
      { label: "Measure", tools: [t("price-range", "Price range"), t("date-range", "Date range"), t("date-and-price-range", "Date and price range")] },
    ],
  },
  {
    id: "shapes", label: "Shapes",
    sections: [
      { label: "Brushes", tools: [t("brush", "Brush"), t("highlighter", "Highlighter")] },
      { label: "Arrows", tools: [
        t("arrow-marker", "Arrow marker"), t("arrow", "Arrow"), t("arrow-mark-up", "Arrow mark up"), t("arrow-mark-down", "Arrow mark down"),
      ] },
      { label: "Shapes", tools: [
        t("rectangle", "Rectangle"), t("rotated-rectangle", "Rotated rectangle"), t("path", "Path"), t("circle", "Circle"),
        t("ellipse", "Ellipse"), t("polyline", "Polyline"), t("triangle", "Triangle"), t("arc", "Arc"),
        t("curve", "Curve"), t("double-curve", "Double curve"),
      ] },
    ],
  },
  {
    id: "text", label: "Text & notes",
    sections: [
      { label: "Text and notes", tools: [
        t("text", "Text"), t("note", "Note"), t("price-note", "Price note"), t("pin", "Pin"), t("callout", "Callout"),
        t("comment", "Comment"), t("price-label", "Price label"), t("signpost", "Signpost"), t("flag-mark", "Flag mark"),
      ] },
    ],
  },
];

export const ALL_TOOLS: ToolDef[] = TOOL_GROUPS.flatMap((g) => g.sections.flatMap((s) => s.tools));
const BY_KIND = new Map(ALL_TOOLS.map((d) => [d.kind, d]));
export const toolLabel = (kind: string) => BY_KIND.get(kind as DrawingKind)?.label ?? kind;
export const groupOf = (kind: string) => TOOL_GROUPS.find((g) => g.sections.some((s) => s.tools.some((d) => d.kind === kind)));

/** One tap away, without opening a group: what a level and zone trader reaches for. */
export const DEFAULT_FAVOURITES: DrawingKind[] = [
  "horizontal-line", "horizontal-ray", "trend-line", "rectangle", "fib-retracement", "long-position", "short-position", "text",
];

/** Kinds that finish on a double-click (or the Done button) rather than a fixed number of points. */
export const VARIABLE_LENGTH: ReadonlySet<string> = new Set(["path", "polyline"]);

/**
 * The kit's per-interval visibility speaks TradingView's interval names
 * ("1", "15", "60", "1D"). The app's timeframe keys translate here.
 */
export function kitInterval(tf: string): string {
  const m = /^m?(\d+)m?$/.exec(tf);
  if (m) return m[1];
  switch (tf) {
    case "1h": return "60";
    case "4h": return "240";
    case "1d": case "1day": return "1D";
    case "1w": case "1week": return "1W";
    default: return tf;
  }
}

/** Colour choices, TradingView's palette rows. Drawings keep real colours so they read the same in every theme. */
export const SWATCHES = [
  "#f23645", "#ff9800", "#ffeb3b", "#4caf50", "#089981", "#00bcd4", "#2962ff", "#673ab7", "#9c27b0", "#e91e63",
  "#787b86", "#b2b5be", "#ffffff", "#131722",
];

/** The old tools' four colours, as the kit's hex values (TradingView's own amber, green, red and blue). */
export const COLOURS: Record<DrawColor, string> = { amber: "#ff9800", green: "#089981", red: "#f23645", blue: "#2962ff" };

/*
 * One-tap names for a selected drawing, from the same list the old tools
 * offered, so the common case stays a single tap and Levels keeps grouping
 * trades by the words traders actually use. Which list depends on what the
 * drawing is: a flat line is a level, a rectangle is a zone or a box, a sloped
 * line is a trend, and anything made of words is a note.
 */
const PRESET_GROUP: Partial<Record<DrawingKind, (keyof typeof DRAWING_PRESETS)[]>> = {
  "horizontal-line": ["level"], "horizontal-ray": ["level"],
  rectangle: ["zone", "box"],
  "trend-line": ["trend"], ray: ["trend"], "extended-line": ["trend"], "parallel-channel": ["trend"],
  callout: ["note"], note: ["note"], text: ["note"], comment: ["note"], "price-note": ["note"], signpost: ["note"], pin: ["note"],
};

export function labelPresets(kind: DrawingKind): { label: string; color: string }[] {
  const seen = new Set<string>();
  const out: { label: string; color: string }[] = [];
  for (const g of PRESET_GROUP[kind] ?? []) {
    for (const p of DRAWING_PRESETS[g]) {
      if (seen.has(p.label)) continue;
      seen.add(p.label);
      out.push({ label: p.label, color: COLOURS[p.color] });
    }
  }
  return out;
}
