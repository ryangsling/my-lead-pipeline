import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { testEnv } from "./tests/test-env";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { include: ["tests/unit/**/*.test.ts"], env: testEnv },
});
