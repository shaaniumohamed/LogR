import type { ReactNode } from "react";

/* Plain-language formatters. No jargon reaches the screen: "15 trades", never "n=15". */
/**
 * The word joiner after the minus sign is not decoration.
 *
 * A browser is allowed to break a line after a minus, and on a phone it does:
 * the headline figure on the Overview rendered as a lone "−" on one line with
 * "$5,851.37" underneath it, which reads as a stray dash above a profit. U+2060
 * removes that break opportunity and occupies no width, so nothing else moves.
 */
export const money = (n: number, dp = 2) =>
  `${n < 0 ? "−\u2060" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
export const money0 = (n: number) => money(n, 0);
export const pct = (n: number, dp = 1) => `${(n * 100).toFixed(dp)}%`;
export const count = (n: number, one = "trade", many = "trades") =>
  `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
export const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`card p-5 ${className}`}>{children}</section>;
}

/** Small uppercase label. Names the card in words a trader already uses. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return <h2 className="eyebrow">{children}</h2>;
}

/**
 * The verdict line: one plain sentence stating what the numbers mean, placed
 * ABOVE the numbers. A dashboard that leads with figures makes the reader do the
 * interpreting, which is exactly what a first-time reader cannot do.
 */
export function Verdict({ children }: { children: ReactNode }) {
  return <p className="mt-2 text-[15px] leading-relaxed" style={{ color: "var(--ink)" }}>{children}</p>;
}

export function Note({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-[13px] leading-relaxed" style={{ color: "var(--ink2)" }}>{children}</p>;
}

export function StatGrid({ children, cols = 4 }: { children: ReactNode; cols?: 2 | 3 | 4 }) {
  const c = cols === 2 ? "grid-cols-2" : cols === 3 ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-2 sm:grid-cols-4";
  return (
    <div className={`grid ${c} gap-px overflow-hidden rounded-xl`}
         style={{ background: "var(--line)", border: "1px solid var(--line)" }}>
      {children}
    </div>
  );
}

export function Stat({ label, value, sub, tone }: {
  label: string; value: string; sub?: string; tone?: "pos" | "neg";
}) {
  return (
    <div className="p-4" style={{ background: "var(--s1)" }}>
      <div className={`num text-xl font-semibold tracking-tight ${tone ?? ""}`}>{value}</div>
      <div className="mt-1 text-[12px] font-medium leading-tight" style={{ color: "var(--ink2)" }}>{label}</div>
      {sub && <div className="mt-1 text-[11px] leading-tight" style={{ color: "var(--ink3)" }}>{sub}</div>}
    </div>
  );
}

export function Empty({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <Card className="py-12 text-center">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mx-auto mt-2 max-w-sm text-sm" style={{ color: "var(--ink2)" }}>{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </Card>
  );
}

/** Marks a figure as an estimate so it can never be mistaken for a measurement. */
export function Estimated() {
  return (
    <span className="ml-2 rounded px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wider align-middle"
          style={{ color: "var(--ink3)", border: "1px dashed var(--line)" }}>
      estimated
    </span>
  );
}
