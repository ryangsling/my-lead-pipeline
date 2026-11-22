import { errorResponse, withAdmin, workspaceScope } from "@/lib/api";
import { listDeletions } from "@/lib/privacy/audit";
import { z } from "zod";

export const GET = withAdmin(async (_admin, request: Request) => {
  const workspaceId = workspaceScope(request);
  if (!workspaceId) return errorResponse(400, "workspaceId is required");
  const requestId = z.uuid().nullable().safeParse(new URL(request.url).searchParams.get("requestId"));
  if (!requestId.success) return errorResponse(400, "Invalid deletion reference");
  return Response.json({ deletions: await listDeletions(workspaceId, requestId.data ?? undefined) });
});
