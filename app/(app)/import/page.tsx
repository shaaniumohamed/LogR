import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { positions } from "@/lib/db/schema";
import { getOrCreateAccount } from "@/lib/account";
import { loadCoverage } from "@/lib/candles";
import ImportClient from "./import-client";
import { CandleImport } from "./candle-import";
import { CoverageList } from "./coverage-list";

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
  const session = await auth();
  const account = await getOrCreateAccount(session!.user!.id!);

  // Default to whatever this trader actually trades, rather than making them type it.
  const [top] = await db
    .select({ symbol: positions.symbol, n: sql<number>`count(*)::int` })
    .from(positions).where(eq(positions.accountId, account.id))
    .groupBy(positions.symbol).orderBy(desc(sql`count(*)`)).limit(1);

  const coverage = await loadCoverage();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Import price history</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--ink2)" }}>
          Your broker export has your fills but not the market&rsquo;s prices. Add one-minute
          candles and every trade gets a real chart, with your entries and exits drawn on it.
        </p>
      </div>

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

      <CandleImport defaultSymbol={top?.symbol ?? "XAUUSD"} />

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
