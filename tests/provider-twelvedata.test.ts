import { describe, expect, it } from "vitest";
import { ProviderError, authHeaders, buildUrl, normalise, providerSymbol } from "../lib/core/provider-twelvedata";

describe("providerSymbol", () => {
  it("writes pairs the way the provider expects", () => {
    expect(providerSymbol("XAUUSD")).toBe("XAU/USD");
    expect(providerSymbol("XAUUSDm")).toBe("XAU/USD");
    expect(providerSymbol("eurusd")).toBe("EUR/USD");
  });

  it("passes anything that is not a six-letter pair straight through", () => {
    // Better to let the provider reject an index ticker by name than to invent
    // a slash in the middle of it and get a confusing answer.
    expect(providerSymbol("US30")).toBe("US30");
    expect(providerSymbol("NAS100")).toBe("NAS100");
  });
});

describe("buildUrl", () => {
  const url = buildUrl({
    symbol: "XAUUSD",
    from: new Date(Date.UTC(2026, 8, 18, 0, 0)),
    to: new Date(Date.UTC(2026, 8, 18, 23, 59)),
  });
  const q = new URL(url).searchParams;

  it("asks for one-minute bars in UTC", () => {
    // UTC is not a detail. Without it the provider answers in the exchange's own
    // zone and every marker lands in the wrong bar.
    expect(q.get("interval")).toBe("1min");
    expect(q.get("timezone")).toBe("UTC");
  });

  it("formats the dates the documented way", () => {
    expect(q.get("start_date")).toBe("2026-09-18T00:00:00");
    expect(q.get("end_date")).toBe("2026-09-18T23:59:00");
  });

  it("keeps the API key out of the URL entirely", () => {
    // A URL reaches logs, error messages and stack traces without anyone
    // deciding it should; a header has to be printed on purpose.
    expect(url).not.toContain("apikey");
    expect(authHeaders("SECRET").Authorization).toBe("apikey SECRET");
  });
});

describe("normalise", () => {
  const ok = {
    meta: { symbol: "XAU/USD", interval: "1min" },
    status: "ok",
    values: [
      // The API answers newest-first.
      { datetime: "2026-09-18 14:31:00", open: "4350.90", high: "4352.00", low: "4350.50", close: "4351.70" },
      { datetime: "2026-09-18 14:30:00", open: "4350.10", high: "4351.20", low: "4349.80", close: "4350.90" },
    ],
  };

  it("reads string prices and returns them oldest first", () => {
    const c = normalise(ok);
    expect(c).toHaveLength(2);
    expect(c[0].open).toBe(4350.1);
    expect(c[0].time).toBeLessThan(c[1].time);
    expect(new Date(c[0].time * 1000).toISOString()).toBe("2026-09-18T14:30:00.000Z");
  });

  it("accepts numbers as readily as strings", () => {
    const c = normalise({ values: [{ datetime: "2026-09-18T14:30:00Z", open: 1, high: 2, low: 0.5, close: 1.5 }] });
    expect(c[0].high).toBe(2);
  });

  it("passes the provider's own words through when it refuses", () => {
    // The difference between "out of credits" and "symbol not found" is the
    // whole answer, and only the provider knows which it is.
    expect(() => normalise({ code: 429, message: "You have run out of API credits", status: "error" }))
      .toThrowError(/run out of API credits/);
  });

  it("quotes an unrecognised reply rather than crashing on it", () => {
    expect(() => normalise({ something: "else" })).toThrowError(/Unexpected reply/);
    expect(() => normalise("<html>502</html>")).toThrowError(/not JSON/);
  });

  it("says so plainly when the period simply has no bars", () => {
    // A weekend, or a date before the instrument existed. Not an error to debug.
    expect(() => normalise({ status: "ok", values: [] })).toThrowError(/no candles/);
  });

  it("skips individual malformed rows instead of losing the whole day", () => {
    const c = normalise({ values: [
      { datetime: "2026-09-18 14:30:00", open: "1", high: "2", low: "0", close: "1" },
      { datetime: "not a date", open: "1", high: "2", low: "0", close: "1" },
      { datetime: "2026-09-18 14:31:00", open: "x", high: "2", low: "0", close: "1" },
    ] });
    expect(c).toHaveLength(1);
  });

  it("is an error type the route can recognise", () => {
    try { normalise({ status: "error", code: 401, message: "bad key" }); }
    catch (e) { expect(e).toBeInstanceOf(ProviderError); expect((e as ProviderError).code).toBe(401); }
  });
});
