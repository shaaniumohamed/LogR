import Link from "next/link";
import { redirect } from "next/navigation";
import { signOut } from "@/auth";
import { requestContext } from "@/lib/session";
import { ZoneSync } from "@/components/zone-sync";
import { TabBar, TopNav } from "@/components/tab-bar";
import { AccountSwitcher } from "@/components/account-switcher";
import { isSchemaBehind, schemaGaps } from "@/lib/db/schema-check";
import { SchemaGapBanner, SchemaGapScreen } from "@/components/schema-gap";

/**
 * Bottom tab bar on phones, inline nav on desktop. The journal's main session is
 * an evening one on a phone, so navigation lives under the thumb rather than in
 * a hamburger two taps away.
 */
const NAV = [
  { href: "/dashboard", label: "Overview", icon: "M3 9l7-6 7 6v9a1 1 0 0 1-1 1h-4v-5H8v5H4a1 1 0 0 1-1-1z" },
  { href: "/calendar", label: "Calendar", icon: "M3 5h14v12H3zM3 8h14M7 3v3M13 3v3" },
  { href: "/trades", label: "Trades", icon: "M4 4h12v12H4zM7 8h6M7 11h4" },
  { href: "/analytics", label: "Patterns", icon: "M4 16V9M8 16V5M12 16v-5M16 16V7" },
  { href: "/review", label: "Review", icon: "M4 3h12v14l-6-3-6 3zM7 7h6M7 10h4" },
  { href: "/settings", label: "More", icon: "M3 6h14M3 10h14M3 14h14" },
] as const;
const DESKTOP_EXTRA = [
  { href: "/week", label: "Week" },
  { href: "/playbook", label: "Playbook" },
  { href: "/import", label: "Import" },
] as const;

/**
 * The context, or the news that the database cannot answer for it yet.
 *
 * Only a schema gap is turned into a value: anything else is still a fault and
 * still belongs on the error path, where it can be seen and fixed.
 */
async function tryContext(): Promise<{ ok: true; ctx: Awaited<ReturnType<typeof requestContext>> } | { ok: false }> {
  try {
    return { ok: true, ctx: await requestContext() };
  } catch (e) {
    if (isSchemaBehind(e)) return { ok: false };
    throw e;
  }
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Both of these are shared, per-request, with whatever page renders inside —
  // the context is memoised and the catalogue answer is kept for the life of the
  // instance once it comes back complete, so the page below adds no crossings of
  // its own for either. They run together because neither needs the other's.
  const [attempt, gaps] = await Promise.all([tryContext(), schemaGaps()]);

  /*
   * A database older than the code used to end here, and end badly.
   *
   * requestContext reads the user row, which now has a column an older database
   * does not, so it threw — and an error thrown by a LAYOUT is not caught by the
   * error.tsx inside it. What reached the reader was the platform's own blank
   * page with a digest on it: no cause, no fix, and no way to tell it apart from
   * the app being down. The gap is knowable and the fix is two lines, so it is
   * worth a screen that says both.
   */
  if (!attempt.ok) return <SchemaGapScreen missing={gaps ?? []} />;
  const ctx = attempt.ctx;
  if (!ctx) redirect("/signin");
  // Access removed while they were still signed in. Nothing of theirs is
  // deleted; they simply stop being let through the door.
  if (!ctx.hasAccess) redirect("/signin?error=AccessRevoked");
  const savedZone = ctx.timeZone;

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col px-4">
      <header className="flex items-center gap-3 py-4 sm:gap-5" style={{ borderBottom: "1px solid var(--line)" }}>
        <Link href="/dashboard" className="shrink-0 text-base font-semibold tracking-tight">LogR</Link>
        <TopNav tabs={[...NAV, ...DESKTOP_EXTRA]} />
        <div className="ml-auto flex min-w-0 items-center gap-3">
          <AccountSwitcher
            accounts={ctx.accounts.map((a) => ({ id: a.id, nickname: a.nickname, kind: a.accountKind }))}
            activeId={ctx.account.id}
          />
        </div>
        <form className="shrink-0" action={async () => { "use server"; await signOut({ redirectTo: "/signin" }); }}>
          <button type="submit" className="tap whitespace-nowrap text-xs" style={{ color: "var(--ink3)" }}>
            Sign out
          </button>
        </form>
      </header>

      <main className="flex-1 py-5 pb-28 sm:pb-8">
        <ZoneSync saved={savedZone} />
        {!!gaps?.length && <SchemaGapBanner missing={gaps} />}
        {children}
      </main>

      <TabBar tabs={NAV} />
    </div>
  );
}
