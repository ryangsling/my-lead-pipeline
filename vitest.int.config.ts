import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { testEnv } from "./tests/test-env";

// Local Docker database by default. Set TEST_DATABASE_URL to point elsewhere.
const databaseUrl =
  process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:54322/agenthub_test";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["tests/int/**/*.test.ts"],
    env: { ...testEnv, DATABASE_URL: databaseUrl },
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
