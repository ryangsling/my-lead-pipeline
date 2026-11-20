import { errorResponse, fieldErrors, withAdmin } from "@/lib/api";
import { channelsInput, saveChannels } from "@/lib/notifications/channels";
import { getWorkspace } from "@/lib/workspaces";

export const PUT = withAdmin(async (_admin, request: Request, { params }: RouteContext<"/api/workspaces/[id]/notifications">) => {
  const { id } = await params;
  if (!(await getWorkspace(id))) return errorResponse(404, "Workspace not found");
  const parsed = channelsInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse(422, "Invalid channels", fieldErrors(parsed.error));
  return Response.json({ channels: await saveChannels(id, parsed.data) });
});
