import { describe, expect, it } from "vitest";
import { decrypt, encrypt, mask } from "@/lib/crypto";

describe("crypto", () => {
  it("round-trips a secret", () => {
    expect(decrypt(encrypt("sk-live-abc123"))).toBe("sk-live-abc123");
  });

  it("rejects a tampered blob", () => {
    const [iv, tag, data] = encrypt("sk-live-abc123").split(".");
    const flipped = Buffer.from(data, "base64");
    flipped[0] ^= 0xff;
    expect(() => decrypt([iv, tag, flipped.toString("base64")].join("."))).toThrow();
  });

  it("masks all but the last 4 characters", () => {
    expect(mask("sk-live-abc123")).toBe("****c123");
    expect(mask("abc")).toBe("****");
  });
});
