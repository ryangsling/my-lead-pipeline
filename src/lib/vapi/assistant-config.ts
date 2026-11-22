import type { assistants } from "@/lib/db/schema";
import { env } from "@/lib/env";

export type AssistantConfigInput = Pick<
  typeof assistants.$inferSelect,
  "personaName" | "firstMessage" | "systemPrompt" | "knowledge" | "model" | "voiceId" | "maxDurationS"
> & { businessName: string; recordingEnabled: boolean };

const recordedNotice = "This call is being recorded.";
export const unrecordedNotice = "This call will continue without an audio recording.";
export const disabledCapture = { recordingEnabled: false, videoRecordingEnabled: false, pcapEnabled: false };
export const disabledMonitoring = { listenEnabled: false, controlEnabled: false };

export function greeting(businessName: string, text: string, recordingEnabled = false) {
  const disclosure = `Hi, this is the AI assistant for ${businessName}.`;
  const legacy = `Hi, you're speaking with ${businessName}'s AI assistant.`;
  const opening = text.trim().replace(/^This call is being recorded\.\s*/i, "");
  const prefix = [disclosure, legacy, "Hi, I am the AI assistant.", "Hi, I am an AI assistant."]
    .find((value) => opening.startsWith(value));
  const continuation = opening.slice(prefix?.length ?? 0)
    .replace(/\bThis call (?:may be recorded|is being recorded|will continue without an audio recording)\.\s*/gi, "")
    .trim();
  const firstMessage = [disclosure, recordingEnabled ? "" : unrecordedNotice, continuation].filter(Boolean).join(" ");
  return recordingEnabled ? `${recordedNotice}\n${firstMessage}` : firstMessage;
}

export function verbalRecordingPlan(businessName: string) {
  return {
    type: "verbal" as const,
    firstMessageMode: "assistant-speaks-first" as const,
    message: `Hi, this is the AI assistant for ${businessName}. May we record this call? Please say yes or no.`,
    declineTool: {
      type: "endCall" as const,
      messages: [{
        type: "request-start" as const,
        blocking: true,
        content: "Please use the business's website for another way to get in touch. Goodbye.",
      }],
    },
  };
}

export function assistantRecordingConfig({ businessName, firstMessage, recordingEnabled }: AssistantConfigInput) {
  return {
    firstMessage: greeting(businessName, firstMessage, recordingEnabled),
    firstMessageMode: "assistant-speaks-first",
    firstMessageInterruptionsEnabled: false,
    artifactPlan: { ...disabledCapture, recordingEnabled },
    compliancePlan: recordingEnabled ? { recordingConsentPlan: verbalRecordingPlan(businessName) } : {},
    monitorPlan: disabledMonitoring,
  };
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
  const recording = assistantRecordingConfig(assistant);
  const appUrl = env.APP_URL.replace(/\/+$/, "");
  const systemPrompt = [
    assistant.systemPrompt,
    assistant.knowledge.trim() && `Business knowledge:\n${assistant.knowledge}`,
    `Identify yourself as an AI assistant. ${assistant.recordingEnabled ? recordedNotice : unrecordedNotice}`,
  ].filter(Boolean).join("\n\n");

  return {
    name: assistant.personaName,
    ...recording,
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
    artifactPlan: { ...recording.artifactPlan, structuredOutputIds },
    analysisPlan: { summaryPlan: { enabled: true, timeoutSeconds: 20 } },
  };
}
