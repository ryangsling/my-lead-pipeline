import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminHeader } from "@/components/admin-header";
import { Button } from "@/components/ui/button";
import { requireAdminOrRedirect } from "@/lib/auth";
import { listChatProviders } from "@/lib/chat/providers";
import { db } from "@/lib/db/client";
import { embeds } from "@/lib/db/schema";
import { listWorkspaces } from "@/lib/workspaces";
import { enableWorkspaceChat } from "./actions";
import { ProviderChainForm } from "./provider-chain-form";

const path = "/settings/integrations/chat-providers";

export default async function ChatProvidersPage({ searchParams }: PageProps<typeof path>) {
  await requireAdminOrRedirect();
  const { workspaceId } = await searchParams;
  const workspaces = await listWorkspaces();
  const selected = workspaces.find(workspace => workspace.id === workspaceId);
  if (workspaceId && !selected) notFound();
  const scope = selected?.id ?? null;
  const [providers, embed] = await Promise.all([
    listChatProviders(scope),
    scope ? db.select({ enabled: embeds.chatEnabled }).from(embeds).where(eq(embeds.workspaceId, scope)) : [],
  ]);

  return (
    <>
      <AdminHeader />
      <main className="max-w-3xl space-y-4 p-4">
        <Link href="/settings/integrations" className="text-sm underline">Integrations</Link>
        <h1 className="text-xl font-medium">Chat providers</h1>
        <nav aria-label="Provider chains" className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
          <Link href={path} aria-current={scope ? undefined : "page"} className={!scope ? "font-semibold underline" : "underline"}>Global</Link>
          {workspaces.map(workspace => (
            <Link key={workspace.id} href={`${path}?workspaceId=${workspace.id}`}
              aria-current={scope === workspace.id ? "page" : undefined}
              className={scope === workspace.id ? "font-semibold underline" : "underline"}>{workspace.name}</Link>
          ))}
        </nav>
        <h2 className="font-medium">{selected ? `${selected.name} override` : "Global chain"}</h2>
        <p className="text-sm text-muted-foreground">
          {selected ? "This workspace uses the global chain when its override is empty." : "Workspaces without an override use this chain."}
          {" "}Chat tries enabled, tool-capable providers from top to bottom. Enable Chat providers unavailable in workspace Notifications to alert the owner if a chat cannot get an answer.
        </p>
        {selected && (embed[0]?.enabled ? (
          <Link className="text-sm underline" href={`/chat/${selected.slug}`}>Open workspace chat</Link>
        ) : (
          <form action={enableWorkspaceChat.bind(null, selected.id)}>
            <Button type="submit" variant="outline">Enable workspace chat</Button>
          </form>
        ))}
        <ProviderChainForm key={scope ?? "global"} workspaceId={scope} initial={providers} />
      </main>
    </>
  );
}
