import { errorResponse, withAdmin, workspaceScope } from "@/lib/api";
import { isProvider } from "@/lib/integrations/providers";
import { getExactIntegration, recordTest } from "@/lib/integrations/store";
import { testProvider } from "@/lib/integrations/testers";

type Ctx = RouteContext<"/api/integrations/[provider]/test">;

/** Tests the saved keys for this scope and stores the outcome. Email providers send to the admin. */
export const POST = withAdmin(async (admin, request: Request, { params }: Ctx) => {
  const { provider } = await params;
  if (!isProvider(provider)) return errorResponse(404, "Unknown provider");
  const workspaceId = workspaceScope(request);
  if (workspaceId === undefined) return errorResponse(422, "Invalid workspaceId");
  const row = await getExactIntegration(provider, workspaceId);
  if (!row) return errorResponse(422, "Save the keys first");
  const result = await testProvider(provider, { ...row.creds, ...row.config, to: admin.email });
  await recordTest(provider, workspaceId, result);
  return Response.json(result);
});
