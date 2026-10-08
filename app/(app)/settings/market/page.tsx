import Link from "next/link";
import { requireContext } from "@/lib/session";
import { storageConfigured } from "@/lib/storage";
import { coverageSummary, dailyTicks } from "@/lib/market-data";
import { Card, Empty, Eyebrow, Note, Verdict } from "@/components/ui";
import { Info } from "@/components/info";
import { Importer } from "./importer";
import { Coverage } from "./coverage";
import { Preview } from "./preview";
import { RemoveData } from "./remove";

export const dynamic = "force-dynamic";

const nf = new Intl.NumberFormat("en-US");
const mb = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${(b / 1e6).toFixed(1)} MB`);
const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * The price history the backtester replays: import it, see what is held,
 * check it on a chart, remove a bad year.
 *
 * Owners only. The data is shared by everyone using the app, so one person's
 * bad import would be everybody's wrong candles.
 */
export default async function MarketData() {
  const ctx = await requireContext();
  if (!ctx.isOwner) {
    return <Empty title="Only an owner manages price history"
                  body="The price history is shared by everyone here, so only the owners named in the app's settings can import or remove it." />;
  }

  const configured = storageConfigured();
  const summary = await coverageSummary();
  const main = summary[0] ?? null;
  const days = main ? await dailyTicks(main.symbol) : [];
  const years = [...new Set(days.map((d) => d.day.slice(0, 4)))];

  return (
    <div className="space-y-4">
      <Link href="/settings" className="tap text-[13px]" style={{ color: "var(--c1)" }}>‹ Settings</Link>

      <Card>
        <Eyebrow>Price history</Eyebrow>
        <Verdict>
          {main
            ? <>Holding <b>{main.symbol}</b> from <b className="num">{day(main.first)}</b> to <b className="num">{day(main.last)}</b>: {nf.format(main.days)} days, {nf.format(main.ticks)} ticks, {mb(main.bytes)}.</>
            : "No price history yet. Import your Exness tick files to start backtesting."}
        </Verdict>
        {!configured && (
          <p className="mt-2 rounded-lg p-3 text-[13px]" style={{ background: "color-mix(in srgb, var(--loss) 10%, transparent)", color: "var(--loss)" }}>
            Storage is not set up on this deployment. Add the four R2 settings in Vercel and redeploy.
          </p>
        )}
        <Info title="What gets stored, and where">
          Each day of ticks is compressed to about half a megabyte and stored in your Cloudflare R2
          bucket, along with one-minute candles for each month and hourly and daily candles for
          each year — all built from the same ticks, so every timeframe agrees.
          <br /><br />
          The files go straight from this browser to your bucket; the app only keeps a list of
          them. Importing the same file twice uploads nothing new, so an import that stops
          halfway can simply be run again.
          <br /><br />
          The spreads in Exness files are the account type&rsquo;s own (the <b>m</b> in{" "}
          <span className="num">XAUUSDm</span> is a Standard account). Backtests let you adjust the
          spread to match your Pro account.
        </Info>
      </Card>

      {configured && <Importer />}

      {main && (
        <>
          <Card>
            <Eyebrow>Days held</Eyebrow>
            <Note>Each square is one UTC day. Darker means more ticks. A red outline is a weekday with no data.</Note>
            <Coverage days={days} />
          </Card>
          <Preview symbol={main.symbol} first={day(main.first)} last={day(main.last)} />
          <RemoveData symbol={main.symbol} years={years} />
        </>
      )}
    </div>
  );
}
