import { describe, expect, it } from "vitest";
import { isoSecond, toCsv } from "../lib/core/csv";

const cols = [
  { key: "a", label: "A", value: (r: Record<string, unknown>) => r.a },
  { key: "b", label: "B", value: (r: Record<string, unknown>) => r.b },
];
const body = (s: string) => s.replace("﻿", "").trim().split("\r\n");

describe("toCsv", () => {
  it("writes a header and a row per record", () => {
    expect(body(toCsv([{ a: 1, b: 2 }], cols))).toEqual(["A,B", "1,2"]);
  });

  it("quotes a field containing the separator", () => {
    expect(body(toCsv([{ a: "one,two", b: 1 }], cols))[1]).toBe('"one,two",1');
  });

  it("doubles the quotes inside a quoted field", () => {
    expect(body(toCsv([{ a: 'he said "no"', b: 1 }], cols))[1]).toBe('"he said ""no""",1');
  });

  it("keeps a newline inside one field rather than breaking the row", () => {
    const out = toCsv([{ a: "line one\nline two", b: 1 }], cols).replace("﻿", "");
    expect(out).toContain('"line one\nline two",1');
    // Header, then one record that happens to span two physical lines.
    expect(out.trim().split("\r\n").length).toBe(2);
  });

  it("neutralises a field a spreadsheet would run as a formula", () => {
    // The real risk: this export carries notes the trader typed, and a journal
    // sent to a coach is exactly the file somebody opens without thinking.
    for (const danger of ["=1+1", "+1", "-1", "@SUM(A1)", "\tx"]) {
      const cell = body(toCsv([{ a: danger, b: 1 }], cols))[1].split(",")[0];
      expect(cell.replace(/^"|"$/g, "").startsWith("'")).toBe(true);
    }
  });

  it("leaves an ordinary negative number alone in the numeric column", () => {
    // A number is not a string, so it never reaches the formula guard.
    expect(body(toCsv([{ a: -12.5, b: 1 }], cols))[1]).toBe("-12.5,1");
  });

  it("writes an empty cell for null and undefined", () => {
    expect(body(toCsv([{ a: null, b: undefined }], cols))[1]).toBe(",");
  });

  it("quotes a field with surrounding spaces, which some readers trim", () => {
    expect(body(toCsv([{ a: "  padded  ", b: 1 }], cols))[1]).toBe('"  padded  ",1');
  });

  it("starts with a byte-order mark unless asked not to", () => {
    expect(toCsv([], cols).startsWith("﻿")).toBe(true);
    expect(toCsv([], cols, { bom: false }).startsWith("﻿")).toBe(false);
  });

  it("still writes the header for an empty export", () => {
    expect(body(toCsv([], cols))).toEqual(["A,B"]);
  });
});

describe("isoSecond", () => {
  it("drops the milliseconds a spreadsheet cannot use", () => {
    expect(isoSecond(new Date("2026-09-18T14:32:05.123Z"))).toBe("2026-09-18T14:32:05Z");
  });

  it("is empty for a missing date rather than the word null", () => {
    expect(isoSecond(null)).toBe("");
    expect(isoSecond(undefined)).toBe("");
  });
});
