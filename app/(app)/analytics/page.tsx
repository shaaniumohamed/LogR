import { computeStats, segmentBy, hourIn } from "@/lib/core/metrics";
import { loadAnnotations } from "@/lib/actions";
import { confluenceLabel, feelingLabel, isGoodFeeling, mistakeLabel } from "@/lib/core/taxonomy";
import { Info, Caveat } from "@/components/info";
import { holdBucket, sessionOf, weekdayIn, counterfactual, heldOverWeekend } from "@/lib/core/analysis";
import { loadExits, loadTrades, resolvePeriod } from "@/lib/queries";
import { PeriodTabs } from "@/components/period-tabs";
import { zoneName } from "@/lib/timezones";
import { BarChart, type BarRow } from "@/components/charts";
import { Card, Empty, Eyebrow, Note, Stat, StatGrid, Verdict, count, money, money0, pct } from "@/components/ui";
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

  /**
   * Counted per exit, and stops split by whether they fired in profit.
   *
   * A stop moved to breakeven after a partial is still reported as "sl" by the
   * broker, so pooling it with real stop-outs hides both: it makes the stop group
   * look survivable and hides how large the genuine losses are.
   */
  const exits = await loadExits(account.id, period);
  const exitGroups = new Map<string, { net: number; n: number; won: number }>();
  for (const e of exits) {
    const pnl = e.profit + e.commission + e.swap;
    const key =
      e.closeReason === "tp" ? "Target was hit"
      : e.closeReason === "so" ? "Margin call"
      : e.closeReason === "sl" ? (pnl >= 0 ? "Stop hit in profit" : "Stop hit at a loss")
      : "You closed it by hand";
    const g = exitGroups.get(key) ?? { net: 0, n: 0, won: 0 };
    g.net += pnl; g.n += 1; if (pnl > 0) g.won += 1;
    exitGroups.set(key, g);
  }
  const endedRows: BarRow[] = [...exitGroups.entries()]
    .filter(([, g]) => g.n >= MIN)
    .sort((a, b) => b[1].net - a[1].net)
    .map(([label, g]) => ({
      label,
      value: Math.round(g.net * 100) / 100,
      meta: `${g.n.toLocaleString()} exits · avg ${money(g.net / g.n)}`,
    }));
  const protectedStops = exitGroups.get("Stop hit in profit");
  const realStops = exitGroups.get("Stop hit at a loss");
  const targets = exitGroups.get("Target was hit");
  const byHand = exitGroups.get("You closed it by hand");

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

  /*
   * Weekend holds are separated rather than averaged in, because they are not a
   * read on the setup. Nothing about a position held through a closure was
   * decided after entry: it reopens where it reopens. Mixed into "how long do I
   * hold", a handful of them can swamp the hold-time answer entirely.
   */
  const overWeekend = trades.filter((t) => heldOverWeekend(t.openedAt, t.closedAt));
  const weekendStats = computeStats(overWeekend);
  const cfWeekend = overWeekend.length
    ? counterfactual(trades, (t) => heldOverWeekend(t.openedAt, t.closedAt))
    : null;

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
            {targets && byHand
              ? `Exits that ran to a target averaged ${money(targets.net / targets.n)}. Exits you closed by hand averaged ${money(byHand.net / byHand.n)}.`
              : "This splits every exit by what actually closed it."}
          </Verdict>
          <BarChart rows={endedRows} format={(v) => money0(v)} />
          {protectedStops && realStops && (
            <Note>
              Notice the two stop rows. <b>{protectedStops.n} of your stop exits fired in
              profit</b> — those are stops you had already moved to breakeven or better, doing
              exactly their job. The {realStops.n} that fired at a loss cost{" "}
              <b className="neg">{money0(realStops.net)}</b>, averaging{" "}
              <b>{money(realStops.net / realStops.n)}</b> each, which is far larger than your
              typical trade. Your real stop-outs are rare and heavy.
            </Note>
          )}
          <Info title="Why is this counted in exits rather than trades?">
            How a trade ended is a property of each <i>exit</i>, not of the trade. You ladder
            into a zone, take two partials by hand and let the runner hit the stop — that
            trade had three different endings, and forcing one label onto it would have
            reported a profitable trade as &ldquo;stopped out&rdquo;. Counting exits avoids
            inventing a single answer where there were several.
          </Info>
          <Caveat>
            <b>The target row is not a fair comparison.</b> A target only fills if price
            reached it, so those exits are selected for having gone well. What is fair to say
            is that it is worth testing on purpose: set a target on a run of trades and see
            whether the pattern survives.
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
        title={`Time of day · ${zoneName(timeZone)}`}
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
        title={`Session · ${zoneName(timeZone)}`}
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
      {overWeekend.length > 0 && (
        <Card>
          <Eyebrow>Held through a weekend</Eyebrow>
          <Verdict>
            {weekendStats.net < 0
              ? `${count(overWeekend.length)} stayed open while the market was shut, and together they cost ${money0(Math.abs(weekendStats.net))}.`
              : `${count(overWeekend.length)} stayed open while the market was shut, and together they made ${money0(weekendStats.net)}.`}
          </Verdict>
          <div className="mt-3">
            <StatGrid cols={3}>
              <Stat label="Weekend holds" value={String(overWeekend.length)}
                    sub={`${pct(weekendStats.winRate, 0)} won`} />
              <Stat label="Their total" value={money0(weekendStats.net)}
                    tone={weekendStats.net >= 0 ? "pos" : "neg"} />
              <Stat label="Worst one" value={money0(Math.min(...overWeekend.map((t) => t.netPnl)))}
                    tone="neg" />
            </StatGrid>
          </div>
          {cfWeekend && (
            <Note>
              Without them the account would be {money0(cfWeekend.after)} rather than{" "}
              {money0(cfWeekend.before)}.
            </Note>
          )}
          <Info title="Why these are counted apart">
            A position open through a closure is not the trade that was entered. It cannot be
            managed, an invalidation cannot be respected, and it reopens wherever the market
            decided over two days — the first price you can act on may be a long way from the
            last one you saw.
            <br /><br />
            Averaged in with everything else, a handful of them can swamp the answer to a
            question they have nothing to do with, like how long your holds should be. They
            are found from the clock, so nothing needs tagging.
          </Info>
        </Card>
      )}

    </div>
  );
}
