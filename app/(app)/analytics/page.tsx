import { computeStats, segmentBy, hourIn } from "@/lib/core/metrics";
import { holdBucket, sessionOf, weekdayIn, counterfactual } from "@/lib/core/analysis";
import { loadTrades, resolvePeriod } from "@/lib/queries";
import { PeriodTabs } from "@/components/period-tabs";
import { BarChart, type BarRow } from "@/components/charts";
import { Card, Empty, Eyebrow, Note, Verdict, count, money, money0, pct } from "@/components/ui";
import type { ZoneTrade } from "@/lib/core/types";

export const dynamic = "force-dynamic";

const MIN = 10; // below this a bucket says nothing, so it is not drawn at all

function rowsFor(trades: ZoneTrade[], key: (t: ZoneTrade) => string | null, minN = MIN): BarRow[] {
  return segmentBy(trades, key, minN)
    .sort((a, b) => b.stats.net - a.stats.net)
    .map((g) => ({
      label: g.key,
      value: g.stats.net,
      meta: `${count(g.stats.n)} · won ${pct(g.stats.winRate, 0)}`,
    }));
}

/** A section only renders if it has something to say. Empty charts are noise. */
function Section({ title, verdict, rows, note }: {
  title: string; verdict: string; rows: BarRow[]; note?: React.ReactNode;
}) {
  if (rows.length < 2) return null;
  return (
    <Card>
      <Eyebrow>{title}</Eyebrow>
      <Verdict>{verdict}</Verdict>
      <BarChart rows={rows} format={(v) => money0(v)} labelWidth={112} aria={title} />
      {note && <Note>{note}</Note>}
    </Card>
  );
}

const ENDED_LABEL: Record<string, string> = {
  user: "You closed it",
  tp: "Target was hit",
  sl: "Stop was hit",
  so: "Margin call",
  unknown: "Not recorded",
};

export default async function Analytics({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const period = resolvePeriod((await searchParams).period);
  const { trades, timeZone, isEmpty } = await loadTrades(period);

  if (isEmpty) {
    return <Empty title="Nothing to analyse yet" body="Import your broker history and the patterns appear here automatically — nothing to fill in." />;
  }

  const s = computeStats(trades);

  const endedRows = rowsFor(trades, (t) => {
    const r = t.closeReasons.includes("so") ? "so"
      : t.closeReasons.includes("tp") ? "tp"
      : t.closeReasons.includes("sl") ? "sl"
      : t.closeReasons[0] ?? "unknown";
    return ENDED_LABEL[r] ?? r;
  });
  const tp = segmentBy(trades, (t) => (t.closeReasons.includes("tp") ? "tp" : "other"), MIN).find((g) => g.key === "tp");
  const manual = segmentBy(trades, (t) => (t.closeReasons.includes("tp") ? "tp" : "other"), MIN).find((g) => g.key === "other");

  const stopRows = rowsFor(trades, (t) => (t.hadStop ? "Stop loss set" : "No stop set"));
  const hourRows = rowsFor(trades, (t) => `${String(hourIn(t.openedAt, timeZone)).padStart(2, "0")}:00`, 15).slice(0, 12);
  const sessionRows = rowsFor(trades, (t) => sessionOf(hourIn(t.openedAt, timeZone)));
  const dayRows = rowsFor(trades, (t) => weekdayIn(t.openedAt, timeZone));
  const holdRows = rowsFor(trades, (t) => holdBucket(t.holdMinutes));
  const dirRows = rowsFor(trades, (t) => (t.direction === "long" ? "Buys" : "Sells"));
  const ladderRows = rowsFor(trades, (t) => (t.legCount > 1 ? `Laddered in` : "Single entry"));

  // Counterfactuals, reported in BOTH directions. Testing on real data turned up a
  // bucket that intuition called bad and that was in fact carrying profit, so a
  // panel that only lists leaks would quietly mislead (docs/20 §3.4).
  const worstHour = hourRows.length && hourRows[hourRows.length - 1].value < 0
    ? hourRows[hourRows.length - 1] : null;
  const cfHour = worstHour
    ? counterfactual(trades, (t) => `${String(hourIn(t.openedAt, timeZone)).padStart(2, "0")}:00` === worstHour.label)
    : null;
  const cfLong = counterfactual(trades, (t) => t.holdMinutes > 30);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PeriodTabs base="/analytics" active={period} />
        <span className="text-[11px]" style={{ color: "var(--ink3)" }}>
          from {count(s.n)}, no tagging needed
        </span>
      </div>

      <Card>
        <Eyebrow>How to read these</Eyebrow>
        <Note>
          Every bar is the money you made or lost in that group, with how many trades it
          covers. Groups with fewer than {MIN} trades are left out, because a handful of
          trades cannot tell you anything. These are patterns worth investigating, not
          proof of cause — two things happening together is not one causing the other.
        </Note>
      </Card>

      {endedRows.length >= 2 && (
        <Card>
          <Eyebrow>How your trades ended</Eyebrow>
          <Verdict>
            {tp && manual && tp.stats.expectancy > manual.stats.expectancy * 2
              ? `Trades that ran to a target averaged ${money(tp.stats.expectancy)} each. Trades you closed by hand averaged ${money(manual.stats.expectancy)}.`
              : `This splits your trades by what actually closed them.`}
          </Verdict>
          <BarChart rows={endedRows} format={(v) => money0(v)} labelWidth={120} aria="Result by how the trade ended" />
          <Note>
            <b>Read this carefully.</b> A target only fills if price reached it, so those
            trades are selected for having gone well — the comparison is not fair on its
            own. What it is fair to say is that it is worth testing deliberately: set a
            target on a run of trades and see whether the pattern survives.
          </Note>
        </Card>
      )}

      <Section
        title="With and without a stop loss"
        verdict={
          stopRows.length === 2
            ? `Trades with a stop set came to ${money0(stopRows[0].value)}; trades without came to ${money0(stopRows[1].value)}.`
            : ""
        }
        rows={stopRows}
        note={
          <>
            You mostly trade without a platform stop, exiting by judgement instead. This is
            the closest your data can get to asking whether that is working. Same caution:
            the trades where you chose to set a stop may simply have been different trades.
          </>
        }
      />

      <Section
        title="Time of day"
        verdict={`When you opened the trade, in your local time. ${
          hourRows.length && hourRows[hourRows.length - 1].value < 0
            ? `Your worst hour is ${hourRows[hourRows.length - 1].label}, at ${money0(hourRows[hourRows.length - 1].value)}.`
            : ""
        }`}
        rows={hourRows}
        note={
          cfHour && cfHour.improvement > 0 ? (
            <>
              Not trading <b>{worstHour!.label}</b> would have removed {count(cfHour.removedCount)} and
              changed this period from {money0(cfHour.before)} to <b>{money0(cfHour.after)}</b>. Check
              the Overview first — it only flags an hour that loses on most days, not one bad day.
            </>
          ) : undefined
        }
      />

      <Section
        title="Session"
        verdict="The same picture grouped into trading sessions, which is usually easier to act on than single hours."
        rows={sessionRows}
      />

      <Section title="Day of the week" verdict="Whether some days consistently go better than others." rows={dayRows} />

      <Section
        title="How long you held"
        verdict={`Your typical trade lasts ${s.avgHoldMinutes.toFixed(0)} minutes.`}
        rows={holdRows}
        note={
          cfLong.removedCount >= MIN ? (
            <>
              Your trades held over 30 minutes came to <b>{money0(cfLong.removedNet)}</b> across{" "}
              {count(cfLong.removedCount)}. Dropping them would have{" "}
              {cfLong.improvement > 0 ? "improved" : "worsened"} this period by{" "}
              <b>{money0(Math.abs(cfLong.improvement))}</b> — worth knowing before assuming
              that holding longer is the problem.
            </>
          ) : undefined
        }
      />

      <Section
        title="Buying against selling"
        verdict="A persistent gap here usually means a directional habit rather than an edge."
        rows={dirRows}
      />

      <Section
        title="Laddering into a zone"
        verdict={`${trades.filter((t) => t.legCount > 1).length} of your ${trades.length} trades were built from more than one entry.`}
        rows={ladderRows}
        note="If single entries do better, your extra layers are adding size to trades that were already going wrong."
      />
    </div>
  );
}
