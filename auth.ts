import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { db } from "@/lib/db";
import { accounts, sessions, users, verificationTokens } from "@/lib/db/schema";

/**
 * Auth.js v5 with Google OAuth. Free, no monthly-active-user ceiling, and no
 * password for us to store or leak. The Drizzle adapter persists users and
 * linked accounts; sessions are JWTs so route protection needs no DB round trip.
 */
const allowList = (process.env.ALLOWED_EMAILS ?? "")
  .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  providers: [Google],
  session: { strategy: "jwt" },
  // Errors land on our own sign-in page rather than Auth.js's generic one, which
  // says "there is a problem with the server configuration" and leaves you to
  // guess which part. Ours names the missing setting.
  pages: { signIn: "/signin", error: "/signin" },
  callbacks: {
    /** Optional private-beta gate: set ALLOWED_EMAILS to lock the app down. */
    signIn({ user }) {
      if (allowList.length === 0) return true;
      return !!user.email && allowList.includes(user.email.toLowerCase());
    },
    jwt({ token, user }) {
      if (user?.id) token.uid = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.uid && session.user) session.user.id = token.uid as string;
      return session;
    },
  },
});
