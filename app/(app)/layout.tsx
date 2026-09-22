import Link from "next/link";
import { redirect } from "next/navigation";
import { signOut } from "@/auth";
import { requestContext } from "@/lib/session";
import { ZoneSync } from "@/components/zone-sync";
import { TabBar, TopNav } from "@/components/tab-bar";
import { AccountSwitcher } from "@/components/account-switcher";
import { schemaIsCurrent } from "@/lib/db/schema-check";

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

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Both of these are shared, per-request, with whatever page renders inside —
  // the context is memoised and the schema probe answers from an instance-level
  // flag once it has succeeded, so the page below adds no crossings of its own
  // for either. They run together because neither needs the other's answer.
  const [ctx, schemaOk] = await Promise.all([requestContext(), schemaIsCurrent()]);
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
        {!schemaOk && (
          <div className="card mb-4 p-4" style={{ borderColor: "var(--warn)" }}>
            <div className="eyebrow" style={{ color: "var(--warn)" }}>Database is behind the app</div>
            <p className="mt-2 text-[13px] leading-relaxed" style={{ color: "var(--ink2)" }}>
              Your trades are safe and everything below still works. Chart mark-up and price
              history are switched off until the database has the tables they need.
            </p>
            <code className="num mt-2 block rounded-lg p-2.5 text-[12px]" style={{ background: "var(--s3)" }}>
              git pull &amp;&amp; npm run db:push
            </code>
            <p className="mt-2 text-[11px]" style={{ color: "var(--ink3)" }}>
              Run it wherever you keep the code. No redeploy needed — reload this page after.
            </p>
          </div>
        )}
        {children}
      </main>

      <TabBar tabs={NAV} />
    </div>
  );
}
