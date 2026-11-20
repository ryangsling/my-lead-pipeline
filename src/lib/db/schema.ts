import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const workspaceId = () =>
  uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" });

export const workspaces = pgTable(
  "workspaces",
  {
    id: id(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    niche: text("niche"),
    country: text("country").notNull().default("GB"),
    timezone: text("timezone").notNull().default("Europe/London"),
    phoneDisplay: text("phone_display"),
    businessInfo: jsonb("business_info").notNull().default({}),
    status: text("status").notNull().default("active"),
    vapiMode: text("vapi_mode").notNull().default("own"),
    webhookSecretEncrypted: text("webhook_secret_encrypted").notNull(),
    retentionDays: integer("retention_days").notNull().default(90),
    dailyCostAlertUsd: numeric("daily_cost_alert_usd", { precision: 10, scale: 2 }),
    demoVideoUrl: text("demo_video_url"),
    createdAt: createdAt(),
  },
  (t) => [
    check("workspaces_status_check", sql`${t.status} in ('active', 'archived')`),
    check("workspaces_vapi_mode_check", sql`${t.vapiMode} in ('pool', 'own')`),
  ],
);

export const integrations = pgTable(
  "integrations",
  {
    id: id(),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    credentialsEncrypted: text("credentials_encrypted"),
    config: jsonb("config").notNull().default({}),
    status: text("status").notNull().default("untested"),
    lastTestedAt: timestamp("last_tested_at", { withTimezone: true }),
    lastError: text("last_error"),
  },
  (t) => [unique("integrations_scope_provider").on(t.workspaceId, t.provider).nullsNotDistinct()],
);

export const vapiAccounts = pgTable(
  "vapi_accounts",
  {
    id: id(),
    label: text("label").notNull(),
    ownerName: text("owner_name").notNull(),
    credentialsEncrypted: text("credentials_encrypted").notNull(),
    budgetUsd: numeric("budget_usd", { precision: 10, scale: 2 }).notNull().default("10"),
    spentUsd: numeric("spent_usd", { precision: 10, scale: 2 }).notNull().default("0"),
    order: integer("order").notNull(),
    status: text("status").notNull().default("active"),
    phoneNumberId: text("phone_number_id"),
    lastError: text("last_error"),
    createdAt: createdAt(),
  },
  (t) => [check("vapi_accounts_status_check", sql`${t.status} in ('active', 'exhausted', 'disabled')`)],
);

export const assistants = pgTable("assistants", {
  id: id(),
  workspaceId: workspaceId(),
  personaName: text("persona_name").notNull(),
  firstMessage: text("first_message").notNull(),
  systemPrompt: text("system_prompt").notNull(),
  knowledge: text("knowledge").notNull().default(""),
  model: text("model").notNull().default("gpt-4o-mini"),
  voiceProvider: text("voice_provider").notNull().default("11labs"),
  voiceId: text("voice_id"),
  maxDurationS: integer("max_duration_s").notNull().default(240),
  structuredSchema: jsonb("structured_schema").notNull().default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const assistantSyncs = pgTable(
  "assistant_syncs",
  {
    id: id(),
    assistantId: uuid("assistant_id")
      .notNull()
      .references(() => assistants.id, { onDelete: "cascade" }),
    vapiAccountId: uuid("vapi_account_id").references(() => vapiAccounts.id, { onDelete: "cascade" }),
    vapiAssistantId: text("vapi_assistant_id"),
    vapiToolIds: jsonb("vapi_tool_ids").notNull().default([]),
    structuredOutputIds: jsonb("structured_output_ids").notNull().default([]),
    syncedAt: timestamp("synced_at", { withTimezone: true }),
    syncError: text("sync_error"),
  },
  (t) => [unique("assistant_syncs_pair").on(t.assistantId, t.vapiAccountId).nullsNotDistinct()],
);

export const phoneNumbers = pgTable("phone_numbers", {
  id: id(),
  workspaceId: workspaceId(),
  vapiPhoneNumberId: text("vapi_phone_number_id").notNull().unique(),
  e164: text("e164").notNull(),
  assistantId: uuid("assistant_id").references(() => assistants.id, { onDelete: "set null" }),
  vapiAccountId: uuid("vapi_account_id").references(() => vapiAccounts.id, { onDelete: "set null" }),
});

export const services = pgTable("services", {
  id: id(),
  workspaceId: workspaceId(),
  name: text("name").notNull(),
  durationMin: integer("duration_min").notNull(),
  bufferMin: integer("buffer_min").notNull().default(0),
  priceText: text("price_text"),
  active: boolean("active").notNull().default(true),
});

export const calendars = pgTable("calendars", {
  id: id(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .unique()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  googleCalendarId: text("google_calendar_id"),
  workingHours: jsonb("working_hours").notNull().default({}),
  slotStepMin: integer("slot_step_min").notNull().default(30),
  minNoticeHours: integer("min_notice_hours").notNull().default(2),
  maxDaysAhead: integer("max_days_ahead").notNull().default(30),
  busyCache: jsonb("busy_cache"),
  busyCachedAt: timestamp("busy_cached_at", { withTimezone: true }),
});

export const contacts = pgTable(
  "contacts",
  {
    id: id(),
    workspaceId: workspaceId(),
    name: text("name"),
    phoneE164: text("phone_e164"),
    email: text("email"),
    source: text("source"),
    tags: text("tags").array().notNull().default(sql`'{}'`),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (t) => [unique("contacts_workspace_phone").on(t.workspaceId, t.phoneE164)],
);

export const conversations = pgTable(
  "conversations",
  {
    id: id(),
    workspaceId: workspaceId(),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    channel: text("channel").notNull(),
    externalId: text("external_id"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    durationS: integer("duration_s"),
    costUsd: numeric("cost_usd", { precision: 10, scale: 4 }),
    summary: text("summary"),
    structured: jsonb("structured").notNull().default({}),
    recordingUrl: text("recording_url"),
    outcome: text("outcome"),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
    idleNotifiedAt: timestamp("idle_notified_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("conversations_workspace_external").on(t.workspaceId, t.externalId),
    check(
      "conversations_channel_check",
      sql`${t.channel} in ('phone', 'web_voice', 'chat', 'form')`,
    ),
  ],
);

export const appointments = pgTable(
  "appointments",
  {
    id: id(),
    workspaceId: workspaceId(),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    serviceId: uuid("service_id").references(() => services.id, { onDelete: "set null" }),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    blockedUntil: timestamp("blocked_until", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("booked"),
    googleEventId: text("google_event_id"),
    source: text("source").notNull(),
    conversationId: uuid("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    notes: text("notes"),
  },
  (t) => [
    check(
      "appointments_status_check",
      sql`${t.status} in ('requested', 'booked', 'confirmed', 'rescheduled', 'cancelled', 'no_show')`,
    ),
  ],
);

export const messages = pgTable("messages", {
  id: id(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull().default(""),
  toolName: text("tool_name"),
  createdAt: createdAt(),
});

export const notificationChannels = pgTable("notification_channels", {
  id: id(),
  workspaceId: workspaceId(),
  type: text("type").notNull(),
  target: text("target").notNull(),
  events: text("events").array().notNull().default(sql`'{}'`),
  active: boolean("active").notNull().default(true),
});

export const notificationLog = pgTable(
  "notification_log",
  {
    id: id(),
    workspaceId: workspaceId(),
    channelId: uuid("channel_id").references(() => notificationChannels.id, {
      onDelete: "set null",
    }),
    event: text("event").notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    dedupeKey: text("dedupe_key").notNull(),
    payload: jsonb("payload").notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [unique("notification_log_channel_dedupe").on(t.channelId, t.dedupeKey)],
);

export const embeds = pgTable("embeds", {
  id: id(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .unique()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  publicKey: text("public_key").notNull().unique(),
  allowedOrigins: text("allowed_origins").array().notNull().default(sql`'{}'`),
  voiceEnabled: boolean("voice_enabled").notNull().default(true),
  chatEnabled: boolean("chat_enabled").notNull().default(true),
  formEnabled: boolean("form_enabled").notNull().default(true),
  theme: jsonb("theme").notNull().default({}),
});

export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: id(),
    source: text("source").notNull(),
    eventType: text("event_type").notNull(),
    externalId: text("external_id").notNull(),
    raw: jsonb("raw").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    error: text("error"),
  },
  (t) => [unique("webhook_events_source_external").on(t.source, t.externalId)],
);

export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
);
