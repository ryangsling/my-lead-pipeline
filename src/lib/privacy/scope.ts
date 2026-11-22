import { createHmac } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { deletionLog } from "@/lib/db/schema";
import { env } from "@/lib/env";

export type PrivacyTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export function privacyKey(workspaceId: string, kind: string, value: string) {
  return createHmac("sha256", Buffer.from(env.ENCRYPTION_KEY, "base64"))
    .update(JSON.stringify(["retention-v1", workspaceId, kind, value])).digest("hex");
}

/** Exclusion with privacy writes, scoped to the workspace and released on transaction end. */
export async function lockPrivacy(tx: PrivacyTransaction, workspaceId: string, exclusive = false) {
  if (exclusive) await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${workspaceId}::text, 812))`);
  else await tx.execute(sql`select pg_advisory_xact_lock_shared(hashtextextended(${workspaceId}::text, 812))`);
}

export async function callErased(workspaceId: string, callId: string, connection: Pick<typeof db, "select"> = db) {
  const [row] = await connection.select({ id: deletionLog.id }).from(deletionLog)
    .where(and(eq(deletionLog.workspaceId, workspaceId), eq(deletionLog.kind, "vapi"),
      eq(deletionLog.subjectKey, privacyKey(workspaceId, "vapi", callId))));
  return Boolean(row);
}
