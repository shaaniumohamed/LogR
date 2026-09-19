import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";

/**
 * Bottom tab bar on phones, inline nav on desktop. The journal's main session is
 * an evening one on a phone, so navigation lives under the thumb rather than in
 * a hamburger two taps away.
 */
const NAV = [
  { href: "/dashboard", label: "Overview", icon: "M3 9l7-6 7 6v9a1 1 0 0 1-1 1h-4v-5H8v5H4a1 1 0 0 1-1-1z" },
  { href: "/trades", label: "Trades", icon: "M4 4h12v12H4zM7 8h6M7 11h4" },
  { href: "/analytics", label: "Patterns", icon: "M4 16V9M8 16V5M12 16v-5M16 16V7" },
  { href: "/import", label: "Import", icon: "M10 3v10M6 9l4 4 4-4M4 17h12" },
  { href: "/settings", label: "Settings", icon: "M3 6h14M3 10h14M3 14h14" },
] as const;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col px-4">
      <header className="flex items-center gap-5 py-4" style={{ borderBottom: "1px solid var(--line)" }}>
        <Link href="/dashboard" className="text-base font-semibold tracking-tight">LogR</Link>
        <nav className="hidden gap-4 text-sm sm:flex" style={{ color: "var(--ink2)" }}>
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="hover:underline">{n.label}</Link>
          ))}
        </nav>
        <form className="ml-auto" action={async () => { "use server"; await signOut({ redirectTo: "/signin" }); }}>
          <button type="submit" className="text-xs" style={{ color: "var(--ink3)" }}>Sign out</button>
        </form>
      </header>

      <main className="flex-1 py-5 pb-28 sm:pb-8">{children}</main>

      <nav aria-label="Sections"
           className="fixed inset-x-0 bottom-0 z-30 border-t sm:hidden"
           style={{
             borderColor: "var(--line)",
             background: "color-mix(in srgb, var(--plane) 92%, transparent)",
             backdropFilter: "blur(12px)",
             paddingBottom: "env(safe-area-inset-bottom, 0px)",
           }}>
        <div className="mx-auto grid max-w-3xl grid-cols-5">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href}
                  className="flex flex-col items-center gap-1 py-2.5 text-[10px] font-medium"
                  style={{ color: "var(--ink2)" }}>
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5}
                   strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                <path d={n.icon} />
              </svg>
              {n.label}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}
