import { describe, expect, it } from "vitest";
import { accountNumberFromFilename, detectMismatch, sampleTickets } from "@/lib/core/import-guard";

/**
 * The check that would have saved the afternoon this was written in: a
 * statement from a second account, imported into the main journal, with no
 * symptom afterwards except numbers that were quietly wrong.
 */
describe("detectMismatch", () => {
  const base = { storedLogin: null, fileLogin: null, existingInSpan: 0, matchingTickets: 0 };

  it("settles it on the account number when both sides have one", () => {
    expect(detectMismatch({ ...base, storedLogin: "111", fileLogin: "222" }))
      .toEqual({ kind: "login", stored: "111", found: "222" });
    expect(detectMismatch({ ...base, storedLogin: "111", fileLogin: "111" })).toBeNull();
  });

  it("catches a file covering dates this account has, sharing not one ticket", () => {
    expect(detectMismatch({ ...base, existingInSpan: 400, matchingTickets: 0 }))
      .toEqual({ kind: "overlap", existingInSpan: 400 });
  });

  it("lets a continuation through: later dates have nothing to disagree with", () => {
    expect(detectMismatch({ ...base, existingInSpan: 0, matchingTickets: 0 })).toBeNull();
  });

  it("lets a re-import of the same range through, which is the normal case", () => {
    expect(detectMismatch({ ...base, existingInSpan: 400, matchingTickets: 400 })).toBeNull();
  });

  it("stays quiet on a nearly empty account, where the signal means nothing", () => {
    expect(detectMismatch({ ...base, existingInSpan: 4, matchingTickets: 0 })).toBeNull();
  });
});

describe("accountNumberFromFilename", () => {
  it("finds the account in the names brokers actually produce", () => {
    expect(accountNumberFromFilename("ExnessOrders_12345678.csv")).toBe("12345678");
    expect(accountNumberFromFilename("report-123456789-20260101.csv")).toBe("123456789");
  });

  it("does not mistake a date stamp for an account", () => {
    expect(accountNumberFromFilename("orders_20260101_20260930.csv")).toBeNull();
  });

  it("keeps an eight-digit account, which is a real length", () => {
    expect(accountNumberFromFilename("87654321_orders_20260101.csv")).toBe("87654321");
  });

  it("has nothing to say about a name with no number in it", () => {
    expect(accountNumberFromFilename("orders (2).csv")).toBeNull();
    expect(accountNumberFromFilename("history.csv")).toBeNull();
  });
});

describe("sampleTickets", () => {
  it("takes both ends, because that is where an overlap shows", () => {
    const all = Array.from({ length: 5000 }, (_, i) => `t${i}`);
    const s = sampleTickets(all, 400);
    expect(s.length).toBe(400);
    expect(s).toContain("t0");
    expect(s).toContain("t4999");
  });

  it("takes everything when there is little, and never repeats one", () => {
    expect(sampleTickets(["a", "b", "a"])).toEqual(["a", "b"]);
  });
});
