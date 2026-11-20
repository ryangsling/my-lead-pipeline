import { errorResponse, withAdmin } from "@/lib/api";
import { listCalendars } from "@/lib/google/calendar";
import { getExactIntegration } from "@/lib/integrations/store";
import { getWorkspace } from "@/lib/workspaces";

type Ctx = RouteContext<"/api/workspaces/[id]/calendars">;

/** The Google calendars the connected account can write to. */
export const GET = withAdmin(async (_admin, _request: Request, { params }: Ctx) => {
  const { id } = await params;
  if (!(await getWorkspace(id))) return errorResponse(404, "Workspace not found");
  const google = await getExactIntegration("google", id);
  const refreshToken = google?.creds.refreshToken;
  if (!refreshToken) return errorResponse(409, "Google Calendar is not connected");
  try {
    return Response.json({ calendars: await listCalendars(refreshToken) });
  } catch (e) {
    return errorResponse(502, e instanceof Error ? e.message : "Google Calendar could not be reached");
  }
});
