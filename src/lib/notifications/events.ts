import { and, eq, inArray } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/lib/db/client";
import { appointments, contacts, conversations, services, workspaces } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { notify } from "./send";

async function loadAppointment(workspaceId: string, appointmentId: string) {
  const [row] = await db
    .select({
      startAt: appointments.startAt,
      name: contacts.name,
      phone: contacts.phoneE164,
      service: services.name,
      slug: workspaces.slug,
      timezone: workspaces.timezone,
    })
    .from(appointments)
    .innerJoin(workspaces, eq(workspaces.id, appointments.workspaceId))
    .leftJoin(contacts, eq(contacts.id, appointments.contactId))
    .leftJoin(services, eq(services.id, appointments.serviceId))
    .where(and(eq(appointments.id, appointmentId), eq(appointments.workspaceId, workspaceId)));
  return row ?? null;
}

const whenIn = (date: Date, timezone: string) => DateTime.fromJSDate(date, { zone: timezone }).toFormat("ccc d LLL yyyy, HH:mm");

/** A booking made on the booking page or in chat notifies at once; voice bookings come from `notifyCallEnded`. */
export async function notifyBookingNew(workspaceId: string, appointmentId: string, extra: { summary?: string | null; link?: string } = {}) {
  const a = await loadAppointment(workspaceId, appointmentId);
  if (!a) return;
  await notify(
    workspaceId,
    "booking_new",
    { name: a.name, phone: a.phone, service: a.service, when: whenIn(a.startAt, a.timezone), summary: extra.summary, link: extra.link ?? `${env.APP_URL}/w/${a.slug}/appointments` },
    `booking_new:${appointmentId}`,
  );
}

export async function notifyBookingCancelled(workspaceId: string, appointmentId: string) {
  const a = await loadAppointment(workspaceId, appointmentId);
  if (!a) return;
  await notify(
    workspaceId,
    "booking_cancelled",
    { name: a.name, phone: a.phone, service: a.service, when: whenIn(a.startAt, a.timezone), link: `${env.APP_URL}/w/${a.slug}/appointments` },
    `booking_cancelled:${appointmentId}`,
  );
}

/**
 * After the end-of-call report is stored (D13: the report carries the summary). A call that booked sends
 * `booking_new` per appointment, a call that captured a lead sends `lead_captured`, any other call `call_no_booking`.
 */
export async function notifyCallEnded(workspaceId: string, conversationId: string) {
  const [c] = await db
    .select({
      outcome: conversations.outcome,
      summary: conversations.summary,
      structured: conversations.structured,
      name: contacts.name,
      phone: contacts.phoneE164,
      slug: workspaces.slug,
    })
    .from(conversations)
    .innerJoin(workspaces, eq(workspaces.id, conversations.workspaceId))
    .leftJoin(contacts, eq(contacts.id, conversations.contactId))
    .where(and(eq(conversations.id, conversationId), eq(conversations.workspaceId, workspaceId)));
  if (!c) return;
  const link = `${env.APP_URL}/w/${c.slug}/conversations/${conversationId}`;

  const booked = await db
    .select({ id: appointments.id })
    .from(appointments)
    .where(
      and(
        eq(appointments.workspaceId, workspaceId),
        eq(appointments.conversationId, conversationId),
        inArray(appointments.status, ["booked", "confirmed", "rescheduled"]),
      ),
    );
  if (booked.length) {
    for (const { id } of booked) await notifyBookingNew(workspaceId, id, { summary: c.summary, link });
    return;
  }

  const fields = c.structured as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === "string" ? value : null);
  const event = c.outcome === "lead" ? "lead_captured" : "call_no_booking";
  await notify(
    workspaceId,
    event,
    { name: c.name ?? text(fields.name), phone: c.phone ?? text(fields.phone), service: text(fields.service), summary: c.summary, link },
    `${event}:${conversationId}`,
  );
}
