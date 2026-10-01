import Link from "next/link";
import { PERIODS, type PeriodKey } from "@/lib/queries";

/**
 * The period every figure on the page is measured over.
 *
 * `keep` carries the page's other settings across a switch — changing the
 * period on the Timing tab of Insights should leave you on Timing.
 */
export function PeriodTabs({ base, active, keep }: {
  base: string; active: PeriodKey; keep?: Record<string, string>;
}) {
  return (
    <div className="seg" role="tablist" aria-label="Period">
      {PERIODS.map((p) => (
        <Link key={p.key} href={`${base}?${new URLSearchParams({ ...keep, period: p.key }).toString()}`} scroll={false}
              role="tab" aria-current={p.key === active ? "true" : undefined}>
          {p.label}
        </Link>
      ))}
    </div>
  );
}
