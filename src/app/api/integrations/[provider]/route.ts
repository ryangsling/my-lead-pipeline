import { errorResponse, fieldErrors, withAdmin, workspaceScope } from "@/lib/api";
import { isProvider } from "@/lib/integrations/providers";
import { putSchema, toView, updateIntegration } from "@/lib/integrations/service";
import { getExactIntegration } from "@/lib/integrations/store";

type Ctx = RouteContext<"/api/integrations/[provider]">;

/** `?workspaceId=<uuid>` picks a workspace override. No parameter means the global row. */
export const GET = withAdmin(async (_admin, request: Request, { params }: Ctx) => {
  const { provider } = await params;
  if (!isProvider(provider)) return errorResponse(404, "Unknown provider");
  const workspaceId = workspaceScope(request);
  if (workspaceId === undefined) return errorResponse(422, "Invalid workspaceId");
  return Response.json(toView(provider, await getExactIntegration(provider, workspaceId)));
});

export const PUT = withAdmin(async (_admin, request: Request, { params }: Ctx) => {
  const { provider } = await params;
  if (!isProvider(provider)) return errorResponse(404, "Unknown provider");
  const workspaceId = workspaceScope(request);
  if (workspaceId === undefined) return errorResponse(422, "Invalid workspaceId");
  const parsed = putSchema(provider).safeParse(await request.json());
  if (!parsed.success) return errorResponse(422, "Invalid fields", fieldErrors(parsed.error));
  return Response.json(await updateIntegration(provider, workspaceId, parsed.data));
});
