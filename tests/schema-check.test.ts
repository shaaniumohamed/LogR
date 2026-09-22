import { describe, expect, it } from "vitest";
import { expectedObjects, isSchemaBehind, missingFrom } from "@/lib/db/schema-check";

/**
 * The check that turns a blank 500 into a sentence.
 *
 * A database older than the code used to surface as the platform's own error
 * page: a digest number, no cause, and nothing to do about it from a phone.
 * These cover the two halves of knowing better — recognising the failure when
 * it is thrown, and naming what is absent before anything is thrown at all.
 */
describe("isSchemaBehind", () => {
  it("knows the two SQLSTATEs", () => {
    expect(isSchemaBehind({ code: "42P01" })).toBe(true);
    expect(isSchemaBehind({ code: "42703" })).toBe(true);
  });

  it("falls back to the message, because the driver does not always carry the code", () => {
    expect(isSchemaBehind(new Error('column user.active_account_id does not exist'))).toBe(true);
    expect(isSchemaBehind(new Error('relation "invite" does not exist'))).toBe(true);
  });

  it("looks inside cause, which is where a server component leaves it", () => {
    const wrapped = new Error("An error occurred in the Server Components render.", {
      cause: { code: "42703", message: "column user.active_account_id does not exist" },
    });
    expect(isSchemaBehind(wrapped)).toBe(true);
  });

  it("does not mistake a real fault for a missing table", () => {
    expect(isSchemaBehind(new Error("connection terminated unexpectedly"))).toBe(false);
    expect(isSchemaBehind({ code: "23505" })).toBe(false);
    expect(isSchemaBehind(null)).toBe(false);
  });
});

describe("missingFrom", () => {
  const expected = [
    { table: "user", columns: ["id", "email", "active_account_id"] },
    { table: "invite", columns: ["email", "note"] },
  ];

  it("says nothing when the database is current", () => {
    const present = [
      { table: "user", column: "id" },
      { table: "user", column: "email" },
      { table: "user", column: "active_account_id" },
      { table: "invite", column: "email" },
      { table: "invite", column: "note" },
    ];
    expect(missingFrom(expected, present)).toEqual([]);
  });

  it("names a whole missing table once, not once per column", () => {
    const present = [
      { table: "user", column: "id" },
      { table: "user", column: "email" },
      { table: "user", column: "active_account_id" },
    ];
    expect(missingFrom(expected, present)).toEqual(["invite"]);
  });

  it("names a missing column with its table, so it can be searched for", () => {
    const present = [
      { table: "user", column: "id" },
      { table: "user", column: "email" },
      { table: "invite", column: "email" },
      { table: "invite", column: "note" },
    ];
    expect(missingFrom(expected, present)).toEqual(["user.active_account_id"]);
  });

  it("ignores tables the database has and the code does not ask about", () => {
    const present = [
      { table: "user", column: "id" },
      { table: "user", column: "email" },
      { table: "user", column: "active_account_id" },
      { table: "invite", column: "email" },
      { table: "invite", column: "note" },
      { table: "some_old_experiment", column: "whatever" },
    ];
    expect(missingFrom(expected, present)).toEqual([]);
  });
});

describe("expectedObjects", () => {
  it("reads the real schema, so it cannot drift from it", () => {
    const tables = expectedObjects();
    expect(tables.length).toBe(16);
    const user = tables.find((t) => t.table === "user");
    expect(user?.columns).toContain("active_account_id");
  });
});
