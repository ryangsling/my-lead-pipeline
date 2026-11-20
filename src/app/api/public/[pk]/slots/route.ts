import { DateTime } from "luxon";
import { z } from "zod";
import { errorResponse } from "@/lib/api";
import { getOpenSlots } from "@/lib/booking/availability";
import { workspaceForKey } from "@/lib/booking/public";

const query = z.object({
  serviceId: z.uuid(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});

/** Open slots for the public booking page and embeds. No login. */
export async function GET(request: Request, { params }: RouteContext<"/api/public/[pk]/slots">) {
  const target = await workspaceForKey((await params).pk);
  if (!target) return errorResponse(404, "Not found");
  const parsed = query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return errorResponse(422, "Invalid request");

  const today = DateTime.now().setZone(target.timezone);
  const from = parsed.data.from ?? (today.toISODate() as string);
  const to = parsed.data.to ?? (today.plus({ days: 13 }).toISODate() as string);
  try {
    const slots = await getOpenSlots({ workspaceId: target.workspaceId, serviceId: parsed.data.serviceId, from, to, limit: 300 });
    return Response.json({ timezone: target.timezone, slots });
  } catch {
    return errorResponse(503, "Booking is not available right now");
  }
}
