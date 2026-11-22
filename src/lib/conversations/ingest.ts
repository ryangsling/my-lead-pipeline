import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { upsertContact } from "@/lib/crm/contacts";
import { db } from "@/lib/db/client";
import { appointments, conversations, messages } from "@/lib/db/schema";
import { dispositions } from "@/lib/vapi/structured";
import { enqueueCallEnded } from "@/lib/notifications/events";
import { deliverNotifications } from "@/lib/notifications/send";
import { callErased, lockPrivacy } from "@/lib/privacy/scope";
import { recordingConsentAt, recordingEnabledFor } from "@/lib/vapi/recording";

const turn = z.object({ role: z.string(), message: z.string().optional(), time: z.number().optional() });

const report = z.object({
  type: z.literal("end-of-call-report"),
  cost: z.number().optional(),
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
  durationSeconds: z.number().optional(),
  summary: z.string().optional(),
  recordingUrl: z.string().optional(),
  analysis: z.object({ summary: z.string().optional() }).optional(),
  call: z.object({
    id: z.string(),
    type: z.string().optional(),
    customer: z.object({ number: z.string().optional(), name: z.string().optional() }).optional(),
  }),
  artifact: z
    .object({
      recordingUrl: z.string().optional(),
      messages: z.array(turn).optional(),
      structuredOutputs: z.record(z.string(), z.object({ result: z.unknown() })).optional(),
    })
    .optional(),
});

/** Vapi names the assistant's turns "bot"; the hub stores "assistant". Other roles are not transcript. */
const transcriptRole: Record<string, "user" | "assistant"> = { user: "user", bot: "assistant", assistant: "assistant" };

function structuredFields(outputs: Record<string, { result: unknown }> = {}) {
  const merged: Record<string, unknown> = {};
  for (const { result } of Object.values(outputs)) {
    if (result && typeof result === "object" && !Array.isArray(result)) Object.assign(merged, result);
  }
  return merged;
}

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

/**
 * Turns an end-of-call-report into a conversation, a contact and transcript messages. Safe to run twice:
 * the conversation is keyed by call id and the transcript rows are replaced. Tool rows are kept, and a repeated
 * notification is skipped by its dedupe key.
 * The workspace comes from the authenticated assistant, never from the payload.
 */
export async function ingestEndOfCall(workspaceId: string, payload: unknown, {
  deferDelivery = false, assistantId,
}: { deferDelivery?: boolean; assistantId?: string | null } = {}) {
  const r = report.parse(payload);
  const structured = structuredFields(r.artifact?.structuredOutputs);
  const grant = recordingConsentAt(payload);
  const consentAt = grant && await recordingEnabledFor(workspaceId) ? grant : null;

  const values = {
    startedAt: r.startedAt ? new Date(r.startedAt) : null,
    endedAt: r.endedAt ? new Date(r.endedAt) : null,
    durationS: r.durationSeconds === undefined ? null : Math.round(r.durationSeconds),
    costUsd: r.cost === undefined ? null : String(r.cost),
    summary: r.summary ?? r.analysis?.summary ?? null,
    recordingConsentAt: consentAt,
    recordingUrl: consentAt ? r.artifact?.recordingUrl ?? r.recordingUrl ?? null : null,
    lastActivityAt: new Date(),
  };
  const disposition = z.enum(dispositions).safeParse(structured.disposition);
  if (!disposition.success) delete structured.disposition;
  const outcome = disposition.success ? disposition.data : structured.booked === true ? "booked" : "no_booking";

  const conversationId = await db.transaction(async (tx) => {
    await lockPrivacy(tx, workspaceId);
    if (await callErased(workspaceId, r.call.id, tx)) return null;
    const number = text(r.call.customer?.number);
    const contact = number ? await upsertContact({
      workspaceId,
      name: text(structured.name) ?? text(r.call.customer?.name),
      phone: number,
      email: text(structured.email),
      source: r.call.type === "webCall" ? "web_voice" : "phone",
      seenAt: new Date(Math.min(Date.now(), values.endedAt?.getTime() ?? Date.now())),
    }, undefined, tx) : null;
    const contactId = contact?.ok ? contact.id : null;
    const [row] = await tx
      .insert(conversations)
      .values({
        workspaceId,
        channel: r.call.type === "webCall" ? "web_voice" : "phone",
        externalId: r.call.id,
        vapiAssistantId: assistantId,
        contactId,
        structured,
        outcome,
        ...values,
      })
      .onConflictDoUpdate({
        target: [conversations.workspaceId, conversations.externalId],
        set: {
          ...values,
          contactId: sql`coalesce(${contactId}, ${conversations.contactId})`,
          vapiAssistantId: sql`coalesce(${conversations.vapiAssistantId}, ${assistantId ?? null})`,
          structured: sql`${JSON.stringify(structured)}::jsonb || ${conversations.structured}`,
          outcome: sql`coalesce(${conversations.outcome}, ${outcome})`,
        },
      })
      .returning({ id: conversations.id });

    const [booking] = await tx.select({ id: appointments.id }).from(appointments)
      .where(and(eq(appointments.workspaceId, workspaceId), eq(appointments.conversationId, row.id),
        inArray(appointments.status, ["booked", "confirmed", "rescheduled"]))).limit(1);
    if (booking) await tx.update(conversations).set({ outcome: "booked" })
      .where(and(eq(conversations.id, row.id), eq(conversations.workspaceId, workspaceId)));

    await tx
      .delete(messages)
      .where(and(eq(messages.workspaceId, workspaceId), eq(messages.conversationId, row.id),
        inArray(messages.role, ["user", "assistant"])));
    const transcript = (r.artifact?.messages ?? []).flatMap((t) => {
      const role = transcriptRole[t.role];
      return role && t.message
        ? [{ workspaceId, conversationId: row.id, role, content: t.message, createdAt: t.time ? new Date(t.time) : new Date() }]
        : [];
    });
    if (transcript.length) await tx.insert(messages).values(transcript);
    return row.id;
  });
  const notifications = conversationId ? await db.transaction(async tx => {
    await lockPrivacy(tx, workspaceId);
    return enqueueCallEnded(workspaceId, conversationId, tx);
  }) : [];
  if (!deferDelivery) await deliverNotifications(notifications);
  return { conversationId, notifications };
}
