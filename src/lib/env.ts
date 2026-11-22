import { z } from "zod";

const schema = z.object({
  APP_URL: z.url(),
  DATABASE_URL: z.string().min(1),
  MIGRATE_DATABASE_URL: z.string().min(1).optional(),
  TEST_DATABASE_URL: z.string().min(1).optional(),
  SUPABASE_URL: z.url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  ENCRYPTION_KEY: z
    .string()
    .refine((k) => Buffer.from(k, "base64").length === 32, "must be 32 bytes, base64 encoded"),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  CRON_SECRET: z.string().min(16),
  PUBLIC_BOOKING_TRUSTED_IP_HEADER: z.enum(["x-vercel-forwarded-for", "cf-connecting-ip", "x-public-booking-client-ip"]).optional(),
  VAPI_VERIFIED_RECORDING_WORKSPACE_IDS: z.string().optional(),
  ADMIN_EMAILS: z.string().min(1),
  CHAT_TRUSTED_IP_HEADER: z.enum(["x-vercel-forwarded-for", "cf-connecting-ip", "x-chat-client-ip"]).optional(),
});

/** Validated server environment. Throws at import time, naming the bad variables. */
export const env = schema.parse(process.env);
