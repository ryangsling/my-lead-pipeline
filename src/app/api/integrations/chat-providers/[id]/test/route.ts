import { z } from "zod";
import { errorResponse, withAdmin, workspaceScope } from "@/lib/api";
import { testChatProvider } from "@/lib/chat/model";
import { getChatProvider } from "@/lib/chat/providers";

type Ctx = RouteContext<"/api/integrations/chat-providers/[id]/test">;

export const POST = withAdmin(async (_admin, request: Request, { params }: Ctx) => {
  const scope = workspaceScope(request);
  const { id } = await params;
  if (scope === undefined || !z.uuid().safeParse(id).success) return errorResponse(422, "Invalid provider or workspace");
  const provider = await getChatProvider(scope, id);
  if (!provider) return errorResponse(404, "Provider not found");
  return Response.json({ passed: await testChatProvider(provider) }, { headers: { "cache-control": "no-store" } });
});
