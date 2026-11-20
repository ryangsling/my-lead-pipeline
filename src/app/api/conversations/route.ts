import { errorResponse, withAdmin, workspaceScope } from "@/lib/api";
import { listConversations } from "@/lib/crm/list";

export const GET = withAdmin(async (_admin, request: Request) => {
  const workspaceId = workspaceScope(request);
  if (!workspaceId) return errorResponse(400, "workspaceId is required");
  return Response.json({ conversations: await listConversations(workspaceId) });
});
