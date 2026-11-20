import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { appointments, contacts, services } from "@/lib/db/schema";

/** Newest first, with the service and contact names. */
export function listAppointments(workspaceId: string, limit = 200) {
  return db
    .select({
      id: appointments.id,
      startAt: appointments.startAt,
      endAt: appointments.endAt,
      status: appointments.status,
      source: appointments.source,
      notes: appointments.notes,
      service: services.name,
      contactName: contacts.name,
      contactPhone: contacts.phoneE164,
    })
    .from(appointments)
    .leftJoin(services, eq(services.id, appointments.serviceId))
    .leftJoin(contacts, eq(contacts.id, appointments.contactId))
    .where(eq(appointments.workspaceId, workspaceId))
    .orderBy(desc(appointments.startAt))
    .limit(limit);
}
