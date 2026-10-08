import { describe, expect, it } from "vitest";
import { easterSunday, goodFriday, marketHoliday } from "@/lib/core/market/calendar";

describe("gold market holidays", () => {
  it("finds Easter and Good Friday for every year of the stored history", () => {
    expect(easterSunday(2024)).toEqual([3, 31]);
    expect(easterSunday(2019)).toEqual([4, 21]);
    expect([2015, 2016, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026].map(goodFriday)).toEqual([
      "2015-04-03", "2016-03-25", "2019-04-19", "2020-04-10", "2021-04-02",
      "2022-04-15", "2023-04-07", "2024-03-29", "2025-04-18", "2026-04-03",
    ]);
  });

  it("names the fixed holidays and the weekdays they move to", () => {
    expect(marketHoliday("2025-12-25")).toBe("Christmas Day");
    expect(marketHoliday("2026-01-01")).toBe("New Year's Day");
    expect(marketHoliday("2016-12-26")).toMatch(/Christmas/); // Christmas on a Sunday
    expect(marketHoliday("2021-12-24")).toMatch(/Christmas/); // Christmas on a Saturday
    expect(marketHoliday("2017-01-02")).toMatch(/New Year/); // New Year on a Sunday
    expect(marketHoliday("2021-12-31")).toMatch(/New Year/); // New Year 2022 on a Saturday
  });

  it("leaves ordinary days alone, including ones that only look like holidays", () => {
    for (const d of ["2016-03-28", "2024-09-30", "2018-12-31", "2023-12-26", "2025-12-24", "2025-06-30"]) {
      expect(marketHoliday(d)).toBeNull();
    }
    expect(marketHoliday("not a day")).toBeNull();
  });
});
