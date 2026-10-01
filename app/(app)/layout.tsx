import Link from "next/link";
import { redirect } from "next/navigation";
import { signOut } from "@/auth";
import { requestContext } from "@/lib/session";
import { ZoneSync } from "@/components/zone-sync";
import { Logo, Sidebar, TabBar } from "@/components/nav";
import { Icon } from "@/components/icons";
import { AccountSwitcher } from "@/components/account-switcher";
import { isSchemaBehind, schemaGaps } from "@/lib/db/schema-check";
import { auth } from "@/auth";
import { isOwner } from "@/lib/access";
import { SchemaGapBanner, SchemaGapScreen } from "@/components/schema-gap";

/**
 * Owner, without asking the database.
 *
 * Needed on the path where the database is exactly what could not be read, so
 * it comes from the session and the environment list, both of which are still
 * available when every query is failing.
 */
async function viewerIsOwner(): Promise<boolean> {
  const session = await auth();
  return isOwner(session?.user?.email);
}

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
  if (!attempt.ok) return <SchemaGapScreen missing={gaps ?? []} owner={await viewerIsOwner()} />;
  const ctx = attempt.ctx;
  if (!ctx) redirect("/signin");
  // Access removed while they were still signed in. Nothing of theirs is
  // deleted; they simply stop being let through the door.
  if (!ctx.hasAccess) redirect("/signin?error=AccessRevoked");
  const savedZone = ctx.timeZone;

  const switcher = (
    <AccountSwitcher
      accounts={ctx.accounts.map((a) => ({ id: a.id, nickname: a.nickname, kind: a.accountKind }))}
      activeId={ctx.account.id}
    />
  );
  const signOutForm = (
    <form action={async () => { "use server"; await signOut({ redirectTo: "/signin" }); }}>
      <button type="submit" className="row-link flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13.5px] font-medium"
              style={{ color: "var(--ink2)" }}>
        <Icon name="signout" size={18} />
        <span className="min-w-0 flex-1 truncate text-left">Sign out</span>
      </button>
      {ctx.email && (
        <div className="truncate px-2.5 pt-1 text-[11.5px]" style={{ color: "var(--ink3)" }}>{ctx.email}</div>
      )}
    </form>
  );

  return (
    <div className="min-h-screen">
      <Sidebar switcher={ctx.accounts.length > 1 ? switcher : null} footer={signOutForm} />

      <div className="lg:pl-[232px]">
        {/*
          Phones: the wordmark and, when there is a choice, the account. Sign-out
          used to sit here, in the most valuable strip of the screen, for an
          action taken once a month; it lives in More now.
        */}
        <header className="sticky top-0 z-20 flex items-center gap-3 px-4 py-3 lg:hidden"
                style={{
                  background: "color-mix(in srgb, var(--plane) 88%, transparent)",
                  backdropFilter: "saturate(1.6) blur(16px)",
                  WebkitBackdropFilter: "saturate(1.6) blur(16px)",
                  paddingTop: "max(12px, env(safe-area-inset-top))",
                }}>
          <Link href="/dashboard" className="flex shrink-0 items-center gap-2">
            <Logo size={24} />
            <span className="text-[17px] font-semibold tracking-tight">LogR</span>
          </Link>
          <div className="ml-auto min-w-0">{switcher}</div>
        </header>

        <main className="mx-auto w-full max-w-3xl px-4 pb-28 pt-2 lg:max-w-[1120px] lg:px-10 lg:pb-12 lg:pt-8">
          <ZoneSync saved={savedZone} />
          {!!gaps?.length && <SchemaGapBanner missing={gaps} owner={ctx.isOwner} />}
          {children}
        </main>
      </div>

      <TabBar />
    </div>
  );
}
