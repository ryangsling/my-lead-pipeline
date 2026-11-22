import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/lib/db/client";
import { embeds, workspaces } from "@/lib/db/schema";
import { ChatPanel } from "./chat-panel";

export default async function ChatPage({ params }: PageProps<"/chat/[slug]">) {
  const { slug } = await params;
  const [workspace] = await db.select({ name: workspaces.name, publicKey: embeds.publicKey })
    .from(workspaces).innerJoin(embeds, eq(embeds.workspaceId, workspaces.id))
    .where(and(eq(workspaces.slug, slug), eq(workspaces.status, "active"), eq(embeds.chatEnabled, true)));
  if (!workspace) notFound();
  return (
    <main className="mx-auto max-w-xl space-y-4 p-4">
      <h1 className="text-xl font-medium">Chat with {workspace.name}</h1>
      <ChatPanel publicKey={workspace.publicKey} />
    </main>
  );
}
