import { errorResponse, withAdmin, workspaceScope } from "@/lib/api";
import { chatChainInput, listChatProviders, saveChatProviders } from "@/lib/chat/providers";
import { getWorkspace } from "@/lib/workspaces";

export const GET = withAdmin(async (_admin, request: Request) => {
  const scope = workspaceScope(request);
  if (scope === undefined) return errorResponse(422, "Invalid workspace");
  if (scope && !(await getWorkspace(scope))) return errorResponse(404, "Workspace not found");
  return Response.json({ providers: await listChatProviders(scope) }, { headers: { "cache-control": "no-store" } });
});

export const PUT = withAdmin(async (_admin, request: Request) => {
  const scope = workspaceScope(request);
  if (scope === undefined) return errorResponse(422, "Invalid workspace");
  if (scope && !(await getWorkspace(scope))) return errorResponse(404, "Workspace not found");
  const parsed = chatChainInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse(422, "Enter valid provider details and use at most five providers.");
  if (!(await saveChatProviders(scope, parsed.data))) return errorResponse(422, "Use providers from this chain and supply a key for new providers.");
  return Response.json({ providers: await listChatProviders(scope) }, { headers: { "cache-control": "no-store" } });
});
