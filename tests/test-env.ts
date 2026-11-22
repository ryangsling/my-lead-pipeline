/** Fixed env for tests. Real secrets never enter the test run. */
export const testEnv = {
  APP_URL: "http://localhost:3000",
  DATABASE_URL: "postgres://unused:unused@localhost:1/unused",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "test-anon-key",
  ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  GOOGLE_CLIENT_ID: "test-client-id",
  GOOGLE_CLIENT_SECRET: "test-client-secret",
  CRON_SECRET: "test-cron-secret-0123456789",
  ADMIN_EMAILS: "admin@example.com",
  VAPI_VERIFIED_RECORDING_WORKSPACE_IDS: "",
};
