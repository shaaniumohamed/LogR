"use client";

import { useEffect, useRef } from "react";

export type ShortcutAction = "play" | "step" | "stepMinute" | "buy" | "sell" | "closeAll" | "breakeven" | "faster" | "slower" | "help" | "escape";

export const SHORTCUTS: { keys: string; what: string }[] = [
  { keys: "Space", what: "Play / pause" },
  { keys: "→", what: "Step one candle" },
  { keys: "Shift →", what: "Step one minute" },
  { keys: "Shift B", what: "Buy at market (the one-click size)" },
  { keys: "Shift S", what: "Sell at market" },
  { keys: "Shift X", what: "Close every open position" },
  { keys: "Shift E", what: "Move stops to breakeven where possible" },
  { keys: "+  /  −", what: "Faster / slower" },
  { keys: "Esc", what: "Cancel picking the start, a drag, or an editor" },
  { keys: "?", what: "This list" },
];

/**
 * The replay's keyboard. One listener for the whole workspace, and careful
 * about when a key is NOT a command: typing in a box (including a drawing's
 * text), a drawing tool in hand, a sheet open, a mouse button held (the
 * drawing kit uses Shift to snap angles mid-drag), a key held down and
 * repeating, or any of Ctrl / Cmd / Alt (the browser's own shortcuts).
 */
export function useShortcuts(run: (a: ShortcutAction) => void, blocked: () => { typingOk: boolean; trading: boolean }) {
  const runRef = useRef(run);
  runRef.current = run;
  const blockedRef = useRef(blocked);
  blockedRef.current = blocked;

  useEffect(() => {
    let buttons = 0;
    const onDown = (e: PointerEvent) => { buttons = e.buttons; };
    const onUp = (e: PointerEvent) => { buttons = e.buttons; };
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const state = blockedRef.current();
      if (e.key === "Escape") { runRef.current("escape"); return; }
      if (e.key === "?") { e.preventDefault(); runRef.current("help"); return; }
      if (!state.typingOk) return;
      if (e.key === " ") { e.preventDefault(); if (!e.repeat) runRef.current("play"); return; }
      if (e.key === "ArrowRight") { e.preventDefault(); runRef.current(e.shiftKey ? "stepMinute" : "step"); return; }
      if (e.key === "+" || e.key === "=") { runRef.current("faster"); return; }
      if (e.key === "-" || e.key === "_") { runRef.current("slower"); return; }
      if (!e.shiftKey || e.repeat || buttons !== 0 || !state.trading) return;
      const k = e.key.toLowerCase();
      const a: ShortcutAction | null = k === "b" ? "buy" : k === "s" ? "sell" : k === "x" ? "closeAll" : k === "e" ? "breakeven" : null;
      if (a) { e.preventDefault(); runRef.current(a); }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointerup", onUp, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointerup", onUp, true);
    };
  }, []);
}

export function ShortcutsList() {
  return (
    <ul className="space-y-1.5">
      {SHORTCUTS.map((s) => (
        <li key={s.keys} className="flex items-center gap-3 text-[13px]">
          <kbd className="num min-w-[76px] rounded-md px-2 py-1 text-center text-[12px] font-semibold" style={{ background: "var(--s3)", color: "var(--ink)" }}>{s.keys}</kbd>
          <span style={{ color: "var(--ink2)" }}>{s.what}</span>
        </li>
      ))}
    </ul>
  );
}
