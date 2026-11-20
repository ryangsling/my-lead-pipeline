import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { embeds, workspaces } from "@/lib/db/schema";

/** The active workspace behind a public embed key. The key is public by design; it only selects a workspace. */
export async function workspaceForKey(publicKey: string) {
  const [row] = await db
    .select({ workspaceId: embeds.workspaceId, slug: workspaces.slug, timezone: workspaces.timezone })
    .from(embeds)
    .innerJoin(workspaces, eq(workspaces.id, embeds.workspaceId))
    .where(and(eq(embeds.publicKey, publicKey), eq(workspaces.status, "active")));
  return row;
}
