import Link from "next/link";
import { signOut } from "@/auth";
import { requireContext } from "@/lib/session";
import { Icon, type IconName } from "@/components/icons";

export const metadata = { title: "More" };

/**
 * Everything that is not one of the four tabs, as a list rather than a page.
 *
 * The old "More" tab opened Settings, so a person looking for their weekly
 * review or the calendar landed on a screen of time zones and export buttons
 * and had to know the thing they wanted lived elsewhere. Grouped the way the
 * desktop sidebar is, so the app has one map and two ways of drawing it.
 */
interface Row { href: string; icon: IconName; label: string; hint: string }

const GROUPS: { title: string; rows: Row[] }[] = [
  {
    title: "Journal",
    rows: [
      { href: "/calendar", icon: "calendar", label: "Calendar", hint: "Every day, coloured by result" },
      { href: "/week", icon: "week", label: "Weekly review", hint: "How the week went, and what to fix" },
      { href: "/playbook", icon: "playbook", label: "Playbook", hint: "Your setups and your rules" },
    ],
  },
  {
    title: "Data",
    rows: [
      { href: "/import", icon: "upload", label: "Import trades", hint: "Add a statement from your broker" },
      { href: "/import?tab=candles", icon: "candles", label: "Price history", hint: "Charts for every trade" },
      { href: "/import?tab=news", icon: "news", label: "News calendar", hint: "Mark trades taken into a release" },
    ],
  },
  {
    title: "Account",
    rows: [
      { href: "/settings", icon: "settings", label: "Settings", hint: "Appearance, time zone, accounts, export" },
    ],
  },
];

export default async function More() {
  const ctx = await requireContext();

  return (
    <div className="space-y-6 pt-2">
      <h1 className="text-[26px] font-semibold tracking-tight">More</h1>

      {GROUPS.map((g) => (
        <section key={g.title}>
          <h2 className="px-1 pb-2 text-[13px] font-medium" style={{ color: "var(--ink3)" }}>{g.title}</h2>
          <ul className="card divide-y overflow-hidden !p-0" style={{ borderColor: "var(--line)" }}>
            {g.rows.map((r) => (
              <li key={r.href} style={{ borderColor: "var(--line)" }}>
                <Link href={r.href} className="row-link flex items-center gap-3.5 px-4 py-3.5">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px]"
                        style={{ background: "var(--s3)", color: "var(--ink)" }}>
                    <Icon name={r.icon} size={19} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-medium">{r.label}</span>
                    <span className="block truncate text-[12.5px]" style={{ color: "var(--ink3)" }}>{r.hint}</span>
                  </span>
                  <Icon name="chevron" size={16} className="opacity-40" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <form action={async () => { "use server"; await signOut({ redirectTo: "/signin" }); }}>
        <button type="submit" className="card row-link flex w-full items-center gap-3.5 px-4 py-3.5 text-left">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px]"
                style={{ background: "var(--s3)", color: "var(--loss)" }}>
            <Icon name="signout" size={19} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-medium" style={{ color: "var(--loss)" }}>Sign out</span>
            {ctx.email && <span className="block truncate text-[12.5px]" style={{ color: "var(--ink3)" }}>{ctx.email}</span>}
          </span>
        </button>
      </form>
    </div>
  );
}
