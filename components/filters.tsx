import Link from "next/link";

export interface FilterOption { value: string; label: string }

export interface FilterGroup {
  /** The query parameter this group writes to. */
  key: string;
  label: string;
  options: FilterOption[];
  active: string | null;
  /** Colour for the selected chip. Defaults to the accent. */
  tone?: "accent" | "ink";
}

/**
 * Every filter in one place, with what is currently on stated in words.
 *
 * Three chip rows stacked above a list is how filtering looked here before, and
 * it fails in both directions at once: it eats the top of a small screen with
 * options nobody is using, and it still cannot fit the ones a trader actually
 * wants — hour of day, month, how long it was held. Collapsing them behind one
 * disclosure and surfacing only the ACTIVE filters as removable pills fixes both.
 *
 * Built on <details> so it needs no JavaScript and survives a server round trip,
 * and opened automatically whenever something is filtered, so the controls are
 * never hidden behind a tap at the moment you want to change them.
 */
export function Filters({ groups, href, showing, total }: {
  groups: FilterGroup[];
  /** Build a URL with these parameters changed. null removes one. */
  href: (patch: Record<string, string | null>) => string;
  showing: number;
  total: number;
}) {
  const on = groups.filter((g) => g.active !== null);

  return (
    <div className="rounded-xl" style={{ background: "var(--s1)", border: "1px solid var(--line)" }}>
      <details open={on.length > 0} className="group">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6}
               strokeLinecap="round" className="h-4 w-4" style={{ color: "var(--ink2)" }} aria-hidden>
            <path d="M3 5h14M6 10h8M9 15h2" />
          </svg>
          <span className="text-[13px] font-semibold">Filters</span>
          <span className="text-[12px]" style={{ color: "var(--ink3)" }}>
            {on.length === 0
              ? `all ${total.toLocaleString("en-US")}`
              : `${showing.toLocaleString("en-US")} of ${total.toLocaleString("en-US")}`}
          </span>
          <span className="ml-auto transition-transform group-open:rotate-90"
                style={{ color: "var(--ink3)" }} aria-hidden>›</span>
        </summary>

        <div className="space-y-3 border-t px-4 py-3" style={{ borderColor: "var(--line)" }}>
          {groups.map((g) => (
            <div key={g.key}>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide"
                   style={{ color: "var(--ink3)" }}>{g.label}</div>
              <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1">
                {g.options.map((o) => {
                  const selected = g.active === o.value;
                  const accent = g.tone === "ink" ? "var(--ink)" : "var(--c1)";
                  return (
                    <Link key={o.value} scroll={false}
                          href={href({ [g.key]: selected ? null : o.value, page: null })}
                          className="shrink-0 rounded-full px-3 py-1.5 text-[12px] font-medium"
                          style={selected
                            ? { background: accent, color: g.tone === "ink" ? "var(--plane)" : "#fff" }
                            : { background: "var(--plane)", color: "var(--ink2)", border: "1px solid var(--line)" }}>
                      {o.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </details>

      {on.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-t px-4 py-2.5" style={{ borderColor: "var(--line)" }}>
          {on.map((g) => {
            const label = g.options.find((o) => o.value === g.active)?.label ?? g.active!;
            return (
              <Link key={g.key} href={href({ [g.key]: null, page: null })} scroll={false}
                    className="inline-flex items-center gap-1.5 rounded-full py-1 pl-3 pr-2 text-[12px] font-medium"
                    style={{ background: "var(--s3)", color: "var(--ink)" }}>
                {label}
                <span aria-hidden style={{ color: "var(--ink3)" }}>×</span>
                <span className="sr-only">remove this filter</span>
              </Link>
            );
          })}
          <Link href={href(Object.fromEntries([...groups.map((g) => [g.key, null]), ["page", null]]))}
                scroll={false} className="ml-auto text-[12px] font-semibold" style={{ color: "var(--c1)" }}>
            Clear all
          </Link>
        </div>
      )}
    </div>
  );
}

/** A small segmented control, for a choice that is always on — like sort order. */
export function Segmented({ options, active, href, param }: {
  options: FilterOption[];
  active: string;
  href: (patch: Record<string, string | null>) => string;
  param: string;
}) {
  return (
    <div className="inline-flex rounded-lg p-0.5"
         style={{ background: "var(--s3)", border: "1px solid var(--line)" }}>
      {options.map((o) => {
        const on = o.value === active;
        return (
          <Link key={o.value} href={href({ [param]: o.value, page: null })} scroll={false}
                className="rounded-md px-2.5 py-1.5 text-[12px] font-semibold"
                style={on
                  ? { background: "var(--s1)", color: "var(--ink)", boxShadow: "0 1px 2px rgb(0 0 0 / 0.12)" }
                  : { color: "var(--ink3)" }}>
            {o.label}
          </Link>
        );
      })}
    </div>
  );
}
