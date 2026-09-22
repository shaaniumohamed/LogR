import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { db } from "@/lib/db";
import { accounts, sessions, users, verificationTokens } from "@/lib/db/schema";
import { canSignIn } from "@/lib/access";

/**
 * Pin the URL Auth.js builds its OAuth callback from.
 *
 * Left to itself on Vercel it derives that from VERCEL_URL, which is the
 * PER-DEPLOYMENT hostname — log-pxq9tkol8-….vercel.app, a different one on
 * every push. Google only accepts redirect URIs registered in advance and
 * exactly, so a callback built from that hostname is rejected every single
 * time, with redirect_uri_mismatch naming a URL that did not exist yesterday
 * and will not exist tomorrow.
 *
 * VERCEL_PROJECT_PRODUCTION_URL is the stable production domain, which is the
 * one worth registering. Using it when AUTH_URL has not been set means a fresh
 * deployment signs in with no manual configuration at all; setting AUTH_URL
 * still wins, which is what a custom domain needs.
 */
if (process.env.AUTH_URL) {
  // A pasted URL very often carries a trailing slash, which would build a
  // callback with a doubled slash in it. Google matches the redirect URI as a
  // literal string, so that one character is the difference between signing in
  // and redirect_uri_mismatch — and it is invisible in the error message.
  process.env.AUTH_URL = process.env.AUTH_URL.trim().replace(/\/+$/, "");
} else if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
  process.env.AUTH_URL = `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
}

/**
 * Auth.js v5 with Google OAuth. Free, no monthly-active-user ceiling, and no
 * password for us to store or leak. The Drizzle adapter persists users and
 * linked accounts; sessions are JWTs so route protection needs no DB round trip.
 */
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
    /**
     * The gate: owners from the environment, plus anyone they have invited.
     *
     * One query, and only at sign-in rather than on every request, so the cost
     * is a few milliseconds once a month per person.
     */
    signIn({ user }) {
      return canSignIn(user.email);
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
