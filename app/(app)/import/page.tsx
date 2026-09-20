import Link from "next/link";
import { requireContext } from "@/lib/session";
import { loadTrades } from "@/lib/queries";
import { loadCoverage, missingTradingDays } from "@/lib/candles";
import ImportClient from "./import-client";
import { CandleImport } from "./candle-import";
import { CoverageList } from "./coverage-list";
import { FetchMissing } from "./fetch-missing";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "trades", label: "Trades" },
  { key: "candles", label: "Price history" },
] as const;

export default async function ImportPage({ searchParams }: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const active = tab === "candles" ? "candles" : "trades";

  return (
    <div className="space-y-5">
      <div className="flex gap-1 rounded-xl p-1" style={{ background: "var(--s1)", border: "1px solid var(--line)" }}>
        {TABS.map((t) => (
          <Link key={t.key} href={`/import?tab=${t.key}`}
            className="flex-1 rounded-lg py-2 text-center text-[13px] font-medium"
            style={active === t.key
              ? { background: "var(--ink)", color: "var(--plane)" }
              : { color: "var(--ink2)" }}>
            {t.label}
          </Link>
        ))}
      </div>

      {active === "trades" ? <TradesTab /> : <CandlesTab />}
    </div>
  );
}

function TradesTab() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Import trade history</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--ink2)" }}>
          Exness Personal Area → Trading → History of orders → <b>Download CSV</b>.
        </p>
        <p className="mt-2 text-sm" style={{ color: "var(--ink2)" }}>
          Drop the file here as often as you like. Trades already saved are matched on
          their broker ticket and skipped, so <b>re-importing an overlapping range only
          adds what is new</b> — you never have to track where you left off. If your
          broker limits how many rows one export returns, pull it in date chunks and
          drop each file in turn.
        </p>
      </div>
      <ImportClient />
    </div>
  );
}

async function CandlesTab() {
  const { account } = await requireContext();

  // Default to whatever this trader actually trades, rather than making them
  // type it. Counted off the cached trade list rather than with a GROUP BY of
  // its own: the list is already in memory on nearly every request, and one
  // fewer crossing to the database is worth more here than the tidier query.
  const { all } = await loadTrades("all");
  const tally = new Map<string, number>();
  for (const t of all) tally.set(t.symbol, (tally.get(t.symbol) ?? 0) + 1);
  const symbol = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "XAUUSD";
  const [coverage, missing] = await Promise.all([
    loadCoverage(),
    missingTradingDays(account.id, symbol),
  ]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Price history</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--ink2)" }}>
          Your broker export has your fills but not the market&rsquo;s prices. Add one-minute
          candles and every trade gets a real chart, with your entries and exits drawn on it.
        </p>
      </div>

      <FetchMissing days={missing} symbol={symbol} hasKey={!!process.env.TWELVEDATA_API_KEY} />

      {coverage.length > 0 && (
        <div className="card p-5">
          <div className="eyebrow">Already held</div>
          <CoverageList rows={coverage.map((c) => ({
            symbol: c.symbol, bars: c.bars,
            from: c.from.toISOString().slice(0, 10), to: c.to.toISOString().slice(0, 10),
          }))} />
          <p className="mt-3 text-[11px]" style={{ color: "var(--ink3)" }}>
            Price history is shared, not per-account — a gold candle is the same candle for
            everyone, so importing a month covers it for good.
          </p>
        </div>
      )}

      <details className="card p-5">
        <summary className="cursor-pointer text-[13px] font-semibold">
          Import a file instead
        </summary>
        <p className="mt-2 text-[13px]" style={{ color: "var(--ink2)" }}>
          For history further back than the price service reaches, or when you would rather not
          use one at all.
        </p>
        <div className="mt-4">
          <CandleImport defaultSymbol={symbol} />
        </div>
      </details>

      <details className="card p-5">
        <summary className="cursor-pointer text-[13px] font-semibold">Where to get a free file</summary>
        <div className="mt-3 space-y-3 text-[13px] leading-relaxed" style={{ color: "var(--ink2)" }}>
          <p>
            <b>HistData.com</b> — free one-minute history going back years, one zip a month.
            Pick <i>XAUUSD</i>, <i>1 Minute Bar Quotes</i>, <i>Generic ASCII</i>. Its times are US
            Eastern, so choose that above.
          </p>
          <p>
            <b>Dukascopy</b> — its historical data feed exports CSV in UTC, which needs no shift.
          </p>
          <p>
            <b>Your own platform</b> — MT5 on desktop can export bars from the symbol&rsquo;s chart
            window, and TradingView can export chart data. Those come out in the platform&rsquo;s
            own time zone, which the check below will spot.
          </p>
          <p style={{ color: "var(--ink3)" }}>
            Any CSV works as long as each row has a time and then open, high, low and close —
            column order and separators are worked out automatically.
          </p>
        </div>
      </details>
    </div>
  );
}
