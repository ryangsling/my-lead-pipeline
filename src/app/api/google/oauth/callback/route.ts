import { z } from "zod";
import { errorResponse } from "@/lib/api";
import { AuthError, requireAdmin } from "@/lib/auth";
import { oauthClient, verifyState } from "@/lib/google/oauth";
import { recordTest, saveIntegration } from "@/lib/integrations/store";
import { getWorkspace } from "@/lib/workspaces";

export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) return Response.redirect(new URL("/login", url.origin));
    throw e;
  }

  const workspaceId = verifyState(url.searchParams.get("state") ?? "");
  if (!workspaceId || !z.uuid().safeParse(workspaceId).success) {
    return errorResponse(400, "Invalid or expired state");
  }
  const workspace = await getWorkspace(workspaceId);
  if (!workspace) return errorResponse(404, "Workspace not found");

  const target = (query: string) => new URL(`/w/${workspace.slug}/booking?${query}`, url.origin);
  if (url.searchParams.has("error")) return Response.redirect(target("error=Google%20connection%20cancelled"));
  const code = url.searchParams.get("code");
  if (!code) return Response.redirect(target("error=Google%20did%20not%20return%20a%20code"));

  try {
    const client = oauthClient(`${url.origin}/api/google/oauth/callback`);
    const { tokens } = await client.getToken(code);
    if (!tokens.refresh_token) {
      return Response.redirect(target("error=Google%20did%20not%20return%20a%20refresh%20token"));
    }
    await saveIntegration("google", workspaceId, { refreshToken: tokens.refresh_token }, {});
    await recordTest("google", workspaceId, { ok: true });
    return Response.redirect(target("connected=1"));
  } catch {
    return Response.redirect(target("error=Google%20token%20exchange%20failed"));
  }
}
