import { and, asc, desc, eq, notInArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { notificationChannels, notificationLog } from "@/lib/db/schema";
import { notificationEvents } from "./format";

export const channelsInput = z.object({
  channels: z.array(
    z
      .object({
        id: z.uuid().optional(),
        type: z.enum(["telegram", "email"]),
        target: z.string().trim().min(1, "Target is required"),
        events: z.array(z.enum(notificationEvents)),
        active: z.boolean(),
      })
      .refine((c) => c.type !== "email" || z.email().safeParse(c.target).success, { message: "Enter a valid email address", path: ["target"] }),
  ),
});
export type ChannelsInput = z.infer<typeof channelsInput>;

export function listChannels(workspaceId: string) {
  return db.select().from(notificationChannels).where(eq(notificationChannels.workspaceId, workspaceId)).orderBy(asc(notificationChannels.type), asc(notificationChannels.target));
}

/** Replaces the workspace's channel list: rows missing from the input are removed, their log rows are kept. */
export async function saveChannels(workspaceId: string, input: ChannelsInput) {
  await db.transaction(async (tx) => {
    const kept: string[] = [];
    for (const { id, ...values } of input.channels) {
      const updated = id
        ? await tx
            .update(notificationChannels)
            .set(values)
            .where(and(eq(notificationChannels.id, id), eq(notificationChannels.workspaceId, workspaceId)))
            .returning({ id: notificationChannels.id })
        : [];
      const [row] = updated.length ? updated : await tx.insert(notificationChannels).values({ workspaceId, ...values }).returning({ id: notificationChannels.id });
      kept.push(row.id);
    }
    await tx
      .delete(notificationChannels)
      .where(and(eq(notificationChannels.workspaceId, workspaceId), kept.length ? notInArray(notificationChannels.id, kept) : undefined));
  });
  return listChannels(workspaceId);
}

/** Newest first, with the channel it went to. */
export function listLog(workspaceId: string, limit = 50) {
  return db
    .select({
      id: notificationLog.id,
      event: notificationLog.event,
      status: notificationLog.status,
      attempts: notificationLog.attempts,
      error: notificationLog.error,
      sentAt: notificationLog.sentAt,
      createdAt: notificationLog.createdAt,
      type: notificationChannels.type,
      target: notificationChannels.target,
    })
    .from(notificationLog)
    .leftJoin(notificationChannels, and(eq(notificationChannels.workspaceId, notificationLog.workspaceId),
      eq(notificationChannels.id, notificationLog.channelId)))
    .where(eq(notificationLog.workspaceId, workspaceId))
    .orderBy(desc(notificationLog.createdAt))
    .limit(limit);
}
