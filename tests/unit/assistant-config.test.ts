import { describe, expect, it } from "vitest";
import { buildAssistantConfig } from "@/lib/vapi/assistant-config";

const assistant = {
  businessName: "Bloom Salon",
  recordingEnabled: true,
  personaName: "Bloom Receptionist",
  firstMessage: "Welcome.",
  systemPrompt: "You are the receptionist for Bloom Salon.",
  knowledge: "",
  model: "gpt-4o-mini",
  voiceId: "voice_123",
  maxDurationS: 240,
  structuredSchema: [],
};

describe("buildAssistantConfig", () => {
  it("matches the Vapi contract", () => {
    const config = buildAssistantConfig(assistant, ["tool_1", "tool_2", "tool_3"], ["out_1"], "secret");
    expect(config).toMatchSnapshot();
  });

  it("discloses AI and uses no consent prompt when recording is disabled", () => {
    const config = buildAssistantConfig({ ...assistant, recordingEnabled: false, firstMessage: "How can I help?" }, [], [], "s");
    expect(config.firstMessage).toBe("Hi, this is the AI assistant for Bloom Salon. This call will continue without an audio recording. How can I help?");
    expect(config.artifactPlan.recordingEnabled).toBe(false);
    expect(config.compliancePlan.recordingConsentPlan).toBeUndefined();
  });

  it("sets an explicit provider consent prompt and a fixed first line after consent", () => {
    const config = buildAssistantConfig(assistant, [], [], "s");
    expect(config.firstMessage.split("\n")[0]).toBe("This call is being recorded.");
    expect(config.compliancePlan.recordingConsentPlan).toMatchObject({
      type: "verbal",
      firstMessageMode: "assistant-speaks-first",
      message: "Hi, this is the AI assistant for Bloom Salon. May we record this call? Please say yes or no.",
      declineTool: { type: "endCall", messages: [{ type: "request-start", blocking: true }] },
    });
  });

  it("appends knowledge to the system prompt", () => {
    const config = buildAssistantConfig({ ...assistant, knowledge: "We are closed on Sundays." }, [], [], "s");
    expect(config.model.messages[0].content).toContain("We are closed on Sundays.");
  });

  it("refuses to build without a voice id", () => {
    expect(() => buildAssistantConfig({ ...assistant, voiceId: null }, [], [], "s")).toThrow(/voice id/i);
  });
});

it("registers a server-resolved transfer only when enabled", () => {
  expect(buildAssistantConfig(assistant, [], [], "s").model.tools).toBeUndefined();
  expect(buildAssistantConfig(assistant, [], [], "s", true).model.tools).toEqual([
    { type: "transferCall", server: { url: "http://localhost:3000/api/vapi/webhook", headers: { "x-vapi-secret": "s" } } },
  ]);
});
