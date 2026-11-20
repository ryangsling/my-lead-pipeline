import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  webServer: { command: "pnpm dev", url: "http://localhost:3000/login", reuseExistingServer: true },
  use: { baseURL: process.env.APP_URL ?? "http://localhost:3000" },
});
