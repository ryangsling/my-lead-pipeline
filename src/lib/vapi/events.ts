import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { webhookEvents } from "@/lib/db/schema";

/** Stores the raw event first. Returns the row id, or null when this event was already stored. */
export async function recordWebhook(source: string, externalId: string, eventType: string, raw: unknown) {
  const [row] = await db
    .insert(webhookEvents)
    .values({ source, eventType, externalId, raw })
    .onConflictDoNothing()
    .returning({ id: webhookEvents.id });
  return row?.id ?? null;
}

/** Marks a stored event processed, or failed when an error message is given. */
export async function finishWebhook(id: string, error?: string) {
  await db.update(webhookEvents).set({ processedAt: new Date(), error: error ?? null }).where(eq(webhookEvents.id, id));
}
