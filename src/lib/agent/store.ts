import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { assistants } from "@/lib/db/schema";
import { defaultStructuredFields } from "@/lib/vapi/structured";

export const DEFAULT_PROMPT =
  "You are the receptionist for {{business_name}}. Today is {{today}}. Opening hours: {{hours}}. Services: {{services}}. Timezone: {{timezone}}. Book appointments only with the tools provided.";

export const assistantInput = z.object({
  personaName: z.string().trim().min(1).max(80),
  firstMessage: z.string().trim().min(1).max(1000),
  systemPrompt: z.string().trim().min(1).max(20000),
  knowledge: z.string().max(20000),
  voiceId: z.string().trim().min(1).max(100),
  model: z.string().trim().min(1).max(100),
  maxDurationS: z.coerce.number().int().min(30).max(3600),
  structuredFields: z.array(z.string().trim().min(1).max(40)).max(20),
});

export type AssistantInput = z.infer<typeof assistantInput>;
export type AssistantView = typeof assistants.$inferSelect;

export async function getAssistant(workspaceId: string): Promise<AssistantView | undefined> {
  const [row] = await db.select().from(assistants).where(eq(assistants.workspaceId, workspaceId)).limit(1);
  return row;
}

/** Creates the workspace's assistant on first save, then updates it. */
export async function saveAssistant(workspaceId: string, input: AssistantInput): Promise<AssistantView> {
  const existing = await getAssistant(workspaceId);
  const values = {
    workspaceId,
    personaName: input.personaName,
    firstMessage: input.firstMessage,
    systemPrompt: input.systemPrompt,
    knowledge: input.knowledge,
    voiceId: input.voiceId,
    model: input.model,
    maxDurationS: input.maxDurationS,
    structuredSchema: input.structuredFields,
    updatedAt: new Date(),
  };
  const [row] = existing
    ? await db.update(assistants).set(values).where(eq(assistants.id, existing.id)).returning()
    : await db.insert(assistants).values(values).returning();
  return row;
}

/** Defaults for a workspace with no assistant row yet. */
export function assistantDefaults(workspaceName: string) {
  return {
    personaName: `${workspaceName} Receptionist`,
    firstMessage: "How can I help you today?",
    systemPrompt: DEFAULT_PROMPT,
    knowledge: "",
    voiceId: "",
    model: "gpt-4o-mini",
    maxDurationS: 240,
    structuredSchema: defaultStructuredFields,
  };
}
