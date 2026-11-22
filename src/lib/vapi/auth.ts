import { timingSafeEqual } from "node:crypto";
import { and, eq, or } from "drizzle-orm";
import { decrypt } from "@/lib/crypto";
import { db } from "@/lib/db/client";
import { assistantSyncs, assistants, workspaces } from "@/lib/db/schema";

function equal(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Resolves the Vapi assistant ID to one workspace, then checks its `x-vapi-secret` in constant time.
 */
export async function authenticateVapi(request: Request, vapiAssistantId: string) {
  const rows = await db
    .selectDistinct({ workspaceId: assistants.workspaceId, status: workspaces.status, timezone: workspaces.timezone, country: workspaces.country,
      serviceZips: workspaces.serviceZips, serviceCities: workspaces.serviceCities, secret: workspaces.webhookSecretEncrypted })
    .from(assistantSyncs)
    .innerJoin(assistants, and(eq(assistants.workspaceId, assistantSyncs.workspaceId), eq(assistants.id, assistantSyncs.assistantId)))
    .innerJoin(workspaces, eq(workspaces.id, assistants.workspaceId))
    .where(or(eq(assistantSyncs.vapiAssistantId, vapiAssistantId),
      eq(assistantSyncs.replacementVapiAssistantId, vapiAssistantId)))
    .limit(2);
  if (rows.length !== 1) return null;
  const [row] = rows;
  const provided = request.headers.get("x-vapi-secret") ?? "";
  const { secret, ...workspace } = row;
  return equal(provided, decrypt(secret)) ? workspace : null;
}
