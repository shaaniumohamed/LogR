import Link from "next/link";
import { notFound } from "next/navigation";
import { loadAnnotation } from "@/lib/actions";
import { loadTrades } from "@/lib/queries";
import { Card, Eyebrow, Note, Stat, StatGrid, money, pct } from "@/components/ui";
import { Info } from "@/components/info";
import { AnnotateForm } from "./annotate-form";

export const dynamic = "force-dynamic";

export default async function TradeDetail({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { id } = await params;
  const { from } = await searchParams;
  const { all, account, timeZone } = await loadTrades("all");

  const t = all.find((x) => x.id === id);
  if (!t) notFound();

  const existing = (await loadAnnotation(account.id, id)) ?? null;

  // Proposed from the zone's own geometry: just beyond the far edge of where the
  // entries filled. The trader confirms or corrects it — a proposal they only
  // have to accept is far likelier to get answered than an empty box.
  const pad = Math.max(0.35, (t.zoneHigh - t.zoneLow) * 0.6);
  const suggested = t.direction === "long" ? t.zoneLow - pad : t.zoneHigh + pad;

  const risk = Math.abs(t.avgEntry - (existing?.invalidation ?? suggested)) * 100 * t.lots;
  const rMultiple = risk > 0 ? t.netPnl / risk : null;

  const fmt = new Intl.DateTimeFormat("en-GB", {
    weekday: "short", day: "numeric", month: "short",
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone,
  });

  // Queue position, so "save and next" can walk the unannotated backlog.
  const next = from === "review" ? "/review" : undefined;

  return (
    <div className="space-y-4">
      <Link href="/trades" className="inline-block text-[13px]" style={{ color: "var(--ink2)" }}>‹ All trades</Link>

      <Card>
        <div className="flex items-start justify-between gap-3">
          <div>
            <Eyebrow>{t.direction === "long" ? "Bought" : "Sold"} {t.symbol}</Eyebrow>
            <div className="num mt-1 text-[13px]" style={{ color: "var(--ink2)" }}>{fmt.format(t.openedAt)}</div>
          </div>
          <div className={`num text-2xl font-semibold ${t.netPnl >= 0 ? "pos" : "neg"}`}>{money(t.netPnl)}</div>
        </div>

        <div className="mt-4">
          <StatGrid cols={4}>
            <Stat label="Entries" value={String(t.legCount)}
                  sub={t.exitCount > t.legCount ? `${t.exitCount} exits` : "1 exit each"} />
            <Stat label="Size" value={`${t.lots.toFixed(2)} lots`} />
            <Stat label="Held" value={t.holdMinutes < 1 ? "<1 min" : `${Math.round(t.holdMinutes)} min`} />
            <Stat label="Result in R" value={rMultiple !== null ? `${rMultiple > 0 ? "+" : "−"}${Math.abs(rMultiple).toFixed(2)}R` : "—"}
                  tone={(rMultiple ?? 0) >= 0 ? "pos" : "neg"}
                  sub={existing?.invalidation ? "measured" : "estimated"} />
          </StatGrid>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 text-[13px] sm:grid-cols-4">
          {[["Average entry", t.avgEntry.toFixed(2)], ["Average exit", t.avgExit.toFixed(2)],
            ["Zone", `${t.zoneLow.toFixed(2)} – ${t.zoneHigh.toFixed(2)}`],
            ["Risked", `$${risk.toFixed(2)}`]].map(([k, v]) => (
            <div key={k}>
              <div className="text-[11px]" style={{ color: "var(--ink3)" }}>{k}</div>
              <div className="num font-semibold">{v}</div>
            </div>
          ))}
        </div>

        <Info title="What does R mean?">
          <b>R stands for risk, not reward.</b> It is the amount you stood to lose if the idea
          failed. A result of +2R means you made twice what you were risking; −1R means you
          lost exactly what you were risking.
          <br /><br />
          It matters because dollars are not comparable across trades — a $40 win on a big
          position and a $40 win on a small one are very different achievements. R puts every
          trade on the same scale. It needs one input from you: the price at which the idea
          was dead.
        </Info>
      </Card>

      <Card>
        <Eyebrow>Annotate this trade</Eyebrow>
        <Note>
          Everything above came from your broker automatically. This part is the half only you
          know — and it is what turns a list of results into something that can tell you why.
        </Note>
        <div className="mt-4">
          <AnnotateForm identityHash={t.id} existing={existing} suggestedInvalidation={suggested} nextHref={next} />
        </div>
      </Card>
    </div>
  );
}
