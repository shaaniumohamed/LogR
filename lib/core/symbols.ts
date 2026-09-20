/**
 * Broker symbols carry suffixes; price sources do not.
 *
 * Exness sells the same gold as XAUUSD, XAUUSDm, XAUUSDc and XAUUSD.raw
 * depending on account type, while every price source calls it XAUUSD. A trade
 * on XAUUSDm has to find bars stored as XAUUSD, or the chart is simply blank
 * with nothing on screen explaining why.
 *
 * Trimming to the first six alphanumerics handles every instrument this touches:
 * FX pairs and metals are six characters and everything after is the broker's
 * own decoration; shorter tickers (US30, NAS100, USOIL) are left alone.
 *
 * Lives in core rather than beside the queries because both the database layer
 * and the price-provider adapter need it, and the adapter must stay importable
 * without pulling in a database client.
 */
export function normalizeSymbol(raw: string): string {
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return s.length > 6 ? s.slice(0, 6) : s;
}
