import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { COMMON_ZONES, isValidZone, offsetLabel } from "@/lib/timezones";
import { Card, Eyebrow, Note, Verdict } from "@/components/ui";
import { DetectZone } from "./detect-zone";

export const dynamic = "force-dynamic";

export default async function Settings() {
  const session = await auth();
  const userId = session!.user!.id!;
  const me = await db.query.users.findFirst({ where: eq(users.id, userId) });
  const current = me?.timeZone ?? "UTC";

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

  return (
    <div className="space-y-4">
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
