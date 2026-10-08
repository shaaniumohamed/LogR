"use client";

import { useEffect, useRef, useState } from "react";
import type { DrawingKind, MagnetMode } from "lightweight-charts-drawing";
import { TOOL_GROUPS, groupOf, toolLabel } from "@/lib/chart/kit";

/**
 * The tool strip: favourites one tap away, every other tool one panel away,
 * and the switches a TradingView user expects next to them.
 *
 * On a phone the strip scrolls sideways within itself rather than wrapping
 * onto three lines above a chart that is already short; the full tool list
 * opens as a sheet from the bottom of the screen.
 */
export function DrawingToolbar({
  tool, favourites, magnet, keepDrawing, visible, canUndo, canRedo, count,
  onTool, onToggleFavourite, onMagnet, onKeepDrawing, onVisible, onUndo, onRedo, onObjects, extra, panelAbove = false,
}: {
  tool: DrawingKind | null;
  favourites: DrawingKind[];
  magnet: MagnetMode;
  keepDrawing: boolean;
  visible: boolean;
  canUndo: boolean;
  canRedo: boolean;
  count: number;
  onTool: (k: DrawingKind | null) => void;
  onToggleFavourite: (k: DrawingKind) => void;
  onMagnet: (m: MagnetMode) => void;
  onKeepDrawing: (on: boolean) => void;
  onVisible: (on: boolean) => void;
  onUndo: () => void;
  onRedo: () => void;
  onObjects: () => void;
  extra?: React.ReactNode;
  /** On a desktop, open the tool panel above the strip (when the strip sits under the chart). */
  panelAbove?: boolean;
}) {
  const [panel, setPanel] = useState(false);
  const nextMagnet: Record<MagnetMode, MagnetMode> = { off: "weak", weak: "strong", strong: "off" };
  const armedIsFavourite = tool ? favourites.includes(tool) : true;

  return (
    <div className="relative">
      {/* Two rows on a phone, one on a desktop. Tools first, with "All tools"
          pinned at the front: in a single scrolling strip it, undo and Expand
          were the buttons that fell off the right edge of an iPhone. */}
      <div className="flex flex-col gap-1.5 md:flex-row md:items-center md:gap-1" role="toolbar" aria-label="Drawing tools">
        <div className="flex min-w-0 items-center gap-1">
          <button type="button" onClick={() => setPanel((p) => !p)} aria-expanded={panel} data-tool-toggle
                  className="flex h-9 shrink-0 items-center gap-1 rounded-lg px-2.5 text-[12.5px] font-semibold"
                  style={panel ? { background: "var(--ink)", color: "var(--plane)" } : { background: "var(--s3)", color: "var(--ink)" }}>
            <Svg><path d="M3 4h4v4H3zM9 4h4v4H9zM3 10h4v4H3zM9 10h4v4H9z" /></Svg>
            All tools
          </button>
          <div className="no-scrollbar flex min-w-0 items-center gap-1 overflow-x-auto">
            {favourites.map((k) => (
              <ToolButton key={k} on={tool === k} label={toolLabel(k)} onClick={() => onTool(tool === k ? null : k)}>
                <ToolIcon kind={k} />
              </ToolButton>
            ))}
            {!armedIsFavourite && tool && (
              <ToolButton on label={toolLabel(tool)} onClick={() => onTool(null)}><ToolIcon kind={tool} /></ToolButton>
            )}
          </div>
        </div>
        <span className="mx-1 hidden h-6 w-px shrink-0 md:block" style={{ background: "var(--line)" }} />
        <div className="no-scrollbar flex min-w-0 items-center gap-1 overflow-x-auto">
          <ToolButton on={magnet !== "off"} label={`Magnet: ${magnet}`} onClick={() => onMagnet(nextMagnet[magnet])} wide>
            <Svg><path d="M4 3v5a4 4 0 0 0 8 0V3M4 3h2.5v5a1.5 1.5 0 0 0 3 0V3H12" /></Svg>
            <span className="text-[11.5px] capitalize">{magnet === "off" ? "Magnet" : magnet}</span>
          </ToolButton>
          <ToolButton on={keepDrawing} label="Keep drawing" onClick={() => onKeepDrawing(!keepDrawing)}>
            <Svg><path d="M3 13l2.5-.5L13 5l-2-2-7.5 7.5zM10 4l2 2" /><path d="M3 3v3M1.5 4.5h3" /></Svg>
          </ToolButton>
          <ToolButton on={!visible} label={visible ? "Hide all drawings" : "Show all drawings"} onClick={() => onVisible(!visible)}>
            {visible
              ? <Svg><path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" /><circle cx="8" cy="8" r="2" /></Svg>
              : <Svg><path d="M2 2l12 12M6.5 4a6.5 6.5 0 0 1 1.5-.5C12 3.5 14.5 8 14.5 8a12 12 0 0 1-2 2.6M4 5.4A12 12 0 0 0 1.5 8S4 12.5 8 12.5a6 6 0 0 0 2.4-.5" /></Svg>}
          </ToolButton>
          <ToolButton label="Undo" onClick={onUndo} disabled={!canUndo}><Svg><path d="M5 6H10.5a3 3 0 0 1 0 6H7M5 6l2.5-2.5M5 6l2.5 2.5" /></Svg></ToolButton>
          <ToolButton label="Redo" onClick={onRedo} disabled={!canRedo}><Svg><path d="M11 6H5.5a3 3 0 0 0 0 6H9M11 6L8.5 3.5M11 6L8.5 8.5" /></Svg></ToolButton>
          <ToolButton label="Your drawings" onClick={onObjects} wide>
            <Svg><path d="M3 4h10M3 8h10M3 12h6" /></Svg>
            <span className="num text-[11.5px]">{count}</span>
          </ToolButton>
          {extra && <span className="ml-auto flex shrink-0 items-center md:ml-1">{extra}</span>}
        </div>
      </div>
      {panel && (
        <ToolPanel tool={tool} favourites={favourites} above={panelAbove} onClose={() => setPanel(false)}
                   onPick={(k) => { onTool(k); setPanel(false); }} onToggleFavourite={onToggleFavourite} />
      )}
    </div>
  );
}

function ToolButton({ on, label, onClick, disabled, wide, children }: {
  on?: boolean; label: string; onClick: () => void; disabled?: boolean; wide?: boolean; children: React.ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-pressed={on} aria-label={label} title={label}
            className={`flex h-9 shrink-0 items-center justify-center gap-1 rounded-lg ${wide ? "px-2" : "w-9"} transition-colors disabled:opacity-35`}
            style={on ? { background: "var(--ink)", color: "var(--plane)" } : { background: "var(--s3)", color: "var(--ink)" }}>
      {children}
    </button>
  );
}

/** Every tool, by TradingView's groups. A sheet on a phone, a panel on a desktop. */
function ToolPanel({ tool, favourites, above, onPick, onToggleFavourite, onClose }: {
  tool: DrawingKind | null;
  above: boolean;
  favourites: DrawingKind[];
  onPick: (k: DrawingKind) => void;
  onToggleFavourite: (k: DrawingKind) => void;
  onClose: () => void;
}) {
  const [group, setGroup] = useState(() => groupOf(tool ?? "")?.id ?? TOOL_GROUPS[0].id);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } };
    // The button that opens the panel toggles it itself; closing here too would reopen it.
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (ref.current && !ref.current.contains(t) && !t?.closest?.("[data-tool-toggle]")) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown, true);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("pointerdown", onDown, true); };
  }, [onClose]);
  const g = TOOL_GROUPS.find((x) => x.id === group) ?? TOOL_GROUPS[0];

  return (
    <div ref={ref} role="dialog" aria-label="All drawing tools"
         className={`fixed inset-x-0 bottom-0 z-[70] max-h-[78vh] overflow-hidden rounded-t-2xl md:absolute md:inset-x-auto md:left-0 md:w-[580px] md:rounded-2xl ${above ? "md:bottom-full md:mb-1" : "md:bottom-auto md:top-full md:mt-1"}`}
         style={{ background: "var(--s1)", boxShadow: "0 12px 40px rgb(0 0 0 / 0.25)", border: "1px solid var(--line)", paddingBottom: "env(safe-area-inset-bottom)" }}>
      <div className="flex items-center gap-2 px-4 pb-2 pt-3">
        <span className="text-[14px] font-semibold">Drawing tools</span>
        <span className="text-[12px]" style={{ color: "var(--ink3)" }}>★ adds a tool to your bar</span>
        <button type="button" onClick={onClose} className="tap ml-auto text-[13px] font-medium" style={{ color: "var(--ink3)" }}>Close</button>
      </div>
      <div className="flex max-h-[calc(78vh-48px)] flex-col md:flex-row">
        <div className="no-scrollbar flex shrink-0 gap-1 overflow-x-auto px-3 pb-2 md:w-44 md:flex-col md:overflow-visible md:pb-3" role="tablist">
          {TOOL_GROUPS.map((x) => (
            <button key={x.id} type="button" role="tab" aria-selected={x.id === group} onClick={() => setGroup(x.id)}
                    className="flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] font-medium"
                    style={x.id === group ? { background: "var(--s3)", color: "var(--ink)" } : { color: "var(--ink2)" }}>
              <GroupIcon id={x.id} />
              {x.label}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
          {g.sections.map((s) => (
            <div key={s.label} className="mb-3">
              <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--ink3)" }}>{s.label}</div>
              {s.tools.map((d) => {
                const fav = favourites.includes(d.kind);
                return (
                  <div key={d.kind} className="flex items-center rounded-lg" style={tool === d.kind ? { background: "var(--s3)" } : undefined}>
                    <button type="button" onClick={() => onPick(d.kind)} className="flex min-w-0 flex-1 items-center gap-2.5 px-2 py-2 text-left text-[13.5px]">
                      <span className="shrink-0" style={{ color: "var(--ink2)" }}><ToolIcon kind={d.kind} /></span>
                      <span className="truncate">{d.label}</span>
                    </button>
                    <button type="button" onClick={() => onToggleFavourite(d.kind)} aria-pressed={fav}
                            aria-label={fav ? `Remove ${d.label} from your bar` : `Add ${d.label} to your bar`}
                            className="h-9 w-9 shrink-0 text-[16px]" style={{ color: fav ? "var(--c2)" : "var(--ink3)" }}>
                      {fav ? "★" : "☆"}
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Svg({ children }: { children: React.ReactNode }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden>{children}</svg>
  );
}

/** A small picture for the favourites; anything else gets its group's picture. */
export function ToolIcon({ kind }: { kind: string }) {
  switch (kind) {
    case "horizontal-line": return <Svg><path d="M1.5 8h13" /><circle cx="8" cy="8" r="1.4" fill="currentColor" /></Svg>;
    case "horizontal-ray": return <Svg><circle cx="4" cy="8" r="1.6" fill="currentColor" /><path d="M4 8h10.5" /></Svg>;
    case "trend-line": return <Svg><path d="M3 12.5L13 3.5" /><circle cx="3" cy="12.5" r="1.5" fill="currentColor" /><circle cx="13" cy="3.5" r="1.5" fill="currentColor" /></Svg>;
    case "ray": return <Svg><path d="M3 12.5L14.5 2.5" /><circle cx="3" cy="12.5" r="1.5" fill="currentColor" /></Svg>;
    case "vertical-line": return <Svg><path d="M8 1.5v13" /></Svg>;
    case "rectangle": return <Svg><rect x="2.5" y="4" width="11" height="8" rx="1" /></Svg>;
    case "parallel-channel": return <Svg><path d="M2 10L12 4M4 13L14 7" /></Svg>;
    case "fib-retracement": return <Svg><path d="M2 3.5h12M2 6.5h9M2 9.5h11M2 12.5h7" /></Svg>;
    case "trend-based-fib-extension": return <Svg><path d="M2 12l4-6 3 3M9 3.5h5M9 6.5h5M9 9.5h5" /></Svg>;
    case "long-position": return <Svg><rect x="3" y="2.5" width="10" height="5" rx="0.5" style={{ color: "#089981" }} stroke="currentColor" /><rect x="3" y="8.5" width="10" height="5" rx="0.5" style={{ color: "#f23645" }} stroke="currentColor" /></Svg>;
    case "short-position": return <Svg><rect x="3" y="2.5" width="10" height="5" rx="0.5" style={{ color: "#f23645" }} stroke="currentColor" /><rect x="3" y="8.5" width="10" height="5" rx="0.5" style={{ color: "#089981" }} stroke="currentColor" /></Svg>;
    case "price-range": case "date-range": case "date-and-price-range": return <Svg><path d="M8 2v12M5 4.5L8 2l3 2.5M5 11.5L8 14l3-2.5" /></Svg>;
    case "text": return <Svg><path d="M3.5 4h9M8 4v9" /></Svg>;
    case "callout": case "note": case "comment": return <Svg><path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" /></Svg>;
    case "brush": case "highlighter": return <Svg><path d="M2 13c2 0 3-1 3-3l6-7 2 2-7 6c-2 0-3 1-4 2z" /></Svg>;
    case "arrow": case "arrow-marker": return <Svg><path d="M3 13L13 3M7 3h6v6" /></Svg>;
    default: return <GroupIcon id={groupOf(kind)?.id ?? "lines"} />;
  }
}

function GroupIcon({ id }: { id: string }) {
  switch (id) {
    case "fib": return <Svg><path d="M2 3.5h12M2 6.5h9M2 9.5h11M2 12.5h7" /></Svg>;
    case "patterns": return <Svg><path d="M1.5 12l3-7 3 5 3-7 4 9" /></Svg>;
    case "measure": return <Svg><path d="M8 2v12M5 4.5L8 2l3 2.5M5 11.5L8 14l3-2.5" /></Svg>;
    case "shapes": return <Svg><rect x="2" y="2" width="6" height="6" rx="1" /><circle cx="11" cy="11" r="3" /></Svg>;
    case "text": return <Svg><path d="M3.5 4h9M8 4v9" /></Svg>;
    default: return <Svg><path d="M3 12.5L13 3.5" /><circle cx="3" cy="12.5" r="1.5" fill="currentColor" /><circle cx="13" cy="3.5" r="1.5" fill="currentColor" /></Svg>;
  }
}
