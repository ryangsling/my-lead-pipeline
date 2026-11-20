import { describe, expect, it } from "vitest";
import { missingNotice } from "@/lib/agent/store";

describe("missingNotice", () => {
  it("accepts a message naming the AI and the recording", () => {
    expect(missingNotice("Hi, I am Bloom's AI assistant. This call may be recorded.")).toBe(false);
    expect(missingNotice("Hello, this is an artificial intelligence. Calls are recorded.")).toBe(false);
  });

  it("rejects a message without both notices", () => {
    expect(missingNotice("Hi, how can I help you today?")).toBe(true);
    expect(missingNotice("Hi, I am an AI assistant.")).toBe(true);
    expect(missingNotice("This call may be recorded.")).toBe(true);
  });
});
