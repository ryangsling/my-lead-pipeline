import { and, desc, eq, or, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { deletionLog } from "@/lib/db/schema";

export function listDeletions(workspaceId: string, requestId?: string) {
  const query = db.select({
    id: deletionLog.id, requestId: deletionLog.requestId, kind: deletionLog.kind, reason: deletionLog.reason, status: deletionLog.status,
    attempts: deletionLog.attempts, nextAttemptAt: deletionLog.nextAttemptAt, errorCode: deletionLog.errorCode,
    createdAt: deletionLog.createdAt, verifiedAt: deletionLog.verifiedAt,
  }).from(deletionLog).where(and(eq(deletionLog.workspaceId, workspaceId), requestId
    ? or(eq(deletionLog.id, requestId), eq(deletionLog.requestId, requestId)) : undefined))
    .orderBy(sql`${deletionLog.status} = 'verified'`, desc(deletionLog.createdAt));
  return requestId ? query : query.limit(50);
}
