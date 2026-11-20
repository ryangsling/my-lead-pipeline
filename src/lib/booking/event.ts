import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { contacts } from "@/lib/db/schema";

/** Google event title and description: who booked, how to reach them, and any notes. */
export async function eventDetails(
  workspaceId: string,
  contactId: string | null,
  serviceName: string,
  notes: string | null,
) {
  const [contact] = contactId
    ? await db
        .select({ name: contacts.name, phone: contacts.phoneE164, email: contacts.email })
        .from(contacts)
        .where(and(eq(contacts.id, contactId), eq(contacts.workspaceId, workspaceId)))
    : [];
  const lines = [
    contact?.name && `Name: ${contact.name}`,
    contact?.phone && `Phone: ${contact.phone}`,
    contact?.email && `Email: ${contact.email}`,
    notes && `Notes: ${notes}`,
  ].filter(Boolean);
  return {
    summary: contact?.name ? `${serviceName} - ${contact.name}` : serviceName,
    description: lines.length ? lines.join("\n") : undefined,
  };
}
