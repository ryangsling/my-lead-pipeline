import { errorResponse, fieldErrors, withAdmin } from "@/lib/api";
import { archiveWorkspace, getWorkspace, updateWorkspace, workspacePatch } from "@/lib/workspaces";

type Ctx = RouteContext<"/api/workspaces/[id]">;
const notFound = () => errorResponse(404, "Workspace not found");

export const GET = withAdmin(async (_admin, _req: Request, { params }: Ctx) => {
  const workspace = await getWorkspace((await params).id);
  return workspace ? Response.json({ workspace }) : notFound();
});

export const PATCH = withAdmin(async (_admin, request: Request, { params }: Ctx) => {
  const parsed = workspacePatch.safeParse(await request.json());
  if (!parsed.success) return errorResponse(422, "Invalid workspace", fieldErrors(parsed.error));
  const result = await updateWorkspace((await params).id, parsed.data);
  if (!result) return notFound();
  if ("fields" in result) return errorResponse(422, "Invalid workspace", result.fields);
  return Response.json({ workspace: result.workspace });
});

/** Archives the workspace. Nothing is deleted. */
export const DELETE = withAdmin(async (_admin, _req: Request, { params }: Ctx) => {
  const workspace = await archiveWorkspace((await params).id);
  return workspace ? Response.json({ workspace }) : notFound();
});
