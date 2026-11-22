import { after } from "next/server";
import { z } from "zod";
import { errorResponse, fieldErrors } from "@/lib/api";
import { bookAppointment, bookingModeChanged } from "@/lib/booking/book";
import { workspaceForKey } from "@/lib/booking/public";
import { limitPublicBooking } from "@/lib/booking/public-rate-limit";
import { requestBooking } from "@/lib/booking/request";
import { intakeFields } from "@/lib/crm/jobs";
import { normalizePhone } from "@/lib/crm/contacts";
import { bookingNotificationKey } from "@/lib/notifications/events";
import { deliverNotifications, queuedNotifications } from "@/lib/notifications/send";
import { reference } from "@/lib/tools/speak";

const body = z.object({
  ...intakeFields,
  serviceId: z.uuid(),
  start: z.iso.datetime({ offset: true }),
  name: z.string().trim().min(1, "Name is required").max(120),
  phone: z.string().trim().min(1, "Phone is required").max(40),
  email: z.union([z.literal(""), z.email()]).optional(),
  notes: z.string().trim().max(1000).optional(),
  requireRequestOnly: z.literal(true).optional(),
});

function bookingError({ reason, message }: { reason: string; message: string }) {
  switch (reason) {
    case "pending": return Response.json({ status: "pending", message }, { status: 202 });
    case "calendar_error": return errorResponse(502, message);
    case "missing_location":
    case "outside_area":
    case "booking_mode_changed": return errorResponse(422, message);
    default: return errorResponse(409, message);
  }
}

/** Creates a public appointment or records a callback request, as configured by the workspace. */
export async function POST(request: Request, { params }: RouteContext<"/api/public/[pk]/book">) {
  const target = await workspaceForKey((await params).pk);
  if (!target) return errorResponse(404, "Not found");
  const retryAfter = await limitPublicBooking(target.workspaceId, request.headers);
  if (retryAfter) return Response.json({ error: "Too many booking attempts. Please try again later." }, {
    status: 429, headers: { "Retry-After": String(retryAfter) },
  });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse(422, "Invalid request", fieldErrors(parsed.error));
  const input = parsed.data;
  if (input.requireRequestOnly && !target.requestOnly) return bookingError(bookingModeChanged);
  const phone = normalizePhone(input.phone, target.country);
  if (!phone) return errorResponse(422, "Invalid request", { phone: "That phone number does not look right" });
  const contact = { name: input.name, phone, email: input.email?.toLowerCase() || undefined };
  if (target.requestOnly) {
    const result = await requestBooking({ ...input, workspaceId: target.workspaceId, slug: target.slug, contact, intake: input });
    if (!result.ok) return bookingError(result);
    after(() => deliverNotifications(result.deliveries));
    return Response.json({ status: "requested", message: "Your request was sent. The team will contact you to confirm a time." }, { status: 202 });
  }

  const result = await bookAppointment({
    workspaceId: target.workspaceId,
    intake: input,
    serviceId: input.serviceId,
    publicContact: contact,
    start: input.start,
    source: "form",
    site: input,
    notes: input.notes,
  });
  if (result.ok) {
    const { id, startAt, endAt } = result.appointment;
    after(async () => {
      await deliverNotifications(await queuedNotifications(target.workspaceId, bookingNotificationKey(id)));
    });
    return Response.json({ appointment: { id, startAt, endAt }, reference: reference(id) }, { status: 201 });
  }
  return bookingError(result);
}
