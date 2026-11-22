import { timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { decrypt } from "@/lib/crypto";
import { db } from "@/lib/db/client";
import { assistantSyncs, assistants, workspaces } from "@/lib/db/schema";

function equal(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Finds the workspace from the Vapi assistant id, then compares `x-vapi-secret` with that
 * workspace's own secret in constant time. A secret from another workspace fails.
 */
export async function authenticateVapi(request: Request, vapiAssistantId: string) {
  const [row] = await db
    .select({ workspaceId: assistants.workspaceId, status: workspaces.status, secret: workspaces.webhookSecretEncrypted })
    .from(assistantSyncs)
    .innerJoin(assistants, eq(assistants.id, assistantSyncs.assistantId))
    .innerJoin(workspaces, eq(workspaces.id, assistants.workspaceId))
    .where(eq(assistantSyncs.vapiAssistantId, vapiAssistantId));
  if (!row) return null;
  const provided = request.headers.get("x-vapi-secret") ?? "";
  return equal(provided, decrypt(row.secret)) ? { workspaceId: row.workspaceId, status: row.status } : null;
}
