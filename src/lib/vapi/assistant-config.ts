import type { assistants } from "@/lib/db/schema";
import { env } from "@/lib/env";

export type AssistantConfigInput = Pick<
  typeof assistants.$inferSelect,
  "personaName" | "firstMessage" | "systemPrompt" | "knowledge" | "model" | "voiceId" | "maxDurationS"
> & { businessName: string; recordingEnabled: boolean };

export function greeting(businessName: string, text: string) {
  const notice = `Hi, this is the AI assistant for ${businessName}. This call may be recorded.`;
  const legacy = `Hi, you're speaking with ${businessName}'s AI assistant. This call may be recorded.`;
  const prefix = [notice, legacy].find((value) => text.startsWith(value));
  return [notice, text.slice(prefix?.length ?? 0).trim()].filter(Boolean).join(" ");
}

/** The assistant body sent to Vapi. The system prompt is already rendered. */
export function buildAssistantConfig(
  assistant: AssistantConfigInput,
  toolIds: string[],
  structuredOutputIds: string[],
  webhookSecret: string,
  transferEnabled = false,
) {
  if (!assistant.voiceId) throw new Error("Add the ElevenLabs voice id before syncing.");
  const appUrl = env.APP_URL.replace(/\/+$/, "");
  const systemPrompt = assistant.knowledge.trim()
    ? `${assistant.systemPrompt}\n\nBusiness knowledge:\n${assistant.knowledge}`
    : assistant.systemPrompt;

  return {
    name: assistant.personaName,
    firstMessage: greeting(assistant.businessName, assistant.firstMessage),
    firstMessageMode: "assistant-speaks-first",
    model: {
      provider: "openai",
      model: assistant.model,
      messages: [{ role: "system", content: systemPrompt }],
      toolIds,
      ...(transferEnabled ? { tools: [{ type: "transferCall", server: {
        url: `${appUrl}/api/vapi/webhook`, headers: { "x-vapi-secret": webhookSecret },
      } }] } : {}),
    },
    voice: { provider: "11labs", voiceId: assistant.voiceId, model: "eleven_flash_v2_5" },
    server: {
      url: `${appUrl}/api/vapi/webhook`,
      headers: { "x-vapi-secret": webhookSecret },
    },
    maxDurationSeconds: assistant.maxDurationS,
    artifactPlan: { recordingEnabled: assistant.recordingEnabled, structuredOutputIds },
    analysisPlan: { summaryPlan: { enabled: true, timeoutSeconds: 20 } },
  };
}
