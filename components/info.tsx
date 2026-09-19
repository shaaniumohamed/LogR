import type { ReactNode } from "react";

/**
 * An explanation the reader can open, using <details> so it needs no JavaScript
 * and stays keyboard accessible. Collapsed by default: a chart should be
 * readable without it, and the explanation is there for the first read or the
 * moment of doubt, not as permanent clutter.
 */
export function Info({ title = "What is this?", children }: { title?: string; children: ReactNode }) {
  return (
    <details className="group mt-3">
      <summary
        className="inline-flex cursor-pointer list-none items-center gap-1.5 text-[11.5px] font-semibold"
        style={{ color: "var(--ink3)" }}
      >
        <span
          className="grid h-[15px] w-[15px] place-items-center rounded-full text-[9.5px] font-bold"
          style={{ border: "1px solid var(--ink3)" }}
          aria-hidden
        >
          i
        </span>
        {title}
        <span className="transition-transform group-open:rotate-90" aria-hidden>›</span>
      </summary>
      <div
        className="mt-2 rounded-lg p-3 text-[12.5px] leading-relaxed"
        style={{ background: "var(--s3)", color: "var(--ink2)" }}
      >
        {children}
      </div>
    </details>
  );
}

/** A caution attached to a finding that could be over-read. */
export function Caveat({ children }: { children: ReactNode }) {
  return (
    <div
      className="mt-3 rounded-lg p-3 text-[12.5px] leading-relaxed"
      style={{ background: "var(--s3)", color: "var(--ink2)", borderLeft: "3px solid var(--warn)" }}
    >
      {children}
    </div>
  );
}
