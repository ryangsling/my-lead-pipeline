import { and, eq, isNull } from "drizzle-orm";
import { notFound } from "next/navigation";
import { AgentForm } from "@/components/agent-form";
import { assistantDefaults, getAssistant } from "@/lib/agent/store";
import { db } from "@/lib/db/client";
import { assistantSyncs, phoneNumbers } from "@/lib/db/schema";
import { getIntegration } from "@/lib/integrations/store";
import { getWorkspaceBySlug } from "@/lib/workspaces";

export default async function AgentPage({ params }: PageProps<"/w/[slug]/agent">) {
  const w = await getWorkspaceBySlug((await params).slug);
  if (!w) notFound();

  const assistant = await getAssistant(w.id);
  const defaults = assistantDefaults(w.name);
  const [sync] = assistant
    ? await db
        .select()
        .from(assistantSyncs)
        .where(and(eq(assistantSyncs.workspaceId, w.id), eq(assistantSyncs.assistantId, assistant.id), isNull(assistantSyncs.vapiAccountId)))
    : [];
  const [assigned] = await db.select().from(phoneNumbers).where(eq(phoneNumbers.workspaceId, w.id));
  const vapi = await getIntegration("vapi", w.id);

  return (
    <>
      <h1 className="mb-4 text-xl font-medium">Agent for {w.name}</h1>
      <AgentForm
        workspaceId={w.id}
        publicKey={vapi?.config.publicKey ?? ""}
        initial={{
          personaName: assistant?.personaName ?? defaults.personaName,
          firstMessage: assistant?.firstMessage ?? defaults.firstMessage,
          systemPrompt: assistant?.systemPrompt ?? defaults.systemPrompt,
          knowledge: assistant?.knowledge ?? defaults.knowledge,
          voiceId: assistant?.voiceId ?? defaults.voiceId,
          model: assistant?.model ?? defaults.model,
          maxDurationS: assistant?.maxDurationS ?? defaults.maxDurationS,
          structuredFields: Array.isArray(assistant?.structuredSchema) && assistant.structuredSchema.length
            ? (assistant.structuredSchema as string[])
            : defaults.structuredSchema,
        }}
        sync={{
          vapiAssistantId: sync?.vapiAssistantId ?? null,
          syncedAt: sync?.syncedAt?.toISOString() ?? null,
          syncError: sync?.syncError ?? null,
        }}
        assigned={assigned ? { id: assigned.vapiPhoneNumberId, number: assigned.e164 } : null}
      />
    </>
  );
}
