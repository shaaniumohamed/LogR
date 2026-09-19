import { computeStats, segmentBy, hourIn } from "@/lib/core/metrics";
import { loadAnnotations } from "@/lib/actions";
import { confluenceLabel, feelingLabel, isGoodFeeling, mistakeLabel } from "@/lib/core/taxonomy";
import { Info, Caveat } from "@/components/info";
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
function Section({ title, verdict, rows, note, info }: {
  title: string; verdict: string; rows: BarRow[]; note?: React.ReactNode; info?: React.ReactNode;
}) {
  if (rows.length < 2) return null;
  return (
    <Card>
      <Eyebrow>{title}</Eyebrow>
      <Verdict>{verdict}</Verdict>
      <BarChart rows={rows} format={(v) => money0(v)} />
      {note && <Note>{note}</Note>}
      {info && <Info>{info}</Info>}
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
  const { trades, account, timeZone, isEmpty } = await loadTrades(period);

  if (isEmpty) {
    return <Empty title="Nothing to analyse yet" body="Import your broker history and the patterns appear here automatically — nothing to fill in." />;
  }

  const s = computeStats(trades);

  // Annotation-backed analysis. These sections stay hidden until there is enough
  // tagged data to say anything, rather than showing an empty chart that implies
  // the trader has no patterns when in fact they have not tagged any trades yet.
  const annotations = await loadAnnotations(account.id);
  const byHash = new Map(annotations.map((a) => [a.identityHash, a]));
  const tagged = trades.filter((t) => byHash.has(t.id));
  const ANNOT_MIN = 15;
  const hasEnough = tagged.length >= ANNOT_MIN;

  const feelingRows = hasEnough
    ? rowsFor(tagged, (t) => { const f = byHash.get(t.id)?.emotion; return f ? feelingLabel(f) : null; }, 5)
    : [];
  const setupRows = hasEnough
    ? rowsFor(tagged, (t) => byHash.get(t.id)?.setup ?? null, 5)
    : [];
  const tfRows = hasEnough
    ? rowsFor(tagged, (t) => byHash.get(t.id)?.timeframe ?? null, 5)
    : [];
  const mistakeRows = hasEnough
    ? rowsFor(tagged, (t) => { const m = byHash.get(t.id)?.mistakes ?? []; return m.length ? mistakeLabel(m[0]) : null; }, 5)
    : [];

  // Calm against charged states. Feelings are grouped rather than listed one by
  // one because any single state has a small sample long before the split does.
  const calm = tagged.filter((t) => { const f = byHash.get(t.id)?.emotion; return f && isGoodFeeling(f); });
  const charged = tagged.filter((t) => { const f = byHash.get(t.id)?.emotion; return f && !isGoodFeeling(f); });
  const calmS = computeStats(calm), chargedS = computeStats(charged);
  const showMindset = calm.length >= 8 && charged.length >= 8;

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
          trades cannot tell you anything.
        </Note>
        <Info title="Why a pattern here is not proof">
          These charts show things that happened <i>together</i>. That is not the same as one
          causing the other. A group can look bad because of a single terrible day inside it,
          because those trades were taken in unusual conditions, or by chance.
          <br /><br />
          The way to use them: treat a strong bar as a <b>question</b>, not an answer. Pick
          one, change that single thing deliberately for a few weeks, and see whether the
          number moves. That is the only test that settles it.
        </Info>
      </Card>

      {!hasEnough && (
        <Card>
          <Eyebrow>Locked until you annotate</Eyebrow>
          <Verdict>
            Setups, confluences, your state of mind and R all need input only you have.
            {tagged.length > 0 ? ` You have annotated ${count(tagged.length)} so far — ${ANNOT_MIN} unlocks these.` : " Nothing is annotated yet."}
          </Verdict>
          <Note>
            <a href="/review" style={{ color: "var(--c1)", fontWeight: 600 }}>Start with your biggest trades →</a>{" "}
            The queue is sorted by size of result, so twenty annotations there are worth two
            hundred picked at random.
          </Note>
        </Card>
      )}

      {showMindset && (
        <Card>
          <Eyebrow>Your state of mind</Eyebrow>
          <Verdict>
            Trades you took calm came to <b className={calmS.net >= 0 ? "pos" : "neg"}>{money0(calmS.net)}</b> across{" "}
            {count(calmS.n)}. Trades you took rushed, bored, on tilt or chasing came to{" "}
            <b className={chargedS.net >= 0 ? "pos" : "neg"}>{money0(chargedS.net)}</b> across {count(chargedS.n)}.
          </Verdict>
          <BarChart
            rows={[
              { label: "Calm and patient", value: calmS.net, meta: `${count(calmS.n)} · won ${pct(calmS.winRate, 0)}`, flag: true },
              { label: "Rushed or charged", value: chargedS.net, meta: `${count(chargedS.n)} · won ${pct(chargedS.winRate, 0)}`, flag: true },
            ]}
            format={(v) => money0(v)}
          />
          {feelingRows.length >= 2 && (
            <div className="mt-5">
              <div className="text-[12.5px] font-semibold">Broken down by feeling</div>
              <BarChart rows={feelingRows} format={(v) => money0(v)} />
            </div>
          )}
          <Info title="Why this is the most valuable chart here">
            Every other number in this app your broker already knows. This one exists only
            because you wrote it down, and it is usually where the difference between two
            traders with identical strategies actually lives.
            <br /><br />
            One honest caution: you tag how you felt <i>after</i> seeing the result, and memory
            bends toward the outcome. Tag it the same evening, before the number has had time
            to rewrite the feeling.
          </Info>
        </Card>
      )}

      <Section
        title="By setup"
        verdict={setupRows.length ? `Across the trades you have tagged, ${setupRows[0].label} is your strongest.` : ""}
        rows={setupRows}
        info="Only counts annotated trades, so it moves as you tag more. Treat a setup as unproven until it has at least thirty trades behind it."
      />

      <Section
        title="By timeframe you read it on"
        verdict="Whether the timeframe you take the setup from changes how it performs."
        rows={tfRows}
        info="If your lower timeframes underperform, you may be reading noise as structure — the same setup on a higher timeframe is effectively a different trade."
      />

      <Section
        title="What your mistakes cost"
        verdict={mistakeRows.length ? `Trades you tagged with a mistake, grouped by the first one tagged.` : ""}
        rows={mistakeRows}
        info="Only trades where you tagged something. This is deliberately self-reported: the point is to make the price of a habit visible to you, not to catch you out."
      />

      {endedRows.length >= 2 && (
        <Card>
          <Eyebrow>How your trades ended</Eyebrow>
          <Verdict>
            {tp && manual && tp.stats.expectancy > manual.stats.expectancy * 2
              ? `Trades that ran to a target averaged ${money(tp.stats.expectancy)} each. Trades you closed by hand averaged ${money(manual.stats.expectancy)}.`
              : `This splits your trades by what actually closed them.`}
          </Verdict>
          <BarChart rows={endedRows} format={(v) => money0(v)} />
          <Caveat>
            <b>Read this carefully.</b> A target only fills if price reached it, so those
            trades are selected for having gone well — the comparison is not fair on its own.
            What is fair to say is that it is worth testing deliberately: set a target on a
            run of trades and see whether the pattern survives.
          </Caveat>
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
            the closest your data can get to asking whether that is working.
          </>
        }
        info={
          <>
            <b>What this means, carefully.</b> The trades where you happened to set a stop may
            simply have been different trades — calmer setups, better conditions, more
            conviction. The stop might be doing the work, or it might just be a marker of the
            trades you were already going to handle well. Nothing here can separate those two.
            <br /><br />
            <b>Why it is still the loudest thing in your data.</b> The gap is large and it sits
            on hundreds of trades. That makes it the single most worthwhile thing to test on
            purpose: set a stop on every trade for a month, and see whether the difference
            follows you.
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
