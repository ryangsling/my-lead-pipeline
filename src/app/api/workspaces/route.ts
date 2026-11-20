import { errorResponse, fieldErrors, withAdmin } from "@/lib/api";
import { createWorkspace, listWorkspaces, workspaceInput } from "@/lib/workspaces";

export const GET = withAdmin(async () => Response.json({ workspaces: await listWorkspaces() }));

export const POST = withAdmin(async (_admin, request: Request) => {
  const parsed = workspaceInput.safeParse(await request.json());
  if (!parsed.success) return errorResponse(422, "Invalid workspace", fieldErrors(parsed.error));
  const result = await createWorkspace(parsed.data);
  if ("fields" in result) return errorResponse(422, "Invalid workspace", result.fields);
  return Response.json({ workspace: result.workspace }, { status: 201 });
});
