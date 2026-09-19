import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/import", label: "Import" },
] as const;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col px-4">
      <header
        className="flex items-center gap-4 py-4"
        style={{ borderBottom: "1px solid var(--line)" }}
      >
        <Link href="/dashboard" className="text-base font-semibold tracking-tight">
          LogR
        </Link>
        <nav className="flex gap-3 text-sm" style={{ color: "var(--ink2)" }}>
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="hover:underline">
              {n.label}
            </Link>
          ))}
        </nav>
        <form
          className="ml-auto"
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/signin" });
          }}
        >
          <button type="submit" className="text-xs" style={{ color: "var(--ink3)" }}>
            Sign out
          </button>
        </form>
      </header>
      <main className="flex-1 py-6">{children}</main>
    </div>
  );
}
