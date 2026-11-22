import { after } from "next/server";
import { z } from "zod";
import { errorResponse, fieldErrors, withAdmin, workspaceScope } from "@/lib/api";
import { listAppointments } from "@/lib/booking/list";
import { appointmentStatuses, updateAppointmentStatus } from "@/lib/booking/status";
import { notifyBookingCancelled } from "@/lib/notifications/events";

export const GET = withAdmin(async (_admin, request: Request) => {
  const workspaceId = workspaceScope(request);
  if (!workspaceId) return errorResponse(400, "workspaceId is required");
  return Response.json({ appointments: await listAppointments(workspaceId) });
});

const patch = z.object({
  workspaceId: z.uuid(),
  id: z.uuid(),
  status: z.enum(appointmentStatuses),
  newStart: z.iso.datetime({ offset: true }).optional(),
});

export const PATCH = withAdmin(async (_admin, request: Request) => {
  const parsed = patch.safeParse(await request.json());
  if (!parsed.success) return errorResponse(422, "Invalid request", fieldErrors(parsed.error));
  const { workspaceId, id, status, newStart } = parsed.data;
  const result = await updateAppointmentStatus(workspaceId, id, status, newStart);
  if (!result.ok) {
    if ("reason" in result && result.reason === "pending") return Response.json({ status: "pending", message: result.message }, { status: 202 });
    return errorResponse(409, result.message);
  }
  if (status === "cancelled") after(() => notifyBookingCancelled(workspaceId, id));
  return Response.json({ appointment: result.appointment });
});
