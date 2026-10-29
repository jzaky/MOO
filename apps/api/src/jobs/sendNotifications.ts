import { fileURLToPath } from "node:url";
import path from "node:path";
import { eq } from "drizzle-orm";
import { createDatabase, type Database } from "../db/client";
import { notificationDeliveries, pushTokens } from "../db/schema";
import { notificationPlan, sendExpoPush } from "../routes/platform";

/**
 * Deliver due notifications. Run every few minutes from a scheduler (cron,
 * a container job, etc.). Each user is processed inside their own RLS
 * context; delivery keys make re-runs and overlapping runs harmless.
 */
export async function deliverDueNotifications(db: Database, now = new Date(), windowMin = 10, fetchImpl: typeof fetch = fetch) {
  const owners = await db.system.selectDistinct({ userId: pushTokens.userId }).from(pushTokens);
  let sent = 0;
  for (const { userId } of owners) {
    const due = await db.asUser(userId, async (tx) => {
      const plan = await notificationPlan(tx, userId, new Date(now.getTime() - windowMin * 60_000), 1);
      return plan.filter((n) => new Date(n.sendAt).getTime() <= now.getTime());
    });
    if (!due.length) continue;
    const tokens = (await db.system.select({ token: pushTokens.token }).from(pushTokens).where(eq(pushTokens.userId, userId))).map((r) => r.token);
    for (const n of due) {
      const claimed = await db.asUser(userId, (tx) => tx.insert(notificationDeliveries).values({ userId, key: n.key }).onConflictDoNothing().returning());
      if (!claimed.length) continue; // already sent
      await sendExpoPush(tokens, { title: n.title, body: n.body, data: { kind: n.kind } }, fetchImpl);
      sent++;
    }
  }
  return { users: owners.length, sent };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const db = createDatabase(process.env.DATABASE_URL ?? "postgres://stoke_app:stoke_app@localhost:5432/stoke_dev", process.env.DATABASE_OWNER_URL ?? "postgres://stoke_owner:stoke_owner@localhost:5432/stoke_dev", { max: 3 });
  deliverDueNotifications(db)
    .then((r) => console.log(`notifications: ${r.sent} sent for ${r.users} users`))
    .finally(() => db.close());
}
