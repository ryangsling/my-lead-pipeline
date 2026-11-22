import { expect, it } from "vitest";
import { greeting } from "@/lib/vapi/assistant-config";

it("keeps the greeting once for older workspaces", () => {
  const text = "Hi, you're speaking with Bloom's AI assistant. This call may be recorded. Welcome!";
  const expected = "Hi, this is the AI assistant for Bloom. This call may be recorded. Welcome!";
  expect(greeting("Bloom", text)).toBe(expected);
  expect(greeting("Bloom", expected)).toBe(expected);
});
