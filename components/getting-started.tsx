import Link from "next/link";
import type { SetupState } from "@/lib/onboarding";

/**
 * The first five minutes, for someone who has never seen this before.
 *
 * Written for a trader rather than for whoever set the app up: no file formats,
 * no settings, no vocabulary that has to be learnt before the first step can be
 * taken. Three things to do, in the order that makes each one worth doing, and
 * each marked off by whether it actually happened rather than by being clicked.
 *
 * It is not a tour. A tour interrupts, has to be dismissed, and is forgotten by
 * the time it matters — and on a phone it covers the thing it is pointing at.
 * This sits on the first screen and leaves as soon as it is finished with.
 */

interface Step {
  title: string;
  body: string;
  href: string;
  cta: string;
  done: boolean;
}

export function GettingStarted({ setup, firstTradeHref }: {
  setup: SetupState;
  firstTradeHref: string | null;
}) {
  const steps: Step[] = [
    {
      title: "Bring in your trades",
      body: "Your broker already keeps the record. Download it and drop the file in — it takes about a minute, and everything else in here is built from it.",
      href: "/import",
      cta: "Import trades",
      done: setup.hasTrades,
    },
    {
      title: "Add the price charts",
      body: "So each trade can be looked at on a chart with your own entries and exits drawn on it, instead of a row of numbers.",
      href: "/import?tab=candles",
      cta: "Add charts",
      done: setup.hasPrices,
    },
    {
      title: "Write up one trade",
      body: "Why you took it, and how you felt. One trade is enough to start — this is the part that turns a list of results into something you can learn from.",
      href: firstTradeHref ?? "/trades",
      cta: "Open a trade",
      done: setup.hasReviewed,
    },
  ];

  const next = steps.find((s) => !s.done);
  if (!next) return null;
  const first = !setup.hasTrades;

  return (
    <section className="card p-5">
      <h2 className="text-lg font-semibold tracking-tight">
        {first ? "Welcome to LogR" : "Finish setting up"}
      </h2>
      <p className="mt-1.5 text-[13.5px] leading-relaxed" style={{ color: "var(--ink2)" }}>
        {first
          ? "A journal for your trading. It reads your broker history and shows you what is actually working — and what you keep doing that is not."
          : "Two more things and the app has everything it needs."}
      </p>

      <ol className="mt-4 space-y-2">
        {steps.map((s, i) => (
          <li key={s.title} className="flex gap-3 rounded-xl p-3"
              style={{
                background: s === next ? "var(--s3)" : "var(--s1)",
                border: `1px solid ${s === next ? "var(--ink3)" : "var(--line)"}`,
                opacity: s.done ? 0.65 : 1,
              }}>
            <span aria-hidden className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold"
                  style={s.done
                    ? { background: "var(--profit)", color: "var(--plane)" }
                    : { border: "1px solid var(--ink3)", color: "var(--ink3)" }}>
              {s.done ? "✓" : i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-semibold">{s.title}</div>
              {!s.done && (
                <>
                  <p className="mt-1 text-[12.5px] leading-relaxed" style={{ color: "var(--ink2)" }}>{s.body}</p>
                  <Link href={s.href}
                        className="mt-2.5 inline-block rounded-lg px-3.5 py-2 text-[12.5px] font-semibold"
                        style={s === next
                          ? { background: "var(--ink)", color: "var(--plane)" }
                          : { border: "1px solid var(--line)", color: "var(--ink2)" }}>
                    {s.cta}
                  </Link>
                </>
              )}
            </div>
          </li>
        ))}
      </ol>

      <details className="group mt-4">
        <summary className="tap cursor-pointer list-none text-[12.5px] font-semibold" style={{ color: "var(--ink2)" }}>
          What each tab is for ›
        </summary>
        <dl className="mt-2 space-y-1.5 rounded-lg p-3 text-[12.5px] leading-relaxed"
            style={{ background: "var(--s3)", color: "var(--ink2)" }}>
          {[
            ["Home", "How you are doing, and the habits costing you most."],
            ["Trades", "Every trade by day. Tap one to see its chart and write about it."],
            ["Review", "Your unwritten trades, so nothing important goes unexamined."],
            ["Insights", "What your results have in common — your head, your timing, your setups."],
            ["More", "The calendar, weekly review, your rules, importing and settings."],
          ].map(([name, what]) => (
            <div key={name}>
              <dt className="inline font-semibold" style={{ color: "var(--ink)" }}>{name} — </dt>
              <dd className="inline">{what}</dd>
            </div>
          ))}
        </dl>
      </details>
    </section>
  );
}
