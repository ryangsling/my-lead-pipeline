import { describe, expect, it } from "vitest";
import { buildAssistantConfig } from "@/lib/vapi/assistant-config";

const assistant = {
  personaName: "Bloom Receptionist",
  firstMessage: "Hi, I am Bloom's AI assistant. This call may be recorded.",
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

  it("appends knowledge to the system prompt", () => {
    const config = buildAssistantConfig({ ...assistant, knowledge: "We are closed on Sundays." }, [], [], "s");
    expect(config.model.messages[0].content).toContain("We are closed on Sundays.");
  });

  it("refuses to build without a voice id", () => {
    expect(() => buildAssistantConfig({ ...assistant, voiceId: null }, [], [], "s")).toThrow(/voice id/i);
  });
});
