"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface Tab { href: string; label: string; icon: string }

/**
 * The bottom tab bar, with the section you are in marked.
 *
 * A client component for one reason: knowing which tab is active needs the
 * current path, and a bar that looks identical on every screen leaves the reader
 * to work out where they are from the content. On a phone, where the bar is the
 * only persistent chrome, that is the difference between an app and a website.
 */
export function TabBar({ tabs }: { tabs: readonly Tab[] }) {
  const path = usePathname();

  return (
    <nav aria-label="Sections"
         className="fixed inset-x-0 bottom-0 z-30 border-t sm:hidden"
         style={{
           borderColor: "var(--line)",
           background: "color-mix(in srgb, var(--plane) 92%, transparent)",
           backdropFilter: "blur(12px)",
           paddingBottom: "env(safe-area-inset-bottom, 0px)",
         }}>
      <div className="mx-auto grid max-w-3xl" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0,1fr))` }}>
        {tabs.map((t) => {
          // Prefix match, so a trade's own page keeps Trades lit and a day keeps
          // Calendar lit — a tab that goes dark the moment you follow a link from
          // it is worse than no highlight at all.
          const on = path === t.href || path.startsWith(`${t.href}/`);
          return (
            <Link key={t.href} href={t.href} aria-current={on ? "page" : undefined}
                  className="flex flex-col items-center gap-1 px-0.5 py-2.5 text-center text-[9.5px] leading-tight"
                  style={{ color: on ? "var(--ink)" : "var(--ink3)", fontWeight: on ? 700 : 500 }}>
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor"
                   strokeWidth={on ? 2 : 1.5} strokeLinecap="round" strokeLinejoin="round"
                   className="h-5 w-5">
                <path d={t.icon} />
              </svg>
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/** The same highlight for the inline nav on wider screens. */
export function TopNav({ tabs }: { tabs: readonly { href: string; label: string }[] }) {
  const path = usePathname();
  return (
    <nav className="hidden gap-4 text-sm sm:flex">
      {tabs.map((t) => {
        const on = path === t.href || path.startsWith(`${t.href}/`);
        return (
          <Link key={t.href} href={t.href}
                aria-current={on ? "page" : undefined}
                className="hover:underline"
                style={{ color: on ? "var(--ink)" : "var(--ink2)", fontWeight: on ? 600 : 400 }}>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
