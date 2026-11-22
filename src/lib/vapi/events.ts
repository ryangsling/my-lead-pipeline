import { and, asc, eq, inArray, lte, or, sql } from "drizzle-orm";
import { ZodError } from "zod";
import { ingestEndOfCall } from "@/lib/conversations/ingest";
import { db } from "@/lib/db/client";
import { webhookEvents } from "@/lib/db/schema";
import { deliverNotifications, type NotificationRef } from "@/lib/notifications/send";
import { callErased, lockPrivacy } from "@/lib/privacy/scope";

type EventKey = { workspaceId: string; source: "vapi"; externalId: string };
const END_OF_CALL = "end-of-call-report";
const LEASE_MS = 30_000;

function keyFor({ workspaceId, source, externalId }: EventKey) {
  return and(eq(webhookEvents.workspaceId, workspaceId), eq(webhookEvents.source, source), eq(webhookEvents.externalId, externalId));
}

function due(now: Date) {
  return or(
    and(inArray(webhookEvents.status, ["pending", "retryable"]), lte(webhookEvents.nextAttemptAt, now)),
    and(eq(webhookEvents.status, "processing"), lte(webhookEvents.leaseUntil, now)),
  );
}

/** Store the authenticated tenant and sanitized payload before replying to Vapi. */
export async function recordWebhook(key: EventKey, eventType: string, raw: unknown, callId: string, assistantId: string) {
  const process = eventType === END_OF_CALL;
  return db.transaction(async tx => {
    await lockPrivacy(tx, key.workspaceId);
    if (await callErased(key.workspaceId, callId, tx)) return false;
    await tx.insert(webhookEvents).values({
      ...key, eventType, callId, vapiAssistantId: assistantId, raw,
      status: process ? "pending" : "succeeded", processedAt: process ? null : new Date(), nextAttemptAt: process ? new Date() : null,
    }).onConflictDoNothing();
    return true;
  });
}

async function processWebhook(key: EventKey) {
  const now = new Date();
  const [claimed] = await db.update(webhookEvents).set({
    status: "processing", attempts: sql`${webhookEvents.attempts} + 1`, leaseUntil: new Date(now.getTime() + LEASE_MS),
    nextAttemptAt: null,
  }).where(and(keyFor(key), eq(webhookEvents.eventType, END_OF_CALL), due(now)))
    .returning({ raw: webhookEvents.raw, attempts: webhookEvents.attempts, assistantId: webhookEvents.vapiAssistantId });
  if (!claimed) return { status: "skipped" as const, notifications: [] };

  const attempt = and(keyFor(key), eq(webhookEvents.status, "processing"), eq(webhookEvents.attempts, claimed.attempts));
  let notifications: NotificationRef[];
  try {
    ({ notifications } = await ingestEndOfCall(key.workspaceId, (claimed.raw as { message?: unknown }).message,
      { deferDelivery: true, assistantId: claimed.assistantId }));
  } catch (error) {
    const invalid = error instanceof ZodError;
    const retryMs = Math.min(60_000, 1_000 * 2 ** (claimed.attempts - 1));
    await db.update(webhookEvents).set({
      status: invalid ? "invalid" : "retryable",
      error: invalid ? "Invalid end-of-call report." : "End-of-call processing failed. The report will be retried.",
      processedAt: invalid ? new Date() : null, leaseUntil: null,
      nextAttemptAt: invalid ? null : new Date(Date.now() + retryMs),
    }).where(attempt);
    return { status: invalid ? "invalid" as const : "retryable" as const, notifications: [] };
  }

  await db.update(webhookEvents).set({
    status: "succeeded", processedAt: new Date(), error: null, leaseUntil: null,
  }).where(attempt);
  return { status: "succeeded" as const, notifications };
}

export async function processWebhookAfterReply(key: EventKey) {
  const { notifications } = await processWebhook(key);
  await deliverNotifications(notifications);
}

export async function sweepWebhooks() {
  const rows = await db.select({ workspaceId: webhookEvents.workspaceId, externalId: webhookEvents.externalId })
    .from(webhookEvents)
    .where(and(eq(webhookEvents.source, "vapi"), eq(webhookEvents.eventType, END_OF_CALL), due(new Date())))
    .orderBy(asc(webhookEvents.receivedAt)).limit(20);
  const results = await Promise.allSettled(rows.flatMap(({ workspaceId, externalId }) =>
    workspaceId ? [processWebhook({ workspaceId, source: "vapi", externalId })] : []));
  return {
    examined: results.length,
    succeeded: results.filter((result) => result.status === "fulfilled" && result.value.status === "succeeded").length,
  };
}
