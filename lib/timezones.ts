/**
 * IANA zone names, deliberately — not fixed UTC offsets.
 *
 * An IANA zone carries its own daylight-saving history, so `Intl` resolves a
 * timestamp to the offset that was actually in force on that date. A trade from
 * last July renders in that July's offset even if the rule changed since, and
 * zones without DST (Malaysia, Maldives) simply never shift. Storing "+08:00"
 * instead would silently mis-bucket every trade across a DST boundary.
 */
export const COMMON_ZONES = [
  { zone: "Asia/Kuala_Lumpur", label: "Malaysia — Kuala Lumpur" },
  { zone: "Indian/Maldives", label: "Maldives — Malé" },
  { zone: "Asia/Singapore", label: "Singapore" },
  { zone: "Asia/Dubai", label: "UAE — Dubai" },
  { zone: "Asia/Colombo", label: "Sri Lanka — Colombo" },
  { zone: "Asia/Kolkata", label: "India — Kolkata" },
  { zone: "Asia/Bangkok", label: "Thailand — Bangkok" },
  { zone: "Asia/Jakarta", label: "Indonesia — Jakarta" },
  { zone: "Asia/Hong_Kong", label: "Hong Kong" },
  { zone: "Asia/Tokyo", label: "Japan — Tokyo" },
  { zone: "Australia/Sydney", label: "Australia — Sydney (has DST)" },
  { zone: "Europe/London", label: "UK — London (has DST)" },
  { zone: "Europe/Zurich", label: "Switzerland — Zurich (has DST)" },
  { zone: "America/New_York", label: "US — New York (has DST)" },
  { zone: "UTC", label: "UTC — market time" },
] as const;

export function isValidZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Current offset of a zone, for showing the user what they are choosing. */
export function offsetLabel(tz: string, at = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat("en", { timeZone: tz, timeZoneName: "shortOffset" }).formatToParts(at);
    return parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}

/** "Kuala Lumpur time" — so a reader always knows whose clock a chart is using. */
export function zoneName(tz: string): string {
  if (tz === "UTC") return "UTC";
  const city = tz.split("/").pop()?.replace(/_/g, " ");
  return city ? `${city} time` : tz;
}
