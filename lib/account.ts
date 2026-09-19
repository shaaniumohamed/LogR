import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { tradingAccounts } from "@/lib/db/schema";

/**
 * Every user gets one trading account on first use. Multi-account comes later;
 * the schema already supports it, so nothing here has to change when it does.
 */
export async function getOrCreateAccount(userId: string) {
  const existing = await db.query.tradingAccounts.findFirst({
    where: eq(tradingAccounts.userId, userId),
  });
  if (existing) return existing;

  const [created] = await db
    .insert(tradingAccounts)
    .values({ userId, nickname: "Main", broker: "Exness", currency: "USD" })
    .returning();
  return created;
}
