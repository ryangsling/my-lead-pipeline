import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { upsertContact } from "@/lib/crm/contacts";
import { db } from "@/lib/db/client";
import { conversations, messages } from "@/lib/db/schema";
import { notifyCallEnded } from "@/lib/notifications/events";

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
export async function ingestEndOfCall(workspaceId: string, payload: unknown) {
  const r = report.parse(payload);
  const structured = structuredFields(r.artifact?.structuredOutputs);

  const number = text(r.call.customer?.number);
  const contact = number
    ? await upsertContact({
        workspaceId,
        name: text(structured.name) ?? text(r.call.customer?.name),
        phone: number,
        email: text(structured.email),
        source: r.call.type === "webCall" ? "web_voice" : "phone",
      })
    : null;
  const contactId = contact?.ok ? contact.id : null;

  const values = {
    contactId,
    startedAt: r.startedAt ? new Date(r.startedAt) : null,
    endedAt: r.endedAt ? new Date(r.endedAt) : null,
    durationS: r.durationSeconds === undefined ? null : Math.round(r.durationSeconds),
    costUsd: r.cost === undefined ? null : String(r.cost),
    summary: r.summary ?? r.analysis?.summary ?? null,
    recordingUrl: r.artifact?.recordingUrl ?? r.recordingUrl ?? null,
    lastActivityAt: new Date(),
  };
  const outcome = structured.booked === true ? "booked" : "no_booking";

  const conversationId = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(conversations)
      .values({
        workspaceId,
        channel: r.call.type === "webCall" ? "web_voice" : "phone",
        externalId: r.call.id,
        structured,
        outcome,
        ...values,
      })
      .onConflictDoUpdate({
        target: [conversations.workspaceId, conversations.externalId],
        set: {
          ...values,
          contactId: sql`coalesce(${values.contactId}, ${conversations.contactId})`,
          structured: sql`${JSON.stringify(structured)}::jsonb || ${conversations.structured}`,
          outcome: sql`coalesce(${conversations.outcome}, ${outcome})`,
        },
      })
      .returning({ id: conversations.id });

    await tx
      .delete(messages)
      .where(and(eq(messages.conversationId, row.id), inArray(messages.role, ["user", "assistant"])));
    const transcript = (r.artifact?.messages ?? []).flatMap((t) => {
      const role = transcriptRole[t.role];
      return role && t.message ? [{ conversationId: row.id, role, content: t.message, createdAt: t.time ? new Date(t.time) : new Date() }] : [];
    });
    if (transcript.length) await tx.insert(messages).values(transcript);
    return row.id;
  });
  await notifyCallEnded(workspaceId, conversationId);
  return conversationId;
}
