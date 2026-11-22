"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { requireAdminOrRedirect } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { embeds } from "@/lib/db/schema";
import { getWorkspace } from "@/lib/workspaces";

export async function enableWorkspaceChat(workspaceId: string) {
  await requireAdminOrRedirect();
  const workspace = await getWorkspace(workspaceId);
  if (workspace?.status !== "active") notFound();
  await db.insert(embeds).values({
    workspaceId,
    publicKey: `pk_${randomBytes(16).toString("hex")}`,
    voiceEnabled: false,
    formEnabled: false,
  }).onConflictDoUpdate({ target: embeds.workspaceId, set: { chatEnabled: true } });
  revalidatePath("/settings/integrations/chat-providers");
}
