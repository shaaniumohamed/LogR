/**
 * Date formatters, built once per time zone and kept.
 *
 * Constructing an Intl.DateTimeFormat is expensive — it resolves the locale,
 * loads the zone's rules and compiles a pattern — while calling .format() on
 * one that exists is cheap. The helpers that bucket trades by day, hour and
 * weekday used to build a fresh formatter on every call, and they are called
 * once per trade per grouping: a profile of the Patterns page found 80% of the
 * server's time spent constructing formatters that were then thrown away.
 *
 * The cache key is the zone because that is the only thing that varies; the
 * locale and the fields are fixed per formatter.
 */
function cached(make: (timeZone: string) => Intl.DateTimeFormat) {
  const byZone = new Map<string, Intl.DateTimeFormat>();
  return (timeZone: string) => {
    let f = byZone.get(timeZone);
    if (!f) { f = make(timeZone); byZone.set(timeZone, f); }
    return f;
  };
}

export const hourFormatter = cached((timeZone) =>
  new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone }));

export const dayKeyFormatter = cached((timeZone) =>
  new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone }));

export const weekdayFormatter = cached((timeZone) =>
  new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone }));
