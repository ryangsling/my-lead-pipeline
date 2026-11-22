import { after } from "next/server";
import { z } from "zod";
import { errorResponse, fieldErrors } from "@/lib/api";
import { bookAppointment } from "@/lib/booking/book";
import { coverageError, siteFields } from "@/lib/booking/coverage";
import { workspaceForKey } from "@/lib/booking/public";
import { upsertContact } from "@/lib/crm/contacts";
import { notifyBookingNew } from "@/lib/notifications/events";
import { reference } from "@/lib/tools/speak";

const body = z.object({
  ...siteFields,
  serviceId: z.uuid(),
  start: z.iso.datetime({ offset: true }),
  name: z.string().trim().min(1, "Name is required").max(120),
  phone: z.string().trim().min(1, "Phone is required").max(40),
  email: z.union([z.literal(""), z.email()]).optional(),
  notes: z.string().trim().max(1000).optional(),
});

/** Books through the same path as the voice tool. No login. */
export async function POST(request: Request, { params }: RouteContext<"/api/public/[pk]/book">) {
  const target = await workspaceForKey((await params).pk);
  if (!target) return errorResponse(404, "Not found");
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse(422, "Invalid request", fieldErrors(parsed.error));
  const input = parsed.data;
  const issue = coverageError(target, input);
  if (issue) return errorResponse(422, issue);

  const contact = await upsertContact({
    workspaceId: target.workspaceId,
    name: input.name,
    phone: input.phone,
    email: input.email,
    source: "form",
  });
  if (!contact.ok) return errorResponse(422, "Invalid request", { phone: "That phone number does not look right" });

  const result = await bookAppointment({
    workspaceId: target.workspaceId,
    ...siteFields,
  serviceId: input.serviceId,
    contactId: contact.id,
    start: input.start,
    source: "form",
    site: input,
    notes: input.notes,
  });
  if (result.ok) {
    const { id, startAt, endAt } = result.appointment;
    after(() => notifyBookingNew(target.workspaceId, id));
    return Response.json({ appointment: { id, startAt, endAt }, reference: reference(id) }, { status: 201 });
  }
  return errorResponse(result.reason === "calendar_error" ? 502 : result.reason === "missing_location" || result.reason === "outside_area" ? 422 : 409, result.message);
}
