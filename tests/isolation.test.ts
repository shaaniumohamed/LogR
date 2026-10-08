import { execFileSync } from "node:child_process";
import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Two people, one deployment: can either of them touch the other's journal?
 *
 * These exercise the SERVER ACTIONS, which the HTTP isolation script cannot
 * reach — an action is addressed by a build-time id, so driving one over the
 * wire would be a test of that id rather than of the guard inside it. Calling
 * the exported function with a forged session is the same thing a stranger
 * would be doing if they could address it.
 *
 * They need a real database because the guards ARE database queries, and they
 * SEED IT THEMSELVES rather than trusting what is already there — a security
 * test that quietly passes because the fixture it expected was missing is worse
 * than no test. That seeding wipes the database, which is why the seeder
 * refuses anything that looks like a hosted connection string.
 *
 * Set TEST_DATABASE_URL to a throwaway local Postgres. Without it these skip
 * rather than pretend.
 */
const DB = process.env.TEST_DATABASE_URL;
const run = DB ? describe : describe.skip;

/** Whoever the next action call will believe it is talking to. */
let currentUser: { id: string; email: string } | null = null;

vi.mock("@/auth", () => ({
  auth: async () =>
    currentUser ? { user: { id: currentUser.id, email: currentUser.email } } : null,
}));

// Server actions revalidate paths, which needs a request the tests do not have.
vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
}));

const ALICE = { id: "u-alice", email: "alice@example.com" };
const BOB = { id: "u-bob", email: "bob@example.com" };

run("one trader cannot reach another's journal", () => {
  let actions: typeof import("@/lib/actions");
  let queries: typeof import("@/lib/queries");

  beforeAll(async () => {
    process.env.DATABASE_URL = DB;
    process.env.OWNER_EMAILS = "alice@example.com";
    // Built fresh, so a passing run means the guards held rather than that the
    // rows these assertions look for were never there.
    execFileSync(process.execPath, ["scripts/seed-two-users.mjs", DB!], { stdio: "pipe" });
    actions = await import("@/lib/actions");
    queries = await import("@/lib/queries");
  });

  const asUser = (u: typeof ALICE) => { currentUser = u; };

  describe("notes and mark-up", () => {
    it("refuses to annotate a trade belonging to someone else", async () => {
      asUser(BOB);
      const form = new FormData();
      form.set("note", "BOB WAS HERE");
      const r = await actions.saveAnnotation("u-alice-trade-1", form);
      expect(r.ok).toBe(false);

      asUser(ALICE);
      const mine = await actions.loadAnnotation("a-alice", "u-alice-trade-1");
      expect(mine?.note).toBe("SECRET-NOTE-OF-ALICE-1");
    });

    it("refuses to draw on a trade belonging to someone else", async () => {
      asUser(BOB);
      const r = await actions.saveDrawings("u-alice-trade-2", [
        { id: "x", kind: "level", low: 1, high: 1, label: "BOB WAS HERE" },
      ]);
      expect(r.ok).toBe(false);

      // The drawing kit's document shape is refused the same way.
      const r2 = await actions.saveDrawings("u-alice-trade-2", {
        v: 2, drawings: [{ id: "x", kind: "horizontal-line", points: [{ time: 1_789_450_800, price: 1 }], style: { text: "BOB WAS HERE" } }],
      });
      expect(r2.ok).toBe(false);

      asUser(ALICE);
      const mine = await actions.loadAnnotation("a-alice", "u-alice-trade-2");
      expect(mine?.drawings ?? null).toBeNull();
    });

    it("refuses a quick write-up on a trade belonging to someone else", async () => {
      asUser(BOB);
      const form = new FormData();
      form.set("identityHash", "u-alice-trade-1");
      form.set("setup", "Sweep + reversal");
      form.set("emotion", "fomo");
      form.set("rules", "kept");
      form.set("note", "BOB WAS HERE");
      const r = await actions.saveQuickNote(null, form);
      expect(r.ok).toBe(false);

      asUser(ALICE);
      const mine = await actions.loadAnnotation("a-alice", "u-alice-trade-1");
      expect(mine?.note).toBe("SECRET-NOTE-OF-ALICE-1");
      expect(mine?.emotion).not.toBe("fomo");
    });

    it("still lets each of them write on their own", async () => {
      asUser(BOB);
      const form = new FormData();
      form.set("note", "Bob's own revision");
      expect((await actions.saveAnnotation("u-bob-trade-1", form)).ok).toBe(true);
      const mine = await actions.loadAnnotation("a-bob", "u-bob-trade-1");
      expect(mine?.note).toBe("Bob's own revision");
    });
  });

  describe("accounts", () => {
    it("refuses to switch to an account that is not theirs", async () => {
      asUser(BOB);
      const form = new FormData();
      form.set("accountId", "a-alice");
      const r = await actions.switchAccount(null, form);
      expect(r?.error).toBeTruthy();

      // And the journal Bob is shown is still his own.
      const { account, all } = await queries.loadTrades("all");
      expect(account.id).toBe("a-bob");
      expect(all.every((t) => t.id.startsWith("u-bob"))).toBe(true);
    });

    it("refuses to rename an account that is not theirs", async () => {
      asUser(BOB);
      const form = new FormData();
      form.set("accountId", "a-alice");
      form.set("nickname", "Taken over");
      expect((await actions.renameAccount(null, form))?.error).toBeTruthy();

      asUser(ALICE);
      const ctx = await (await import("@/lib/session")).requestContext();
      expect(ctx?.account.nickname).toBe("Alice's main");
    });

    it("refuses to delete an account that is not theirs", async () => {
      asUser(BOB);
      const form = new FormData();
      form.set("accountId", "a-alice");
      form.set("confirm", "Alice's main");
      expect((await actions.deleteAccount(null, form))?.error).toBeTruthy();

      asUser(ALICE);
      const { all } = await queries.loadTrades("all");
      expect(all.length).toBe(5);
    });
  });

  describe("rules", () => {
    it("refuses to retire a rule belonging to someone else", async () => {
      asUser(BOB);
      const form = new FormData();
      form.set("id", "r-u-alice");
      form.set("active", "false");
      await actions.setRuleActive(null, form);

      asUser(ALICE);
      const rules = await actions.loadRules("a-alice");
      expect(rules.find((r) => r.id === "r-u-alice")?.active).toBe(true);
    });
  });

  describe("who is allowed in", () => {
    it("refuses to invite anyone when you are not an owner", async () => {
      asUser(BOB);
      const form = new FormData();
      form.set("email", "stranger@example.com");
      expect((await actions.inviteFriend(null, form)).error).toBeTruthy();
    });

    it("refuses to revoke anyone when you are not an owner", async () => {
      asUser(BOB);
      const form = new FormData();
      form.set("email", "bob@example.com");
      expect((await actions.revokeInvite(null, form)).error).toBeTruthy();
    });

    it("will not list anyone's address to a non-owner", async () => {
      const access = await import("@/lib/access");
      asUser(BOB);
      expect(await access.listInvites()).toEqual([]);
      asUser(ALICE);
      expect((await access.listInvites()).map((i) => i.email)).toContain("bob@example.com");
    });
  });

  describe("a session for a user who is not there", () => {
    it("resolves to nothing rather than to somebody", async () => {
      asUser({ id: "u-nobody", email: "mallory@example.com" });
      const { requestContext } = await import("@/lib/session");
      expect(await requestContext()).toBeNull();
    });

    it("is refused by every action it can reach", async () => {
      asUser({ id: "u-nobody", email: "mallory@example.com" });
      const form = new FormData();
      form.set("note", "hello");
      expect((await actions.saveAnnotation("u-alice-trade-0", form)).ok).toBe(false);
      form.set("identityHash", "u-alice-trade-0");
      expect((await actions.saveQuickNote(null, form)).ok).toBe(false);
      expect((await actions.saveDrawings("u-alice-trade-0", [])).ok).toBe(false);
      const bt = await import("@/lib/backtest-actions");
      expect((await bt.createSession({ strategyId: "bt-strategy-alice", start: { random: true } })).ok).toBe(false);
      expect((await bt.recordSession("bt-session-alice", { expectedVersion: 0, clockAt: 1, events: [], state: {}, trades: [] })).ok).toBe(false);
      expect((await actions.saveWeeklyNote("2026-09-14", new FormData())).ok).toBe(false);
      expect((await actions.addRule(null, new FormData())).error).toBeTruthy();
    });
  });

  describe("weekly reviews", () => {
    it("keeps each trader's review to their own account", async () => {
      asUser(BOB);
      const form = new FormData();
      form.set("focus", "BOB OVERWRITE ATTEMPT");
      await actions.saveWeeklyNote("2026-09-14", form);

      asUser(ALICE);
      const mine = await actions.loadWeeklyNote("a-alice", "2026-09-14");
      expect(mine?.focus).toBe("SECRET-FOCUS-OF-ALICE");

      asUser(BOB);
      const bobs = await actions.loadWeeklyNote("a-bob", "2026-09-14");
      expect(bobs?.focus).toBe("BOB OVERWRITE ATTEMPT");
    });
  });

  describe("backtests stay with the person who ran them", () => {
    let bt: typeof import("@/lib/backtest-actions");
    let data: typeof import("@/lib/backtest-data");

    beforeAll(async () => {
      bt = await import("@/lib/backtest-actions");
      data = await import("@/lib/backtest-data");
    });

    it("keeps the backtester to owners while it is new", async () => {
      asUser(BOB);
      expect((await bt.createStrategy(null, Object.assign(new FormData(), {}))).error).toBeTruthy();
      expect((await bt.saveSessionView("bt-session-alice", { clockAt: 1, timeframe: "5m" })).ok).toBe(false);
    });

    it("does not let one owner read or change another owner's backtests", async () => {
      process.env.OWNER_EMAILS = "alice@example.com,bob@example.com";
      try {
        expect(await data.loadSession("u-bob", "bt-session-alice")).toBeNull();
        expect(await data.loadStrategy("u-bob", "bt-strategy-alice")).toBeNull();
        expect(await data.loadBtTrades("u-bob", { sessionId: "bt-session-alice" })).toEqual([]);
        expect((await data.loadSessionList("u-bob")).length).toBe(0);

        asUser(BOB);
        expect((await bt.saveSessionView("bt-session-alice", { clockAt: 1, timeframe: "1m", name: "BOB WAS HERE" })).ok).toBe(false);
        expect((await bt.saveSessionDrawings("bt-session-alice", { v: 2, drawings: [] }, {})).ok).toBe(false);
        expect((await bt.recordSession("bt-session-alice", { expectedVersion: 0, clockAt: 1, events: [], state: {}, trades: [] })).ok).toBe(false);
        expect((await bt.updateStrategy("bt-strategy-alice", { name: "BOB WAS HERE" })).ok).toBe(false);
        expect((await bt.createSession({ strategyId: "bt-strategy-alice", start: { random: true } })).ok).toBe(false);
        await bt.deleteSession("bt-session-alice");
        await bt.deleteStrategy("bt-strategy-alice");

        asUser(ALICE);
        const session = await data.loadSession("u-alice", "bt-session-alice");
        expect(session?.name).toBe("SECRET-BT-SESSION-OF-ALICE");
        expect((await data.loadStrategy("u-alice", "bt-strategy-alice"))?.name).toBe("SECRET-BT-OF-ALICE");
        expect(await data.loadBtTrades("u-alice", { sessionId: "bt-session-alice" })).toHaveLength(1);
      } finally {
        process.env.OWNER_EMAILS = "alice@example.com";
      }
    });
  });
});
