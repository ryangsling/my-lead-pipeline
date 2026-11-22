import { and, asc, desc, eq, ilike, or } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { appointments, contacts, conversations, messages, services } from "@/lib/db/schema";

const escapeLike = (value: string) => value.replace(/[\\%_]/g, "\\$&");

/** Newest first. `q` matches name, phone or email; `source` is an exact match. */
export function listContacts(workspaceId: string, filter: { q?: string; source?: string } = {}) {
  const q = filter.q?.trim();
  const like = q ? `%${escapeLike(q)}%` : null;
  return db
    .select()
    .from(contacts)
    .where(
      and(
        eq(contacts.workspaceId, workspaceId),
        filter.source ? eq(contacts.source, filter.source) : undefined,
        like ? or(ilike(contacts.name, like), ilike(contacts.phoneE164, like), ilike(contacts.email, like)) : undefined,
      ),
    )
    .orderBy(desc(contacts.createdAt))
    .limit(200);
}

/** A contact with every conversation and appointment, or null in another workspace. */
export async function getContact(workspaceId: string, id: string) {
  const [contact] = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.id, id), eq(contacts.workspaceId, workspaceId)));
  if (!contact) return null;
  const [talks, bookings] = await Promise.all([
    db
      .select()
      .from(conversations)
      .where(and(eq(conversations.contactId, id), eq(conversations.workspaceId, workspaceId)))
      .orderBy(desc(conversations.startedAt)),
    db
      .select({
        id: appointments.id,
        startAt: appointments.startAt,
        status: appointments.status,
        service: services.name,
      })
      .from(appointments)
      .leftJoin(services, and(eq(services.workspaceId, appointments.workspaceId), eq(services.id, appointments.serviceId)))
      .where(and(eq(appointments.contactId, id), eq(appointments.workspaceId, workspaceId)))
      .orderBy(desc(appointments.startAt)),
  ]);
  return { contact, conversations: talks, appointments: bookings };
}

/** Newest first, with the contact name. */
export function listConversations(workspaceId: string, limit = 200) {
  return db
    .select({
      id: conversations.id,
      channel: conversations.channel,
      startedAt: conversations.startedAt,
      createdAt: conversations.createdAt,
      durationS: conversations.durationS,
      costUsd: conversations.costUsd,
      outcome: conversations.outcome,
      summary: conversations.summary,
      contactName: contacts.name,
      contactPhone: contacts.phoneE164,
    })
    .from(conversations)
    .leftJoin(contacts, and(eq(contacts.workspaceId, conversations.workspaceId), eq(contacts.id, conversations.contactId)))
    .where(eq(conversations.workspaceId, workspaceId))
    .orderBy(desc(conversations.createdAt))
    .limit(limit);
}

/** One conversation with its contact and every message, oldest first. */
export async function getConversation(workspaceId: string, id: string) {
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.workspaceId, workspaceId)));
  if (!conversation) return null;
  const [contact, thread] = await Promise.all([
    conversation.contactId
      ? db
          .select()
          .from(contacts)
          .where(and(eq(contacts.id, conversation.contactId), eq(contacts.workspaceId, workspaceId)))
          .then((rows) => rows[0] ?? null)
      : null,
    db.select().from(messages)
      .where(and(eq(messages.workspaceId, workspaceId), eq(messages.conversationId, id))).orderBy(asc(messages.createdAt)),
  ]);
  return { conversation, contact, messages: thread };
}
