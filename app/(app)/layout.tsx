import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth, signOut } from "@/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { ZoneSync } from "@/components/zone-sync";
import { TabBar, TopNav } from "@/components/tab-bar";
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
  { href: "/playbook", label: "Playbook" },
  { href: "/import", label: "Import" },
] as const;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  const me = await db.query.users.findFirst({ where: eq(users.id, session.user.id!) });
  const savedZone = me?.timeZone ?? "UTC";
  // Deploying is one step and migrating is another, and nothing links them. When
  // they come apart, say so here rather than letting a page fail with a digest.
  const schemaOk = await schemaIsCurrent();

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col px-4">
      <header className="flex items-center gap-5 py-4" style={{ borderBottom: "1px solid var(--line)" }}>
        <Link href="/dashboard" className="text-base font-semibold tracking-tight">LogR</Link>
        <TopNav tabs={[...NAV, ...DESKTOP_EXTRA]} />
        <form className="ml-auto" action={async () => { "use server"; await signOut({ redirectTo: "/signin" }); }}>
          <button type="submit" className="text-xs" style={{ color: "var(--ink3)" }}>Sign out</button>
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
