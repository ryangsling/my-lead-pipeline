import { z } from "zod";
import { errorResponse } from "@/lib/api";
import { AuthError, requireAdmin } from "@/lib/auth";
import { calendarScope, googleConfigured, oauthClient, signState } from "@/lib/google/oauth";
import { getWorkspace } from "@/lib/workspaces";

export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    await requireAdmin();
  } catch (e) {
    if (e instanceof AuthError) return Response.redirect(new URL("/login", url.origin));
    throw e;
  }

  const workspaceId = url.searchParams.get("workspaceId") ?? "";
  if (!z.uuid().safeParse(workspaceId).success) return errorResponse(400, "Invalid workspace");
  const workspace = await getWorkspace(workspaceId);
  if (!workspace) return errorResponse(404, "Workspace not found");
  if (!googleConfigured()) return errorResponse(500, "Google OAuth is not configured");

  const redirectUri = `${url.origin}/api/google/oauth/callback`;
  const authUrl = oauthClient(redirectUri).generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [calendarScope],
    state: signState(workspaceId),
  });
  return Response.redirect(authUrl);
}
