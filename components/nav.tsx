"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons";

/**
 * Where everything lives, in one place, read by both navigations.
 *
 * Two shapes for two kinds of screen. A phone gets five tabs under the thumb —
 * the most an iOS tab bar holds before labels start to collide, and the old bar
 * had six. A desktop gets a sidebar, because a row of nine links across the top
 * of a 1280-pixel screen was a phone layout stretched sideways, with two thirds
 * of the width left empty either side of it.
 *
 * `match` decides what keeps a destination lit. A tab that goes dark the moment
 * you follow a link out of it — into a trade, a day, a week — leaves you working
 * out where you are from the content.
 */
interface Dest { href: string; label: string; icon: IconName; match?: string[] }

const HOME: Dest = { href: "/dashboard", label: "Home", icon: "home" };
const TRADES: Dest = { href: "/trades", label: "Trades", icon: "trades" };
const REVIEW: Dest = { href: "/review", label: "Review", icon: "review" };
const INSIGHTS: Dest = { href: "/analytics", label: "Insights", icon: "insights" };
const CALENDAR: Dest = { href: "/calendar", label: "Calendar", icon: "calendar", match: ["/calendar", "/day"] };
const WEEK: Dest = { href: "/week", label: "Weekly review", icon: "week" };
const PLAYBOOK: Dest = { href: "/playbook", label: "Playbook", icon: "playbook" };
const IMPORT: Dest = { href: "/import", label: "Import", icon: "upload" };
const SETTINGS: Dest = { href: "/settings", label: "Settings", icon: "settings" };
const BACKTEST: Dest = { href: "/backtest", label: "Backtest", icon: "candles" };

const MOBILE_TABS: Dest[] = [
  HOME, TRADES, REVIEW, INSIGHTS,
  { href: "/more", label: "More", icon: "more",
    match: ["/more", "/calendar", "/day", "/week", "/playbook", "/import", "/settings", "/backtest"] },
];

const SIDEBAR: { title?: string; items: Dest[] }[] = [
  { items: [HOME, CALENDAR, TRADES, REVIEW] },
  { title: "Analyse", items: [INSIGHTS, PLAYBOOK, WEEK] },
  { title: "Account", items: [IMPORT, SETTINGS] },
];

function isOn(path: string, d: Dest) {
  const roots = d.match ?? [d.href];
  return roots.some((r) => path === r || path.startsWith(`${r}/`));
}

/** Bottom bar, phones and tablets. */
export function TabBar() {
  const path = usePathname();
  return (
    <nav aria-label="Sections"
         className="fixed inset-x-0 bottom-0 z-30 border-t lg:hidden"
         style={{
           borderColor: "var(--line)",
           background: "color-mix(in srgb, var(--plane) 88%, transparent)",
           backdropFilter: "saturate(1.6) blur(16px)",
           WebkitBackdropFilter: "saturate(1.6) blur(16px)",
           paddingBottom: "env(safe-area-inset-bottom, 0px)",
         }}>
      <div className="mx-auto grid max-w-xl grid-cols-5">
        {MOBILE_TABS.map((t) => {
          const on = isOn(path, t);
          return (
            <Link key={t.href} href={t.href} aria-current={on ? "page" : undefined}
                  className="flex flex-col items-center gap-[3px] pb-2 pt-2.5 text-[10.5px] leading-none"
                  style={{ color: on ? "var(--ink)" : "var(--ink3)", fontWeight: on ? 600 : 500 }}>
              <Icon name={t.icon} size={23} strokeWidth={on ? 2.1 : 1.7} />
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/**
 * Desktop sidebar. The account switcher sits at the top because it changes
 * every figure on every page beneath it; sign-out sits at the bottom because it
 * is the one action you want to be furthest from by accident.
 */
export function Sidebar({ switcher, footer, backtest = false }: { switcher: ReactNode; footer: ReactNode; backtest?: boolean }) {
  const path = usePathname();
  // The backtester is shown only to owners while it is new.
  const groups = backtest
    ? SIDEBAR.map((g) => (g.title === "Analyse" ? { ...g, items: [...g.items, BACKTEST] } : g))
    : SIDEBAR;
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-[232px] flex-col border-r px-3 py-5 lg:flex"
           style={{ borderColor: "var(--line)", background: "var(--plane)" }}>
      <Link href="/dashboard" className="flex items-center gap-2 px-2.5 pb-5">
        <Logo />
        <span className="text-[17px] font-semibold tracking-tight">LogR</span>
      </Link>
      {switcher && <div className="px-1 pb-4">{switcher}</div>}

      <nav aria-label="Sections" className="flex-1 space-y-5 overflow-y-auto">
        {groups.map((g, i) => (
          <div key={i}>
            {g.title && (
              <div className="px-2.5 pb-1.5 text-[11.5px] font-medium" style={{ color: "var(--ink3)" }}>{g.title}</div>
            )}
            <ul className="space-y-0.5">
              {g.items.map((d) => {
                const on = isOn(path, d);
                return (
                  <li key={d.href}>
                    <Link href={d.href} aria-current={on ? "page" : undefined}
                          className="row-link flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13.5px]"
                          style={on
                            ? { background: "var(--s3)", color: "var(--ink)", fontWeight: 600 }
                            : { color: "var(--ink2)", fontWeight: 500 }}>
                      <Icon name={d.icon} size={18} strokeWidth={on ? 2 : 1.7} />
                      {d.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t px-1 pt-3" style={{ borderColor: "var(--line)" }}>{footer}</div>
    </aside>
  );
}

/** Three rising candles, the same mark as the home-screen icon. */
export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden>
      <rect x="2" y="2" width="20" height="20" rx="6" fill="var(--ink)" />
      <rect x="6.2" y="12" width="2.6" height="5" rx="0.8" fill="var(--plane)" />
      <rect x="10.7" y="9" width="2.6" height="7" rx="0.8" fill="var(--plane)" />
      <rect x="15.2" y="6" width="2.6" height="8" rx="0.8" fill="var(--profit)" />
    </svg>
  );
}
