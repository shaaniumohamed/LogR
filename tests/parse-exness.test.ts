import { describe, expect, it } from "vitest";
import { parseExnessCsv } from "../lib/core/parse-exness";

const HEADER =
  "ticket,opening_time_utc,closing_time_utc,type,lots,original_position_size,symbol," +
  "opening_price,closing_price,stop_loss,take_profit,commission,swap,profit,equity,margin_level,close_reason";

const row = (o: Partial<Record<string, string>> = {}) => {
  const d: Record<string, string> = {
    ticket: "1", opening_time_utc: "2026-09-18T16:24:28", closing_time_utc: "2026-09-18T16:24:52",
    type: "sell", lots: "0.01", original_position_size: "0.01", symbol: "XAUUSD",
    opening_price: "4370.768", closing_price: "4369.456", stop_loss: "", take_profit: "",
    commission: "", swap: "", profit: "1.31", equity: "", margin_level: "", close_reason: "user",
    ...o,
  };
  return HEADER.split(",").map((h) => d[h] ?? "").join(",");
};
const csv = (...rows: string[]) => [HEADER, ...rows].join("\n");

describe("parseExnessCsv", () => {
  it("parses a normal row", () => {
    const { positions } = parseExnessCsv(csv(row()));
    expect(positions).toHaveLength(1);
    const p = positions[0];
    expect(p.direction).toBe("short");
    expect(p.profit).toBe(1.31);
    expect(p.stopLoss).toBeNull();
    expect(p.closeReason).toBe("user");
    // Column is labelled _utc and carries no suffix — it must be read as UTC.
    expect(p.openedAt.toISOString()).toBe("2026-09-18T16:24:28.000Z");
  });

  it("treats a BLANK profit as zero, not as a missing row", () => {
    // ~1% of a real export: scratch trades where P&L rounds to 0.00 are exported
    // with an empty cell. Dropping them makes the imported net disagree with the
    // broker's, which is the one failure that destroys trust outright.
    const { positions, skipped } = parseExnessCsv(csv(row({ profit: "" })));
    expect(skipped).toHaveLength(0);
    expect(positions).toHaveLength(1);
    expect(positions[0].profit).toBe(0);
  });

  it("treats blank commission and swap as zero", () => {
    const { positions } = parseExnessCsv(csv(row({ commission: "", swap: "" })));
    expect(positions[0].commission).toBe(0);
    expect(positions[0].swap).toBe(0);
  });

  it("captures every close_reason and flags unknown ones", () => {
    const { positions } = parseExnessCsv(
      csv(row({ ticket: "1", close_reason: "user" }), row({ ticket: "2", close_reason: "tp" }),
          row({ ticket: "3", close_reason: "sl" }), row({ ticket: "4", close_reason: "so" }),
          row({ ticket: "5", close_reason: "weird" }))
    );
    expect(positions.map((p) => p.closeReason)).toEqual(["user", "tp", "sl", "so", "unknown"]);
  });

  it("reads a set stop loss but treats 0 as unset", () => {
    const { positions } = parseExnessCsv(
      csv(row({ ticket: "1", stop_loss: "4380.5" }), row({ ticket: "2", stop_loss: "0.00" }))
    );
    expect(positions[0].stopLoss).toBe(4380.5);
    expect(positions[1].stopLoss).toBeNull();
  });

  it("skips non-trade rows without discarding the import", () => {
    const { positions, skipped } = parseExnessCsv(
      csv(row({ ticket: "1" }), row({ ticket: "2", type: "balance" }), row({ ticket: "3", lots: "0" }))
    );
    expect(positions).toHaveLength(1);
    expect(skipped).toHaveLength(2);
    expect(skipped[0].reason).toContain("not a trade");
  });

  it("keeps non-gold symbols — a gold account is not literally gold-only", () => {
    const { positions, summary } = parseExnessCsv(
      csv(row({ ticket: "1" }), row({ ticket: "2", symbol: "BTCUSD" }))
    );
    expect(positions).toHaveLength(2);
    expect(summary.symbols).toEqual({ XAUUSD: 1, BTCUSD: 1 });
  });

  it("rejects a file that is not an order export, and says what to do", () => {
    expect(() => parseExnessCsv("total_profit,gain\n1217.80,620.76")).toThrowError(/Trading Analytics summary|missing column/i);
  });

  it("reconciles net against the broker's own figures", () => {
    const { summary } = parseExnessCsv(
      csv(row({ ticket: "1", profit: "10.00" }), row({ ticket: "2", profit: "-4.50" }),
          row({ ticket: "3", profit: "" }))
    );
    expect(summary.net).toBe(5.5);
    expect(summary.parsed).toBe(3);
  });
});
