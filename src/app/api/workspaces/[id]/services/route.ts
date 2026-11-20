import { errorResponse, fieldErrors, withAdmin } from "@/lib/api";
import { saveServices, servicesInput } from "@/lib/booking/settings";
import { getWorkspace } from "@/lib/workspaces";

type Ctx = RouteContext<"/api/workspaces/[id]/services">;

export const PUT = withAdmin(async (_admin, request: Request, { params }: Ctx) => {
  const { id } = await params;
  if (!(await getWorkspace(id))) return errorResponse(404, "Workspace not found");
  const parsed = servicesInput.safeParse(await request.json());
  if (!parsed.success) return errorResponse(422, "Invalid services", fieldErrors(parsed.error));
  return Response.json({ services: await saveServices(id, parsed.data) });
});
