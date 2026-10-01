import { describe, expect, it } from "vitest";
import { disciplineDays, judgedNotes, streaks, type DisciplineNote } from "@/lib/core/discipline";

const RULES = [{ createdAt: new Date("2026-06-01T00:00:00Z") }];
const trade = (id: string, day: string, net = 1) => ({ id, closedAt: new Date(`${day}T12:00:00Z`), netPnl: net });
const note = (id: string, broken: string[] = [], at = "2026-06-10T00:00:00Z"): DisciplineNote =>
  ({ identityHash: id, updatedAt: new Date(at), rulesBroken: broken, note: "x" });

describe("judgedNotes", () => {
  it("only counts notes written after the first rule existed", () => {
    const notes = [note("a", [], "2026-05-01T00:00:00Z"), note("b")];
    expect(judgedNotes(notes, RULES).map((n) => n.identityHash)).toEqual(["b"]);
  });

  it("judges nothing when there are no rules", () => {
    expect(judgedNotes([note("a")], [])).toEqual([]);
  });

  it("ignores a row with nothing written in it", () => {
    const empty = { identityHash: "a", updatedAt: new Date("2026-06-10T00:00:00Z"), rulesBroken: [] };
    expect(judgedNotes([empty], RULES)).toEqual([]);
  });
});

describe("disciplineDays and streaks", () => {
  const trades = [
    trade("1", "2026-06-10"), trade("2", "2026-06-11"), trade("3", "2026-06-12"),
    trade("4", "2026-06-15"), trade("5", "2026-06-16"),
  ];

  it("marks each day clean, broken or not written up", () => {
    const judged = judgedNotes([note("1"), note("2", ["r1"]), note("4"), note("5")], RULES);
    const days = disciplineDays(trades, judged, "UTC");
    expect(days.map((d) => d.mark)).toEqual(["clean", "broken", "unreviewed", "clean", "clean"]);
  });

  it("counts the current run back from the latest day, and the longest ever", () => {
    const judged = judgedNotes([note("1"), note("2", ["r1"]), note("4"), note("5")], RULES);
    expect(streaks(disciplineDays(trades, judged, "UTC"))).toEqual({ current: 2, best: 2 });
  });

  it("lets an unreviewed day end the run rather than protect it", () => {
    const judged = judgedNotes([note("3"), note("4")], RULES);
    // The latest day (16th) is not written up: the run is zero until it is.
    expect(streaks(disciplineDays(trades, judged, "UTC")).current).toBe(0);
  });

  it("calls a day broken if any judged trade on it broke a rule", () => {
    const mixed = [trade("a", "2026-06-10"), trade("b", "2026-06-10")];
    const judged = judgedNotes([note("a"), note("b", ["r2"])], RULES);
    expect(disciplineDays(mixed, judged, "UTC")[0]).toMatchObject({ mark: "broken", judged: 2, broken: 1 });
  });
});
