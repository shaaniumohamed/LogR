"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type ToastTone = "info" | "win" | "loss" | "error";
interface Toast { id: number; text: string; tone: ToastTone }

/** Short messages over the chart: up to three at once, each for a few seconds. */
export function useToasts() {
  const [items, setItems] = useState<Toast[]>([]);
  const next = useRef(1);
  const timers = useRef(new Map<number, number>());
  const push = useCallback((text: string, tone: ToastTone = "info") => {
    const id = next.current++;
    setItems((xs) => [...xs.filter((x) => x.text !== text), { id, text, tone }].slice(-3));
    timers.current.set(id, window.setTimeout(() => {
      timers.current.delete(id);
      setItems((xs) => xs.filter((x) => x.id !== id));
    }, tone === "error" ? 5000 : 3500));
  }, []);
  useEffect(() => () => { for (const t of timers.current.values()) window.clearTimeout(t); }, []);
  return { items, push };
}

export function Toasts({ items }: { items: Toast[] }) {
  if (!items.length) return null;
  return (
    <div className="pointer-events-none absolute bottom-12 left-1/2 z-[8] flex w-max max-w-[92%] -translate-x-1/2 flex-col items-center gap-1.5" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className="rounded-lg px-3 py-2 text-[12.5px] font-medium shadow-lg"
             style={{
               background: "var(--ink)", color: "var(--plane)",
               borderLeft: `3px solid ${t.tone === "win" ? "var(--profit)" : t.tone === "loss" || t.tone === "error" ? "var(--loss)" : "transparent"}`,
             }}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
