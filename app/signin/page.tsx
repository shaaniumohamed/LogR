import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";

/**
 * Which pieces of configuration sign-in actually needs.
 *
 * Reported as present or absent, never by value — the point is to name the
 * missing thing, and a deployment that is broken is already telling anyone who
 * visits that it is broken. Knowing WHICH piece is missing is the difference
 * between a two-minute fix and an evening in the logs.
 */
const REQUIRED = [
  {
    key: "AUTH_SECRET",
    present: () => !!(process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET),
    fix: "Generate one with `npx auth secret`, then add it in your host's environment variables.",
  },
  {
    key: "AUTH_GOOGLE_ID",
    present: () => !!process.env.AUTH_GOOGLE_ID,
    fix: "The OAuth client ID from Google Cloud → Credentials.",
  },
  {
    key: "AUTH_GOOGLE_SECRET",
    present: () => !!process.env.AUTH_GOOGLE_SECRET,
    fix: "The OAuth client secret from the same Google credential.",
  },
  {
    key: "DATABASE_URL",
    present: () => !!process.env.DATABASE_URL,
    fix: "The pooled Neon connection string — the host contains `-pooler`.",
  },
] as const;

/** Auth.js hands back a code, not a sentence. These are the sentences. */
const EXPLAIN: Record<string, { title: string; body: string }> = {
  Configuration: {
    title: "The server is missing something it needs",
    body: "Sign-in could not start because a setting is absent or wrong. If nothing is listed below, the values are present but one of them is not valid — most often a Google client ID and secret that belong to different credentials.",
  },
  AccessDenied: {
    title: "That address is not on the list",
    body: "Sign-in worked, but the address Google returned is not in ALLOWED_EMAILS, so the journal turned it away. Add the address exactly as Google gives it, or clear ALLOWED_EMAILS to let any Google account in. Either change needs a redeploy.",
  },
  Verification: {
    title: "That link has expired",
    body: "Start again from this page.",
  },
};

export default async function SignIn({ searchParams }: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  // Must survive the very misconfiguration it is reporting: when the secret is
  // absent this call is one of the things that throws, and a 500 here would
  // replace the explanation with nothing.
  try {
    const session = await auth();
    if (session?.user) redirect("/dashboard");
  } catch (e) {
    if (e && typeof e === "object" && "digest" in e) throw e; // redirect() uses one
  }

  const missing = REQUIRED.filter((r) => !r.present());
  const explained = error ? EXPLAIN[error] ?? {
    title: "Sign-in did not complete",
    body: `Google returned: ${error}`,
  } : null;

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm space-y-4">
        <div className="card p-8">
          <h1 className="text-2xl font-semibold tracking-tight">LogR</h1>
          <p className="mt-2 text-sm" style={{ color: "var(--ink2)" }}>
            A trade journal for leveraged traders. Import your broker history and find
            out what is actually working.
          </p>

          <form
            className="mt-7"
            action={async () => {
              "use server";
              await signIn("google", { redirectTo: "/dashboard" });
            }}
          >
            <button
              type="submit"
              className="w-full rounded-lg px-4 py-3 text-sm font-semibold"
              style={{ background: "var(--ink)", color: "var(--plane)" }}
            >
              Continue with Google
            </button>
          </form>

          <p className="mt-5 text-xs leading-relaxed" style={{ color: "var(--ink3)" }}>
            We never ask for a broker password. Import is a file you export yourself.
          </p>
        </div>

        {explained && (
          <div className="card p-5" style={{ borderColor: "var(--loss)" }}>
            <div className="eyebrow" style={{ color: "var(--loss)" }}>{explained.title}</div>
            <p className="mt-2 text-[13px] leading-relaxed" style={{ color: "var(--ink2)" }}>
              {explained.body}
            </p>
          </div>
        )}

        {missing.length > 0 && (
          <div className="card p-5" style={{ borderColor: "var(--loss)" }}>
            <div className="eyebrow" style={{ color: "var(--loss)" }}>
              {missing.length === 1 ? "One setting is missing" : `${missing.length} settings are missing`}
            </div>
            <ul className="mt-3 space-y-2.5">
              {missing.map((m) => (
                <li key={m.key}>
                  <code className="num text-[12px] font-semibold">{m.key}</code>
                  <div className="mt-0.5 text-[12px] leading-relaxed" style={{ color: "var(--ink2)" }}>
                    {m.fix}
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[11px] leading-relaxed" style={{ color: "var(--ink3)" }}>
              Add them to your host&rsquo;s environment variables and deploy again — a running
              deployment keeps the values it was built with, so the change needs a new one.
              Only whether each is set is shown here; no value is ever read back.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
