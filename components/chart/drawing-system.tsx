"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DrawingManager, OVERLAY_SPECS, type Drawing, type DrawingKind, type MagnetMode } from "lightweight-charts-drawing";
import { attachTouchLayer, finishPlacement, type TouchLayer } from "@/lib/chart/touch-layer";
import { DEFAULT_FAVOURITES, VARIABLE_LENGTH, toolLabel } from "@/lib/chart/kit";
import type { ChartHandle } from "@/lib/chart/handle";
import { DrawingToolbar } from "./drawing-toolbar";
import { ObjectsPanel, SelectionBar, SettingsSheet, TextEditor } from "./drawing-inspector";

export type { ChartHandle } from "@/lib/chart/handle";

/* Per-viewer conveniences, remembered on this device only. */
const read = <T,>(key: string, fallback: T): T => {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
};
const write = (key: string, v: unknown) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* fine */ } };

const HISTORY_LIMIT = 100;

/**
 * The drawing kit, wired into the app: the tools, a finger-friendly touch
 * layer, undo and redo, the selected drawing's style bar, the list of every
 * drawing, and saving.
 *
 * The kit owns the drawings while the chart is open; this component listens to
 * it and keeps three things in step — the toolbar's state, an undo history of
 * whole snapshots (the kit's own JSON, so an undo is exactly the chart as it
 * was), and the host's `onSave`, called a moment after the last change.
 */
export function DrawingSystem({ handle, initial, onSave, onDirty, presets, interval, timeZone, decimals, pageScroll, panelAbove, extra }: {
  handle: ChartHandle;
  initial: Drawing[];
  /** The whole set, a moment after the last change (and at once on unmount if one is pending). */
  onSave?: (drawings: Drawing[]) => void;
  /** Something changed and a save is on its way — for a "Saving…" status and a leave warning. */
  onDirty?: () => void;
  /** One-tap names offered for a selected drawing of this kind. */
  presets?: (kind: DrawingKind) => { label: string; color: string }[];
  /** The kit's interval name for per-timeframe visibility ("1", "60", "1D"). */
  interval: string;
  timeZone: string;
  decimals: number;
  /** May a finger scroll the page over the chart when nothing is armed? */
  pageScroll: boolean;
  /** The strip sits under the chart, so its tool panel opens upwards. */
  panelAbove?: boolean;
  extra?: React.ReactNode;
}) {
  const dmRef = useRef<DrawingManager | null>(null);
  const touchRef = useRef<TouchLayer | null>(null);
  const pageScrollRef = useRef(pageScroll);
  pageScrollRef.current = pageScroll;
  const [tool, setTool] = useState<DrawingKind | null>(null);
  const [selection, setSelection] = useState<readonly string[]>([]);
  const [drawings, setDrawings] = useState<readonly Drawing[]>([]);
  const [visible, setVisible] = useState(true);
  const [magnet, setMagnet] = useState<MagnetMode>(() => read("logr.chart.magnet", "weak"));
  const [keep, setKeep] = useState<boolean>(() => read("logr.chart.keep", false));
  const [favourites, setFavourites] = useState<DrawingKind[]>(() => read("logr.chart.favourites", DEFAULT_FAVOURITES));
  const [objects, setObjects] = useState(false);
  const [settings, setSettings] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; at: { x: number; y: number }; text: string } | null>(null);
  const [hist, setHist] = useState({ index: 0, length: 1 });

  // Undo history: snapshots of the kit's JSON. `replaying` marks changes the
  // history itself made, so an undo does not record itself as a new step.
  const history = useRef<string[]>([]);
  const index = useRef(0);
  const replaying = useRef(false);
  const recordTimer = useRef(0);
  const saveTimer = useRef(0);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const onDirtyRef = useRef(onDirty);
  onDirtyRef.current = onDirty;

  const fmtTime = useMemo(() => new Intl.DateTimeFormat("en-GB", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone,
  }), [timeZone]);

  /* Create the kit on this chart; tear it down with the chart. */
  useEffect(() => {
    const { chart, series, host } = handle;
    const dm = new DrawingManager(chart, series, {
      // The app's own typeface for words on drawings; the chart's axes keep
      // their monospace digits.
      fontFamily: getComputedStyle(document.documentElement).getPropertyValue("--font-sans").trim() || undefined,
      magnet,
      interval,
      stayInDrawingMode: keep,
      timeInfo: () => ({ timeZone, intraday: true }),
    });
    dmRef.current = dm;
    replaying.current = true;
    dm.importJSON(initial);
    replaying.current = false;
    history.current = [dm.exportJSON()];
    index.current = 0;
    setHist({ index: 0, length: 1 });
    setDrawings(dm.drawings());

    const offs = [
      dm.on("tool", (k) => setTool(k)),
      dm.on("selection", (ids) => { setSelection([...ids]); if (!ids.length) setSettings(null); }),
      dm.on("visibility", (v) => setVisible(v)),
      dm.on("textEdit", (d, screen) => {
        const r = host.getBoundingClientRect();
        setEditing({ id: d.id, at: { x: r.left + screen.x, y: r.top + screen.y }, text: d.text ?? "" });
      }),
      dm.on("change", (list) => {
        setDrawings([...list]);
        // Save a moment after the last change, whether drawn or undone.
        onDirtyRef.current?.();
        window.clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(() => {
          saveTimer.current = 0;
          onSaveRef.current?.(JSON.parse(dm.exportJSON()));
        }, 600);
        if (replaying.current) return;
        // One undo step per burst of changes: a drag fires many.
        window.clearTimeout(recordTimer.current);
        recordTimer.current = window.setTimeout(() => {
          const snap = dm.exportJSON();
          if (snap === history.current[index.current]) return;
          history.current = [...history.current.slice(0, index.current + 1), snap].slice(-HISTORY_LIMIT);
          index.current = history.current.length - 1;
          setHist({ index: index.current, length: history.current.length });
        }, 250);
      }),
    ];
    const touch = attachTouchLayer(host, chart, series, dm, {
      pageScroll: pageScrollRef.current,
      formatPrice: (p) => p.toFixed(decimals),
      formatTime: (t) => fmtTime.format(new Date(t * 1000)),
      onLongPress: (id) => setSettings(id),
    });
    touchRef.current = touch;

    // Torn down before the chart goes (see ChartHandle), or on unmount if
    // this component goes first; whichever comes first does the work.
    let done = false;
    const teardown = () => {
      if (done) return;
      done = true;
      window.clearTimeout(recordTimer.current);
      // Anything unsaved goes now, not never.
      if (saveTimer.current) {
        window.clearTimeout(saveTimer.current);
        saveTimer.current = 0;
        onSaveRef.current?.(JSON.parse(dm.exportJSON()));
      }
      offs.forEach((off) => off());
      touch.detach();
      if (touchRef.current === touch) touchRef.current = null;
      dm.destroy();
      if (dmRef.current === dm) dmRef.current = null;
    };
    const unregister = handle.onDispose(teardown);
    return () => { unregister(); teardown(); };
    // The kit is rebuilt only when the chart itself is; the rest is applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle]);

  useEffect(() => { dmRef.current?.setInterval(interval); }, [interval]);
  useEffect(() => { touchRef.current?.setPageScroll(pageScroll); }, [pageScroll]);
  useEffect(() => { dmRef.current?.setMagnet(magnet); write("logr.chart.magnet", magnet); }, [magnet]);
  useEffect(() => { dmRef.current?.setStayInDrawingMode(keep); write("logr.chart.keep", keep); }, [keep]);
  useEffect(() => { write("logr.chart.favourites", favourites); }, [favourites]);

  const goTo = useCallback((i: number) => {
    const dm = dmRef.current;
    if (!dm || i < 0 || i >= history.current.length) return;
    index.current = i;
    replaying.current = true;
    dm.importJSON(history.current[i]);
    replaying.current = false;
    setHist({ index: i, length: history.current.length });
  }, []);
  const undo = useCallback(() => goTo(index.current - 1), [goTo]);
  const redo = useCallback(() => goTo(index.current + 1), [goTo]);

  /* Keyboard: undo and redo. The kit handles Escape and Delete itself. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  const dm = dmRef.current;
  const selected = selection.length === 1 ? drawings.find((d) => d.id === selection[0]) ?? null : null;
  const settingsFor = settings ? drawings.find((d) => d.id === settings) ?? null : null;
  const update = (d: Drawing) => dm?.update(d);
  const armedSpec = tool ? (OVERLAY_SPECS as Record<string, { pointCount: number; freehand?: boolean }>)[tool] : null;

  return (
    <div className="space-y-2">
      <DrawingToolbar
        tool={tool} favourites={favourites} magnet={magnet} keepDrawing={keep} visible={visible}
        canUndo={hist.index > 0} canRedo={hist.index < hist.length - 1} count={drawings.length}
        onTool={(k) => dm?.setTool(k)}
        onToggleFavourite={(k) => setFavourites((f) => (f.includes(k) ? f.filter((x) => x !== k) : [...f, k]))}
        onMagnet={setMagnet} onKeepDrawing={setKeep} onVisible={(v) => dm?.setDrawingsVisible(v)}
        onUndo={undo} onRedo={redo} onObjects={() => setObjects((o) => !o)}
        extra={extra} panelAbove={panelAbove}
      />

      {tool && armedSpec && (
        <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-[13px]"
             style={{ background: "color-mix(in srgb, var(--c1) 10%, transparent)" }} role="status">
          <span className="min-w-0 flex-1">
            <b>{toolLabel(tool)}</b>{" "}
            <span style={{ color: "var(--ink2)" }}>
              {armedSpec.freehand ? "— draw on the chart."
                : VARIABLE_LENGTH.has(tool) ? "— tap each point, then Done."
                : armedSpec.pointCount === 1 ? "— tap the chart. With a finger, slide to the spot and lift."
                : `— tap ${armedSpec.pointCount} points. With a finger, slide to each spot and lift.`}
            </span>
          </span>
          {VARIABLE_LENGTH.has(tool) && (
            <button type="button" onClick={() => finishPlacement(handle.chart)} className="btn btn-primary !px-3 !py-1 !text-[12.5px]">Done</button>
          )}
          <button type="button" onClick={() => dm?.setTool(null)} className="tap text-[12.5px] font-medium" style={{ color: "var(--ink3)" }}>Cancel</button>
        </div>
      )}

      {selected && !tool && (
        <SelectionBar d={selected} presets={presets?.(selected.kind)} onChange={update}
                      onDelete={() => dm?.remove(selected.id)}
                      onDuplicate={() => {
                        if (!dm) return;
                        const { id: _drop, ...copy } = selected;
                        const id = dm.add(JSON.parse(JSON.stringify(copy)));
                        dm.select([id]);
                      }}
                      onSettings={() => setSettings(selected.id)}
                      onDone={() => dm?.select([])} />
      )}

      {objects && (
        <ObjectsPanel drawings={drawings} selected={selection}
                      onSelect={(id) => dm?.select([id])} onChange={update}
                      onRemove={(id) => dm?.remove(id)} onClear={() => dm?.clear()} onClose={() => setObjects(false)} />
      )}

      {settingsFor && <SettingsSheet d={settingsFor} onChange={update} onClose={() => setSettings(null)} />}

      {editing && (
        <TextEditor at={editing.at} initial={editing.text}
                    onCancel={() => setEditing(null)}
                    onCommit={(text) => {
                      const d = dm?.get(editing.id);
                      if (d) dm?.update({ ...d, text });
                      setEditing(null);
                    }} />
      )}
    </div>
  );
}
