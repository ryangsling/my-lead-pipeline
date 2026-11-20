import { and, eq } from "drizzle-orm";
import { errorResponse, withAdmin, workspaceScope } from "@/lib/api";
import { db } from "@/lib/db/client";
import { conversations } from "@/lib/db/schema";
import { resolveVapiAccount } from "@/lib/vapi/account";
import { vapiFetch } from "@/lib/vapi/client";

type Ctx = RouteContext<"/api/conversations/[id]/recording">;

/**
 * The recording link stored from the report is private and returns 400. Vapi hands out a short-lived signed
 * link on request, so the player asks here and is redirected to it.
 */
export const GET = withAdmin(async (_admin, request: Request, { params }: Ctx) => {
  const workspaceId = workspaceScope(request);
  if (!workspaceId) return errorResponse(400, "workspaceId is required");
  const { id } = await params;
  const [conversation] = await db
    .select({ externalId: conversations.externalId })
    .from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.workspaceId, workspaceId)));
  if (!conversation?.externalId) return errorResponse(404, "Conversation not found");

  try {
    const { privateKey } = await resolveVapiAccount(workspaceId);
    const call = await vapiFetch<{ artifact?: { presignedMonoUrl?: string } }>(privateKey, `/call/${conversation.externalId}`);
    const url = call.artifact?.presignedMonoUrl;
    return url ? Response.redirect(url, 302) : errorResponse(404, "No recording for this call");
  } catch (error) {
    return errorResponse(502, error instanceof Error ? error.message : "Could not reach Vapi");
  }
});
