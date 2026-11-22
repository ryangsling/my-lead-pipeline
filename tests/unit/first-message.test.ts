import { expect, it } from "vitest";
import { greeting } from "@/lib/vapi/assistant-config";

it("keeps the greeting once for older workspaces", () => {
  const text = "Hi, you're speaking with Bloom's AI assistant. This call may be recorded. Welcome!";
  const expected = "Hi, this is the AI assistant for Bloom. This call will continue without an audio recording. Welcome!";
  expect(greeting("Bloom", text)).toBe(expected);
  expect(greeting("Bloom", expected)).toBe(expected);
});

it("keeps the fixed recording notice above a custom greeting", () => {
  const text = "Welcome! Can I look up your service record?";
  expect(greeting("Bloom", text, true)).toBe(`This call is being recorded.\nHi, this is the AI assistant for Bloom. ${text}`);
});
