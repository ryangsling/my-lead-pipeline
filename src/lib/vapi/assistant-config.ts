import type { assistants } from "@/lib/db/schema";
import { env } from "@/lib/env";

export type AssistantConfigInput = Pick<
  typeof assistants.$inferSelect,
  "personaName" | "firstMessage" | "systemPrompt" | "knowledge" | "model" | "voiceId" | "maxDurationS"
>;

/** The assistant body sent to Vapi. The system prompt is already rendered. */
export function buildAssistantConfig(
  assistant: AssistantConfigInput,
  toolIds: string[],
  structuredOutputIds: string[],
  webhookSecret: string,
) {
  if (!assistant.voiceId) throw new Error("Add the ElevenLabs voice id before syncing.");
  const appUrl = env.APP_URL.replace(/\/+$/, "");
  const systemPrompt = assistant.knowledge.trim()
    ? `${assistant.systemPrompt}\n\nBusiness knowledge:\n${assistant.knowledge}`
    : assistant.systemPrompt;

  return {
    name: assistant.personaName,
    firstMessage: assistant.firstMessage,
    firstMessageMode: "assistant-speaks-first",
    model: {
      provider: "openai",
      model: assistant.model,
      messages: [{ role: "system", content: systemPrompt }],
      toolIds,
    },
    voice: { provider: "11labs", voiceId: assistant.voiceId, model: "eleven_flash_v2_5" },
    server: {
      url: `${appUrl}/api/vapi/webhook`,
      headers: { "x-vapi-secret": webhookSecret },
    },
    maxDurationSeconds: assistant.maxDurationS,
    artifactPlan: { recordingEnabled: true, structuredOutputIds },
    analysisPlan: { summaryPlan: { enabled: true, timeoutSeconds: 20 } },
  };
}
