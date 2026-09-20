import { describe, expect, it } from "vitest";
import { aggregate, checkAlignment, parseCandleCsv } from "../lib/core/parse-candles";

describe("parseCandleCsv", () => {
  it("reads HistData's semicolon format with no header", () => {
    const csv = [
      "20260918 143000;4350.10;4351.20;4349.80;4350.90;0",
      "20260918 143100;4350.90;4352.00;4350.50;4351.70;0",
    ].join("\n");
    const { candles, format } = parseCandleCsv(csv);
    expect(candles).toHaveLength(2);
    expect(format).toContain("no header");
    expect(candles[0].open).toBe(4350.1);
    expect(new Date(candles[0].time * 1000).toISOString()).toBe("2026-09-18T14:30:00.000Z");
  });

  it("shifts by a fixed offset when the source is not UTC", () => {
    // Read as UTC, a file published elsewhere lands hours out and every trade
    // marker sits against the wrong bar.
    const csv = "20260918 143000;4350.10;4351.20;4349.80;4350.90;0";
    const utc = parseCandleCsv(csv).candles[0].time;
    const eastern = parseCandleCsv(csv, { offsetMinutes: -300 }).candles[0].time;
    expect(eastern - utc).toBe(300 * 60);
  });

  it("follows daylight saving when the source is given as a zone", () => {
    // The reason a zone beats a fixed offset. HistData publishes XAUUSD in US
    // Eastern, which is UTC-5 in January and UTC-4 in July. One fixed shift is
    // necessarily wrong for half the year.
    const winter = parseCandleCsv("20260115 120000;1;2;0;1", { sourceZone: "America/New_York" });
    const summer = parseCandleCsv("20260715 120000;1;2;0;1", { sourceZone: "America/New_York" });
    expect(new Date(winter.candles[0].time * 1000).toISOString()).toBe("2026-01-15T17:00:00.000Z");
    expect(new Date(summer.candles[0].time * 1000).toISOString()).toBe("2026-07-15T16:00:00.000Z");
  });

  it("gets the hour either side of a daylight-saving change right", () => {
    // 2026-03-08 is the US spring-forward. 01:30 Eastern is still EST, 03:30 is
    // already EDT — two hours apart on the clock, two hours apart in UTC too.
    const csv = ["20260308 013000;1;2;0;1", "20260308 033000;1;2;0;1"].join("\n");
    const { candles } = parseCandleCsv(csv, { sourceZone: "America/New_York" });
    expect(new Date(candles[0].time * 1000).toISOString()).toBe("2026-03-08T06:30:00.000Z");
    expect(new Date(candles[1].time * 1000).toISOString()).toBe("2026-03-08T07:30:00.000Z");
  });

  it("leaves epoch and zoned timestamps alone whatever source zone is given", () => {
    // An epoch second already names an instant. Shifting it would be corruption.
    const epoch = Date.UTC(2026, 8, 18, 14, 30) / 1000;
    const csv = `${epoch};1;2;0;1`;
    expect(parseCandleCsv(csv, { sourceZone: "America/New_York" }).candles[0].time).toBe(epoch);
    const zoned = ["datetime,open,high,low,close", "2026-09-18T14:30:00Z,1,2,0.5,1.5"].join("\n");
    expect(parseCandleCsv(zoned, { sourceZone: "America/New_York" }).candles[0].time).toBe(epoch);
  });

  it("reads a comma format with a header in any column order", () => {
    const csv = ["close,datetime,high,low,open", "4351.7,2026-09-18 14:31:00,4352.0,4350.5,4350.9"].join("\n");
    const { candles } = parseCandleCsv(csv);
    expect(candles[0].close).toBe(4351.7);
    expect(candles[0].high).toBe(4352.0);
  });

  it("accepts ISO timestamps with a zone", () => {
    const csv = ["datetime,open,high,low,close", "2026-09-18T14:30:00Z,1,2,0.5,1.5"].join("\n");
    expect(parseCandleCsv(csv).candles[0].time).toBe(Date.UTC(2026, 8, 18, 14, 30) / 1000);
  });

  it("drops malformed rows and duplicates rather than failing the file", () => {
    const csv = [
      "20260918 143000;4350;4351;4349;4350;0",
      "20260918 143000;4350;4351;4349;4350;0",
      "garbage;;;;",
      "20260918 143100;4350;4340;4360;4350;0",
    ].join("\n");
    const { candles, skipped } = parseCandleCsv(csv);
    expect(candles).toHaveLength(1);
    expect(skipped).toBe(3);
  });

  it("sorts oldest first whatever order the file is in", () => {
    const csv = ["20260918 143100;2;2;2;2;0", "20260918 143000;1;1;1;1;0"].join("\n");
    const t = parseCandleCsv(csv).candles.map((c) => c.open);
    expect(t).toEqual([1, 2]);
  });

  it("names the missing columns when a header is present but wrong", () => {
    // A trade export dropped into the candle importer by mistake: it has a date
    // column so it reads as a header, and the error should say what is missing.
    expect(() => parseCandleCsv("date,ticket,profit\n2026-09-18,1,2.5"))
      .toThrowError(/open\/high\/low\/close/i);
  });

  it("says what shape it expected when nothing parses at all", () => {
    expect(() => parseCandleCsv("ticket,profit\n1,2.5")).toThrowError(/timestamp followed by open/i);
  });
});

describe("aggregate", () => {
  it("rolls minutes up keeping first open, last close and the true extremes", () => {
    const base = Date.UTC(2026, 8, 18, 14, 0) / 1000;
    const m1 = [
      { time: base,        open: 10, high: 12, low: 9,  close: 11 },
      { time: base + 60,   open: 11, high: 15, low: 8,  close: 14 },
      { time: base + 120,  open: 14, high: 14, low: 13, close: 13 },
      { time: base + 300,  open: 20, high: 21, low: 19, close: 20 },
    ];
    const m5 = aggregate(m1, 5);
    expect(m5).toHaveLength(2);
    expect(m5[0]).toMatchObject({ open: 10, high: 15, low: 8, close: 13 });
    expect(m5[1].open).toBe(20);
  });

  it("returns M1 untouched", () => {
    const c = [{ time: 60, open: 1, high: 2, low: 0, close: 1 }];
    expect(aggregate(c, 1)).toBe(c);
  });
});

/**
 * Candles that are hours out still draw a perfectly plausible chart, so the
 * misalignment has to be caught by something other than looking at it.
 */
describe("checkAlignment", () => {
  const base = Date.UTC(2026, 8, 18, 0, 0) / 1000;
  // One bar a minute, each a point higher than the last, so no two bars overlap.
  const candles = Array.from({ length: 240 }, (_, i) => ({
    time: base + i * 60, open: 1000 + i, high: 1000.5 + i, low: 1000 + i, close: 1000.4 + i,
  }));
  const fillsAt = (shiftSeconds: number) =>
    Array.from({ length: 240 }, (_, i) => ({ time: base + i * 60 + 30 + shiftSeconds, price: 1000.2 + i }));

  it("scores a correctly aligned file at 1 and proposes no shift", () => {
    const r = checkAlignment(candles, fillsAt(0));
    expect(r.checked).toBe(240);
    expect(r.score).toBe(1);
    expect(r.bestShiftMinutes).toBe(0);
  });

  it("recovers the shift when the file was written in another zone", () => {
    // Fills happened five hours after the times the file claims: the classic
    // US Eastern file read as UTC.
    const r = checkAlignment(candles, fillsAt(5 * 3600));
    // As written, the candles reach none of these fills at all, so there is no
    // rate to report — "nothing to compare" is a different answer from "they
    // disagree", and reporting the second would be a claim we cannot support.
    expect(r.checked).toBe(0);
    expect(r.score).toBeNull();
    // The shift is still found, and it is unambiguous.
    expect(r.bestShiftMinutes).toBe(300);
    expect(r.bestScore).toBe(1);
    expect(r.evidence).toBe(240);
  });

  it("does not let the size of the fetched window cap the score", () => {
    // The defect this guards: candles covering part of the period the fills
    // span, every single one of them correct. Scored against all the fills in
    // sight it cannot exceed the fraction of time fetched — two days of
    // flawless candles against four days of fills tops out near 63% and gets
    // reported as the wrong instrument.
    const half = candles.slice(0, 120);
    const r = checkAlignment(half, fillsAt(0));
    expect(r.score).toBe(1);
    expect(r.checked).toBe(120);
    expect(r.bestShiftMinutes).toBe(0);
  });

  it("tolerates the spread, because fills carry it and bid candles do not", () => {
    const justAbove = [{ time: base + 30, price: 1000.5 + 0.3 }];
    expect(checkAlignment(candles, justAbove).score).toBe(1);
    const wayAbove = [{ time: base + 30, price: 1000.5 + 3 }];
    expect(checkAlignment(candles, wayAbove).score).toBe(0);
  });

  it("names a clock change instead of blaming the instrument", () => {
    // Half the file needs +5h and half needs +4h, which is what a month
    // containing a daylight-saving switch looks like. No single shift fixes it,
    // so without this the verdict would be "wrong market" and the trader would
    // throw away a perfectly good file.
    const dstCandles = [];
    const dstFills = [];
    for (let i = 0; i < 400; i++) {
      const trueT = base + i * 60;
      const off = (i < 200 ? 300 : 240) * 60;
      dstCandles.push({ time: trueT - off, open: 1000 + i, high: 1000.5 + i, low: 1000 + i, close: 1000.4 + i });
      dstFills.push({ time: trueT + 20, price: 1000.2 + i });
    }
    dstCandles.sort((a, b) => a.time - b.time);

    const r = checkAlignment(dstCandles, dstFills);
    expect(r.bestScore).toBeLessThan(0.9);
    expect(r.dstLikely).toBe(true);
    expect(r.combinedScore).toBe(1);
  });

  it("does not excuse a file that is simply the wrong market", () => {
    const halfPrice = candles.map((c) => ({ ...c, open: c.open / 2, high: c.high / 2, low: c.low / 2, close: c.close / 2 }));
    const r = checkAlignment(halfPrice, fillsAt(0));
    expect(r.bestScore).toBe(0);
    expect(r.dstLikely).toBe(false);
  });

  it("accepts a fill at the real extreme of a minute the source under-reports", () => {
    // A consolidated aggregate never saw every tick, so it publishes a narrower
    // high-to-low than the market traded through — hardest exactly in the fast
    // minutes, which is when a scalper is filling. The fill is genuine; the bar
    // is incomplete. The minutes either side contain the movement.
    const thin = candles.map((c, i) =>
      i === 60 ? { ...c, high: c.low + 0.02 } : c);
    const atTheExtreme = [{ time: base + 60 * 60 + 30, price: thin[61].high }];
    expect(checkAlignment(thin, atTheExtreme).score).toBe(1);
  });

  it("still refuses something a minute either side cannot reach", () => {
    // The widening must not become a licence. A price far outside the local
    // neighbourhood is a different market, however plausible the timestamp.
    const farOff = [{ time: base + 60 * 60 + 30, price: candles[60].high + 50 }];
    const r = checkAlignment(candles, farOff);
    expect(r.score).toBe(0);
    expect(r.medianMiss).toBeGreaterThan(40);
  });

  it("says nothing rather than guessing when the file covers none of the trades", () => {
    const elsewhere = [{ time: base + 400 * 86400, price: 1000 }];
    const r = checkAlignment(candles, elsewhere);
    expect(r.checked).toBe(0);
    expect(r.score).toBeNull();
  });
});
