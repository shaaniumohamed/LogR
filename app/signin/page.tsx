import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";

export default async function SignIn() {
  const session = await auth();
  if (session?.user) redirect("/dashboard");

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="card w-full max-w-sm p-8">
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
    </main>
  );
}
