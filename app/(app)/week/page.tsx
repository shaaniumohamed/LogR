import { redirect } from "next/navigation";
import { localDayKey } from "@/lib/core/metrics";
import { mondayOf } from "@/lib/core/calendar";
import { requireContext } from "@/lib/session";

export const dynamic = "force-dynamic";

/** /week means "this week", in the trader's own clock. */
export default async function ThisWeek() {
  const { timeZone } = await requireContext();
  redirect(`/week/${mondayOf(localDayKey(new Date(), timeZone))}`);
}
