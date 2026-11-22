import { eq } from "drizzle-orm";
import { upsertContact } from "@/lib/crm/contacts";
import { saveJob, type JobIntake } from "@/lib/crm/jobs";
import { db } from "@/lib/db/client";
import { calendars, conversations } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { enqueue } from "@/lib/notifications/send";
import { bookingModeChanged, validateBooking, type BookAppointmentInput } from "./book";
import { repeatedTimeOffset } from "./time";

/** Records an available time as a preference in a CRM lead. */
export async function requestBooking(input: {
  workspaceId: string;
  slug: string;
  serviceId: string;
  start: string;
  contact: NonNullable<BookAppointmentInput["publicContact"]>;
  intake: JobIntake;
  notes?: string;
}) {
  const validation = await validateBooking({ ...input, site: input.intake });
  if (!validation.ok) return validation;
  const { workspaceId, slug, contact, intake, notes } = input;
  const { service, start, calendar } = validation;
  const offset = repeatedTimeOffset(start);
  const when = `${start.toFormat("ccc d LLL yyyy, HH:mm")} (${offset ?? calendar.timezone})`;

  return db.transaction(async tx => {
    const [settings] = await tx.select({ requestOnly: calendars.publicBookingRequestOnly })
      .from(calendars).where(eq(calendars.workspaceId, workspaceId)).for("share");
    if (!settings?.requestOnly) return bookingModeChanged;

    const person = await upsertContact({ workspaceId, source: "form", ...contact }, undefined, tx);
    if (!person.ok) throw new Error("Invalid contact on a public booking request");
    const [conversation] = await tx.insert(conversations).values({
      workspaceId,
      contactId: person.id,
      channel: "form",
      outcome: "lead",
      summary: notes || null,
      structured: { service: service.name, preferred_time: when },
    }).returning({ id: conversations.id });
    await saveJob({ workspaceId, contactId: person.id, conversationId: conversation.id, timezone: calendar.timezone, intake }, tx);
    const deliveries = await enqueue(workspaceId, "form_submitted", {
      name: contact.name,
      phone: contact.phone,
      service: service.name,
      when,
      summary: notes,
      link: `${env.APP_URL}/w/${slug}/conversations/${conversation.id}`,
    }, `form_submitted:${conversation.id}`, { connection: tx });
    return { ok: true, deliveries } as const;
  });
}
