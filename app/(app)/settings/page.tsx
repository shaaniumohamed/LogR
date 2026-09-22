import Link from "next/link";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { requireContext } from "@/lib/session";
import { OWNER_EMAILS, gateIsOpen, listInvites } from "@/lib/access";
import { People } from "./people";
import { checkHealth, regionName, verdictFor } from "@/lib/health";
import { COMMON_ZONES, isValidZone, offsetLabel } from "@/lib/timezones";
import { Card, Eyebrow, Note, Verdict } from "@/components/ui";
import { DetectZone } from "./detect-zone";

export const dynamic = "force-dynamic";

export default async function Settings() {
  const [ctx, health, invites] = await Promise.all([requireContext(), checkHealth(), listInvites()]);
  const current = ctx.timeZone;
  const speed = verdictFor(health.dbMs);

  async function save(formData: FormData) {
    "use server";
    const s = await auth();
    const uid = s!.user!.id!;
    const tz = String(formData.get("timeZone") ?? "").trim();
    if (!isValidZone(tz)) return;
    await db.update(users).set({ timeZone: tz }).where(eq(users.id, uid));
    revalidatePath("/", "layout");
  }

  const known = COMMON_ZONES.some((z) => z.zone === current);
  const now = new Intl.DateTimeFormat("en-GB", {
    timeZone: current, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date());

  /*
   * The bottom bar holds five sections and there are more than five screens, so
   * this tab is both Settings and the place the rest of them live. A hub beats a
   * seventh tab: the pages below are opened deliberately and occasionally, not
   * thumbed between.
   */
  const MORE = [
    { href: "/playbook", label: "Playbook", blurb: "Each setup on its own, and what separates its winners" },
    { href: "/import", label: "Import trade history", blurb: "Drop in a broker CSV — re-importing only adds what is new" },
    { href: "/import?tab=candles", label: "Price history", blurb: "Candles behind your charts, and which days are missing them" },
  ];

  return (
    <div className="space-y-4">
      <Card className="!p-0">
        <ul>
          {MORE.map((m, i) => (
            <li key={m.href} style={{ borderTop: i === 0 ? "none" : "1px solid var(--line)" }}>
              <Link href={m.href} className="flex items-center gap-3 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-semibold">{m.label}</div>
                  <div className="mt-0.5 text-[12px]" style={{ color: "var(--ink3)" }}>{m.blurb}</div>
                </div>
                <span className="shrink-0" style={{ color: "var(--ink3)" }}>›</span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>

      {ctx.isOwner && (
        <Card>
          <Eyebrow>Who can use this</Eyebrow>
          <Verdict>
            Add a friend&rsquo;s Google address and they can sign in immediately — no redeploy,
            no setting to edit.
          </Verdict>
          <People
            owners={OWNER_EMAILS}
            gateOpen={gateIsOpen()}
            invites={invites.map((i) => ({ ...i, createdAt: i.createdAt.toISOString() }))}
          />
          <div className="mt-4 rounded-lg p-3 text-[12.5px] leading-relaxed"
               style={{ background: "var(--s3)", color: "var(--ink2)" }}>
            <b>Everyone gets their own journal.</b> Trades, notes, mark-up and settings are per
            person — your friends cannot see yours and you cannot see theirs. The only thing
            shared is the price history, because a gold candle at 14:32 is the same candle for
            everybody and one person fetching a month covers it for the rest.
            <br /><br />
            <b>Removing someone deletes nothing.</b> It stops them signing in; their own journal
            stays exactly as it was, and inviting them again brings it back.
            <br /><br />
            <b>Owners</b> are the addresses in <code className="num">OWNER_EMAILS</code> on the
            host. They can always sign in and only they see this panel, which is why that one
            setting still lives outside the app.
          </div>
        </Card>
      )}

      <Card>
        <Eyebrow>Put it on your home screen</Eyebrow>
        <Verdict>
          Added to the home screen this opens without a browser bar — a third of the screen
          back, and the tabs sit where an app&rsquo;s would.
        </Verdict>
        <div className="mt-3 space-y-2 text-[13px] leading-relaxed" style={{ color: "var(--ink2)" }}>
          <p>
            <b>iPhone:</b> open this page in Safari, tap the share button, then{" "}
            <b>Add to Home Screen</b>. It has to be Safari — other browsers on iOS cannot
            install it.
          </p>
          <p>
            <b>Android:</b> the browser offers <b>Install app</b> in its menu.
          </p>
          <p style={{ color: "var(--ink3)" }}>
            It is the same app either way, signed in the same way. Nothing is stored on the
            phone beyond what a browser already keeps.
          </p>
        </div>
      </Card>

      <Card>
        <Eyebrow>Speed</Eyebrow>
        <Verdict>
          The database is <b className={speed.tone === "pos" ? "pos" : speed.tone === "neg" ? "neg" : undefined}>
            {speed.label}
          </b>
          {health.dbMs !== null ? <> — <b className="num">{health.dbMs} ms</b> for a question with no work in it.</> : "."}
        </Verdict>
        <Note>{speed.advice}</Note>
        <div className="mt-3 grid grid-cols-2 gap-3 text-[13px]">
          <div>
            <div className="text-[11px]" style={{ color: "var(--ink3)" }}>App runs in</div>
            <div className="font-semibold">{regionName(health.region)}</div>
          </div>
          <div>
            <div className="text-[11px]" style={{ color: "var(--ink3)" }}>Round trip</div>
            <div className="num font-semibold">{health.dbMs === null ? "—" : `${health.dbMs} ms`}</div>
          </div>
        </div>
        <div className="mt-4 rounded-lg p-3 text-[12.5px] leading-relaxed"
             style={{ background: "var(--s3)", color: "var(--ink2)" }}>
          <b>Why this number decides how the app feels.</b> Every screen here is built fresh
          when you open it, because the figures on it are yours and change with every import.
          Building one takes a handful of questions to the database, and each question costs
          this much before any work is done. Two or three milliseconds is invisible; two or
          three hundred is most of a second of staring at nothing.
          <br /><br />
          <b>If this number is large.</b> It means the app and the database are in different
          parts of the world, and the fix is to put them in the same one. Check which region
          your Neon project is in, then set the app&rsquo;s region to match it in{" "}
          <b>Vercel → Settings → Functions</b>. It is a one-line change and it is worth more
          than any amount of tuning in the code.
        </div>
      </Card>

      <Card>
        <Eyebrow>Your time zone</Eyebrow>
        <Verdict>
          Every time in the app is shown in this zone. Your broker exports in UTC, and
          &ldquo;avoid 13:00 UTC&rdquo; is an abstraction where &ldquo;avoid 9pm&rdquo; is a decision.
        </Verdict>

        <form action={save} className="mt-4 space-y-3">
          <select name="timeZone" defaultValue={current}
                  className="w-full rounded-lg px-3 py-2.5 text-sm"
                  style={{ background: "var(--s2)", border: "1px solid var(--line)", color: "var(--ink)" }}>
            {!known && <option value={current}>{current} (current)</option>}
            {COMMON_ZONES.map((z) => (
              <option key={z.zone} value={z.zone}>
                {z.label} · {offsetLabel(z.zone)}
              </option>
            ))}
          </select>
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className="rounded-lg px-4 py-2.5 text-sm font-semibold"
                    style={{ background: "var(--ink)", color: "var(--plane)" }}>
              Save time zone
            </button>
            <DetectZone current={current} />
          </div>
        </form>

        <Note>
          Currently <b>{current}</b> · {offsetLabel(current)} · it is <b>{now}</b> there now.
        </Note>

        <div className="mt-4 rounded-lg p-3 text-[12.5px] leading-relaxed"
             style={{ background: "var(--s3)", color: "var(--ink2)" }}>
          <b>Daylight saving is handled for you.</b> Zones are stored by name rather than as a
          fixed offset, so each trade is shown at the offset that was actually in force on the
          day it happened. Malaysia and the Maldives never shift; if you move somewhere that
          does, past trades keep rendering correctly.
          <br /><br />
          <b>If you move, history moves with you.</b> Changing this re-buckets every past trade
          into the new local clock — trades you made at 9pm in Malaysia will read as 6pm on
          Maldives time. That is right for market-session questions and wrong for
          &ldquo;was I tired?&rdquo; questions. Tell me if you relocate and I will pin each trade
          to where you were when you made it.
        </div>
      </Card>
    </div>
  );
}
