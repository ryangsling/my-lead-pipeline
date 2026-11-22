import { getAssistant } from "@/lib/agent/store";
import { errorResponse, withAdmin } from "@/lib/api";
import { syncAssistant } from "@/lib/vapi/sync";
import { getWorkspace } from "@/lib/workspaces";

type Ctx = RouteContext<"/api/workspaces/[id]/assistant/sync">;

export const POST = withAdmin(async (_admin, _request: Request, { params }: Ctx) => {
  const { id } = await params;
  if (!(await getWorkspace(id))) return errorResponse(404, "Workspace not found");
  const assistant = await getAssistant(id);
  if (!assistant) return errorResponse(422, "Save the agent before syncing");
  const result = await syncAssistant(id, assistant.id);
  return result.ok ? Response.json(result) : Response.json(result, { status: 502 });
});
