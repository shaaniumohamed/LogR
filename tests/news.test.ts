import { describe, expect, it } from "vitest";
import { newsWindow, parseCalendarCsv, payrollDates } from "../lib/core/news";
import { zonedTime } from "../lib/core/zones";

describe("zonedTime", () => {
  it("resolves a New York wall clock through both halves of the year", () => {
    // 08:30 ET is 13:30 UTC in winter and 12:30 UTC in summer. Getting this
    // wrong puts every payrolls window an hour out for four months of the year.
    expect(zonedTime(2026, 1, 2, 8, 30, "America/New_York").toISOString()).toBe("2026-01-02T13:30:00.000Z");
    expect(zonedTime(2026, 7, 3, 8, 30, "America/New_York").toISOString()).toBe("2026-07-03T12:30:00.000Z");
  });

  it("is exact on a zone that never shifts", () => {
    expect(zonedTime(2026, 7, 3, 9, 0, "Asia/Kuala_Lumpur").toISOString()).toBe("2026-07-03T01:00:00.000Z");
  });
});

describe("payrollDates", () => {
  const year = payrollDates(2026, 2026);

  it("gives one release a month", () => {
    expect(year.length).toBe(12);
  });

  it("always lands on a Friday", () => {
    for (const e of year) expect(e.at.getUTCDay()).toBe(5);
  });

  it("always lands on the FIRST Friday", () => {
    for (const e of year) {
      // Any earlier Friday in the same month would mean the wrong week.
      const d = new Date(e.at);
      expect(d.getUTCDate()).toBeLessThanOrEqual(7);
    }
  });

  it("shifts with New York daylight saving rather than sitting on a fixed hour", () => {
    const jan = year[0], jul = year[6];
    expect(jan.at.toISOString().slice(11, 16)).toBe("13:30");
    expect(jul.at.toISOString().slice(11, 16)).toBe("12:30");
  });

  it("is marked as derived, not as something that was fetched", () => {
    expect(new Set(year.map((e) => e.source))).toEqual(new Set(["derived"]));
    expect(new Set(year.map((e) => e.impact))).toEqual(new Set(["high"]));
  });
});

describe("newsWindow", () => {
  const events = payrollDates(2026, 2026);
  const jul = events[6].at; // 3 July 2026, 12:30 UTC

  it("catches a trade taken just before a release", () => {
    const hit = newsWindow(new Date(jul.getTime() - 10 * 60_000), events);
    expect(hit.event?.title).toBe("US non-farm payrolls");
    expect(hit.minutesFrom).toBe(-10);
  });

  it("catches one taken just after, with the sign the other way", () => {
    expect(newsWindow(new Date(jul.getTime() + 25 * 60_000), events).minutesFrom).toBe(25);
  });

  it("lets a trade outside the window alone", () => {
    expect(newsWindow(new Date(jul.getTime() + 31 * 60_000), events).event).toBeNull();
    expect(newsWindow(new Date(jul.getTime() - 61 * 60_000), events).event).toBeNull();
  });

  it("honours a wider window when asked for one", () => {
    expect(newsWindow(new Date(jul.getTime() + 45 * 60_000), events, 60).minutesFrom).toBe(45);
  });

  it("ignores impacts it was not asked about", () => {
    const soft = [{ ...events[6], impact: "low" as const }];
    expect(newsWindow(jul, soft).event).toBeNull();
    expect(newsWindow(jul, soft, 30, ["low"]).event?.impact).toBe("low");
  });

  it("picks the nearest when two releases overlap", () => {
    const base = new Date("2026-07-03T12:30:00Z");
    const two = [
      { at: base, currency: "USD", title: "far", impact: "high" as const, source: "t" },
      { at: new Date(base.getTime() + 20 * 60_000), currency: "USD", title: "near", impact: "high" as const, source: "t" },
    ];
    expect(newsWindow(new Date(base.getTime() + 18 * 60_000), two).event?.title).toBe("near");
  });

  it("says nothing when there are no events at all", () => {
    expect(newsWindow(new Date(), []).event).toBeNull();
  });
});

describe("parseCalendarCsv", () => {
  it("reads the shape a calendar site exports", () => {
    const csv = [
      "Title,Country,Date,Time,Impact,Forecast,Previous",
      '"Non-Farm Employment Change",USD,09-04-2026,8:30am,High,190K,175K',
      '"ISM Services PMI",USD,09-04-2026,10:00am,Medium,53.1,52.8',
    ].join("\n");
    const r = parseCalendarCsv(csv, "America/New_York");
    expect(r.rows).toBe(2);
    expect(r.skipped).toBe(0);
    expect(r.events[0].title).toBe("Non-Farm Employment Change");
    expect(r.events[0].impact).toBe("high");
    expect(r.events[1].impact).toBe("medium");
    // 8:30 in New York in September is 12:30 UTC.
    expect(r.events[0].at.toISOString()).toBe("2026-09-04T12:30:00.000Z");
  });

  it("reads the times in the zone it is told, not in UTC", () => {
    const csv = "Title,Date,Time,Impact\nCPI,2026-09-10,14:00,High";
    const ny = parseCalendarCsv(csv, "America/New_York").events[0].at.toISOString();
    const utc = parseCalendarCsv(csv, "UTC").events[0].at.toISOString();
    expect(ny).toBe("2026-09-10T18:00:00.000Z");
    expect(utc).toBe("2026-09-10T14:00:00.000Z");
  });

  it("handles a semicolon file and an ISO datetime in one column", () => {
    const csv = "event;date;impact\nECB rate decision;2026-09-10 12:45;red";
    const r = parseCalendarCsv(csv, "UTC");
    expect(r.events[0].title).toBe("ECB rate decision");
    expect(r.events[0].impact).toBe("high");
    expect(r.events[0].at.toISOString()).toBe("2026-09-10T12:45:00.000Z");
  });

  it("skips all-day and tentative entries, which have no window", () => {
    const csv = [
      "Title,Date,Time,Impact",
      "Bank Holiday,2026-09-07,All Day,Holiday",
      "Fed Chair speaks,2026-09-07,Tentative,High",
      "Retail sales,2026-09-07,13:30,High",
    ].join("\n");
    const r = parseCalendarCsv(csv, "UTC");
    expect(r.events.length).toBe(1);
    expect(r.skipped).toBe(2);
  });

  it("works out which number is the day when one of them cannot be a month", () => {
    const r = parseCalendarCsv("Title,Date,Time\nX,18/09/2026,10:00", "UTC");
    expect(r.events[0].at.toISOString().slice(0, 10)).toBe("2026-09-18");
  });

  it("refuses a file it cannot recognise rather than inventing columns", () => {
    const r = parseCalendarCsv("a,b,c\n1,2,3", "UTC");
    expect(r.events).toEqual([]);
    expect(r.skipped).toBeGreaterThan(0);
  });

  it("returns the events in time order", () => {
    const csv = [
      "Title,Date,Time,Impact",
      "Late,2026-09-10,16:00,High",
      "Early,2026-09-10,08:00,High",
    ].join("\n");
    const r = parseCalendarCsv(csv, "UTC");
    expect(r.events.map((e) => e.title)).toEqual(["Early", "Late"]);
  });
});
