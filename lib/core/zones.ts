const FMT_CACHE = new Map<string, Intl.DateTimeFormat>();

function fmtFor(zone: string): Intl.DateTimeFormat {
  let f = FMT_CACHE.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone, hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    FMT_CACHE.set(zone, f);
  }
  return f;
}

/** Minutes east of UTC that `zone` was observing at the given instant. */
export function zoneOffsetAt(utcMs: number, zone: string): number {
  const p = Object.fromEntries(
    fmtFor(zone).formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]),
  ) as Record<string, string>;
  const asIfUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return Math.round((asIfUtc - utcMs) / 60000);
}

/**
 * A wall-clock reading in `zone` → the UTC instant it names.
 *
 * Two passes, because the offset needed is the one in force at the ANSWER, not
 * at the question: read the offset at a first guess, correct, then read it
 * again at the corrected instant. That second read is what gets the hour either
 * side of a daylight-saving change right.
 *
 * Lifted out of the candle parser, which has needed exactly this since the
 * first CSV arrived in US Eastern time, and which is now not the only caller —
 * an economic release is announced at a local wall-clock time and lands in the
 * market at a UTC instant, and the gap between those two is a whole hour twice
 * a year.
 */
export function wallToUtc(wallAsUtcMs: number, zone: string): number {
  const first = zoneOffsetAt(wallAsUtcMs, zone);
  const second = zoneOffsetAt(wallAsUtcMs - first * 60000, zone);
  return wallAsUtcMs - second * 60000;
}

/** A local date and time in `zone`, as the instant it names. */
export function zonedTime(
  year: number, month: number, day: number, hour: number, minute: number, zone: string,
): Date {
  return new Date(wallToUtc(Date.UTC(year, month - 1, day, hour, minute), zone));
}
