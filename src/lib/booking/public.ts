import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { calendars, embeds, workspaces } from "@/lib/db/schema";

/** The active workspace behind a public embed key. The key is public by design; it only selects a workspace. */
export async function workspaceForKey(publicKey: string) {
  const [row] = await db
    .select({
      workspaceId: embeds.workspaceId, slug: workspaces.slug, timezone: workspaces.timezone, country: workspaces.country,
      serviceZips: workspaces.serviceZips, serviceCities: workspaces.serviceCities, requestOnly: calendars.publicBookingRequestOnly,
    })
    .from(embeds)
    .innerJoin(workspaces, eq(workspaces.id, embeds.workspaceId))
    .leftJoin(calendars, eq(calendars.workspaceId, embeds.workspaceId))
    .where(and(eq(embeds.publicKey, publicKey), eq(workspaces.status, "active")));
  return row;
}
