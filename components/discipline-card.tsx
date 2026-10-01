import Link from "next/link";
import type { Discipline } from "@/lib/discipline-data";
import type { DisciplineDay } from "@/lib/core/discipline";

/**
 * A dot per trading day: kept every rule, broke one, or not written up.
 *
 * The run of days is the point. A percentage over five months cannot be
 * defended tonight; a streak can, and protecting it is exactly the behaviour a
 * trader with mental stops needs rehearsed — deciding before the session that
 * the rules hold, then checking afterwards that they did.
 */
export function DisciplineCard({ d }: { d: Discipline }) {
  if (!d.days.length) return null;

  if (!d.hasRules) {
    return (
      <section className="card p-5">
        <h2 className="eyebrow">Discipline</h2>
        <p className="mt-2 text-[15px] leading-relaxed">
          Write down the rules you trade by, and every day you trade becomes a dot here — kept or broken.
        </p>
        <Link href="/playbook" className="btn btn-primary mt-3">Write your rules</Link>
      </section>
    );
  }

  const latest = d.days[d.days.length - 1];
  const headline = d.current > 0
    ? `${d.current} ${d.current === 1 ? "day" : "days"} clean`
    : latest.mark === "broken" ? "Streak broken" : "No streak yet";
  const sub = d.current > 0
    ? d.current >= d.best ? "Your longest run yet." : `Your best is ${d.best}.`
    : latest.mark === "unreviewed"
      ? "Write up your last trading day — that is where a streak starts."
      : `A rule was broken on your last trading day. Your best run is ${d.best}.`;

  return (
    <section className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="eyebrow">Discipline</h2>
          <div className={`num mt-1 text-[24px] font-semibold tracking-tight ${d.current > 0 ? "pos" : ""}`}>{headline}</div>
          <p className="text-[13px]" style={{ color: "var(--ink2)" }}>{sub}</p>
        </div>
        {d.reviewedDays > 0 && (
          <div className="shrink-0 text-right">
            <div className="num text-[17px] font-semibold">{d.cleanDays}/{d.reviewedDays}</div>
            <div className="text-[11.5px]" style={{ color: "var(--ink3)" }}>reviewed days clean</div>
          </div>
        )}
      </div>

      {/* Ten to a row, each a whole cell to tap: the dot is drawn at 18px, but
          a target that small is a guessing game for a thumb. */}
      <ol className="mt-3 grid max-w-[360px] grid-cols-10" aria-label="Your last trading days">
        {d.days.map((day) => <Dot key={day.day} day={day} />)}
      </ol>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px]" style={{ color: "var(--ink3)" }}>
        <Legend colour="var(--profit)">Kept every rule</Legend>
        <Legend colour="var(--loss)">Broke one</Legend>
        <Legend hollow>Not written up</Legend>
      </div>
    </section>
  );
}

function Dot({ day }: { day: DisciplineDay }) {
  const label = new Date(`${day.day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  const what = day.mark === "clean"
    ? `kept every rule on ${day.judged} written up`
    : day.mark === "broken"
      ? `${day.broken} of ${day.judged} written up broke a rule`
      : `${day.trades} trades, none written up`;
  return (
    <li>
      <Link href={`/day/${day.day}`} title={`${label}: ${what}`} aria-label={`${label}: ${what}`}
            className="group grid h-9 place-items-center">
        <span className="block h-[18px] w-[18px] rounded-full transition-transform group-hover:scale-125"
              style={day.mark === "unreviewed"
                ? { border: "1.5px solid var(--ink3)", opacity: 0.55 }
                : { background: day.mark === "clean" ? "var(--profit)" : "var(--loss)" }} />
      </Link>
    </li>
  );
}

function Legend({ colour, hollow, children }: { colour?: string; hollow?: boolean; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block h-2.5 w-2.5 rounded-full"
            style={hollow ? { border: "1.5px solid var(--ink3)" } : { background: colour }} />
      {children}
    </span>
  );
}
