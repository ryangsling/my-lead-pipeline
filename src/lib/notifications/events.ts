import { and, eq, inArray } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/lib/db/client";
import { appointments, contacts, conversations, services, workspaces } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { lockPrivacy } from "@/lib/privacy/scope";
import { deliverNotifications, enqueue, type NotificationRef } from "./send";

type Connection = Pick<typeof db, "select" | "insert">;

async function loadAppointment(workspaceId: string, appointmentId: string, connection: Connection = db) {
  const [row] = await connection
    .select({
      startAt: appointments.startAt,
      name: contacts.name,
      phone: contacts.phoneE164,
      service: services.name,
      slug: workspaces.slug,
      timezone: workspaces.timezone,
      piiErasedAt: appointments.piiErasedAt,
    })
    .from(appointments)
    .innerJoin(workspaces, eq(workspaces.id, appointments.workspaceId))
    .leftJoin(contacts, and(eq(contacts.workspaceId, appointments.workspaceId), eq(contacts.id, appointments.contactId)))
    .leftJoin(services, and(eq(services.workspaceId, appointments.workspaceId), eq(services.id, appointments.serviceId)))
    .where(and(eq(appointments.id, appointmentId), eq(appointments.workspaceId, workspaceId)));
  return row ?? null;
}

const whenIn = (date: Date, timezone: string) => DateTime.fromJSDate(date, { zone: timezone }).toFormat("ccc d LLL yyyy, HH:mm");

/** A booking made on the booking page or in chat notifies at once; voice bookings come from `notifyCallEnded`. */
export const bookingNotificationKey = (appointmentId: string) => `booking_new:${appointmentId}`;

export async function enqueueBookingNew(
  workspaceId: string, appointmentId: string, extra: { summary?: string | null; link?: string } = {}, connection: Connection = db,
) {
  const a = await loadAppointment(workspaceId, appointmentId, connection);
  if (!a || a.piiErasedAt) return [];
  return enqueue(
    workspaceId,
    "booking_new",
    { name: a.name, phone: a.phone, service: a.service, when: whenIn(a.startAt, a.timezone), summary: extra.summary, link: extra.link ?? `${env.APP_URL}/w/${a.slug}/appointments` },
    bookingNotificationKey(appointmentId),
    { connection },
  );
}

export async function notifyBookingCancelled(workspaceId: string, appointmentId: string) {
  const deliveries = await db.transaction(async tx => {
    await lockPrivacy(tx, workspaceId);
    const a = await loadAppointment(workspaceId, appointmentId, tx);
    if (!a || a.piiErasedAt) return [];
    return enqueue(workspaceId, "booking_cancelled", {
      name: a.name, phone: a.phone, service: a.service, when: whenIn(a.startAt, a.timezone), link: `${env.APP_URL}/w/${a.slug}/appointments`,
    }, `booking_cancelled:${appointmentId}`, { connection: tx });
  });
  await deliverNotifications(deliveries);
}

/**
 * After the end-of-call report is stored (D13: the report carries the summary). A call that booked sends
 * `booking_new` per appointment, a call that captured a lead sends `lead_captured`, any other call `call_no_booking`.
 */
export async function enqueueCallEnded(workspaceId: string, conversationId: string, connection: Connection = db) {
  const [c] = await connection
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
    .leftJoin(contacts, and(eq(contacts.workspaceId, conversations.workspaceId), eq(contacts.id, conversations.contactId)))
    .where(and(eq(conversations.id, conversationId), eq(conversations.workspaceId, workspaceId)));
  if (!c) return [];
  const link = `${env.APP_URL}/w/${c.slug}/conversations/${conversationId}`;

  const booked = await connection
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
    const deliveries: NotificationRef[] = [];
    for (const { id } of booked) deliveries.push(...await enqueueBookingNew(workspaceId, id, { summary: c.summary, link }, connection));
    return deliveries;
  }

  if (["urgent", "price_question", "existing_customer", "vendor", "spam"].includes(c.outcome ?? "")) return [];

  const fields = c.structured as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === "string" ? value : null);
  const event = c.outcome === "lead" ? "lead_captured" : "call_no_booking";
  return enqueue(
    workspaceId,
    event,
    { name: c.name ?? text(fields.name), phone: c.phone ?? text(fields.phone), service: text(fields.service), summary: c.summary, link },
    `${event}:${conversationId}`, { connection },
  );
}

export async function notifyCallEnded(workspaceId: string, conversationId: string) {
  const deliveries = await db.transaction(async tx => {
    await lockPrivacy(tx, workspaceId);
    return enqueueCallEnded(workspaceId, conversationId, tx);
  });
  await deliverNotifications(deliveries);
}
