import Link from "next/link";
import { PERIODS, type PeriodKey } from "@/lib/queries";

export function PeriodTabs({ base, active }: { base: string; active: PeriodKey }) {
  return (
    <div className="inline-flex rounded-lg p-0.5"
         style={{ background: "var(--s3)", border: "1px solid var(--line)" }}>
      {PERIODS.map((p) => {
        const on = p.key === active;
        return (
          <Link key={p.key} href={`${base}?period=${p.key}`} scroll={false}
                className="rounded-md px-3 py-1.5 text-[12px] font-semibold"
                style={on
                  ? { background: "var(--s1)", color: "var(--ink)", boxShadow: "0 1px 2px rgb(0 0 0 / 0.12)" }
                  : { color: "var(--ink3)" }}>
            {p.label}
          </Link>
        );
      })}
    </div>
  );
}
