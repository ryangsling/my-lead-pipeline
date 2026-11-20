import { errorResponse, fieldErrors, withAdmin } from "@/lib/api";
import { bookingSettings, saveBookingSettings } from "@/lib/booking/settings";
import { getWorkspace } from "@/lib/workspaces";

type Ctx = RouteContext<"/api/workspaces/[id]/booking">;

export const PUT = withAdmin(async (_admin, request: Request, { params }: Ctx) => {
  const { id } = await params;
  if (!(await getWorkspace(id))) return errorResponse(404, "Workspace not found");
  const parsed = bookingSettings.safeParse(await request.json());
  if (!parsed.success) return errorResponse(422, "Invalid booking settings", fieldErrors(parsed.error));
  return Response.json({ settings: await saveBookingSettings(id, parsed.data) });
});
