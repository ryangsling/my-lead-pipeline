import type { JobIntake } from "@/lib/crm/jobs";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
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
    logoUrl: text("logo_url"),
    accentColor: text("accent_color"),
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
    recordingEnabled: boolean("recording_enabled").notNull().default(false),
    transferEnabled: boolean("transfer_enabled").notNull().default(false),
    callbackMinutes: integer("callback_minutes").notNull().default(15),
    onCallNumber: text("on_call_number").notNull().default(""),
    backupNumber: text("backup_number").notNull().default(""),
    escalationTriggers: text("escalation_triggers").notNull().default(""),
    serviceZips: text("service_zips").array().notNull().default(sql`'{}'`),
    serviceCities: text("service_cities").array().notNull().default(sql`'{}'`),
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
}, (t) => [unique("assistants_workspace_id").on(t.workspaceId, t.id)]);

export type SyncResourceCheckpoint = { marker: string; startedAt: string; remoteId: string | null };

export const assistantSyncs = pgTable(
  "assistant_syncs",
  {
    id: id(),
    workspaceId: workspaceId(),
    assistantId: uuid("assistant_id").notNull(),
    vapiAccountId: uuid("vapi_account_id").references(() => vapiAccounts.id, { onDelete: "cascade" }),
    vapiAssistantId: text("vapi_assistant_id"),
    vapiToolIds: jsonb("vapi_tool_ids").notNull().default([]),
    structuredOutputIds: jsonb("structured_output_ids").notNull().default([]),
    desiredConfigHash: text("desired_config_hash"),
    appliedConfigHash: text("applied_config_hash"),
    resourceCheckpoints: jsonb("resource_checkpoints").$type<Record<string, SyncResourceCheckpoint>>().notNull().default({}),
    replacementVapiAssistantId: text("replacement_vapi_assistant_id"),
    syncLeaseId: uuid("sync_lease_id"),
    syncLeaseUntil: timestamp("sync_lease_until", { withTimezone: true }),
    syncedAt: timestamp("synced_at", { withTimezone: true }),
    syncError: text("sync_error"),
  },
  (t) => [
    unique("assistant_syncs_pair").on(t.workspaceId, t.assistantId, t.vapiAccountId).nullsNotDistinct(),
    foreignKey({
      name: "assistant_syncs_workspace_assistant_fk",
      columns: [t.workspaceId, t.assistantId],
      foreignColumns: [assistants.workspaceId, assistants.id],
    }).onDelete("cascade"),
  ],
);

export const phoneNumbers = pgTable("phone_numbers", {
  id: id(),
  workspaceId: workspaceId(),
  vapiPhoneNumberId: text("vapi_phone_number_id").notNull().unique(),
  e164: text("e164").notNull(),
  assistantId: uuid("assistant_id"),
  vapiAccountId: uuid("vapi_account_id").references(() => vapiAccounts.id, { onDelete: "set null" }),
}, (t) => [
  // Migration SQL applies SET NULL only to the child ID of nullable composite links.
  foreignKey({
    name: "phone_numbers_workspace_assistant_fk",
    columns: [t.workspaceId, t.assistantId],
    foreignColumns: [assistants.workspaceId, assistants.id],
  }).onDelete("set null"),
]);

export const phoneNumberChanges = pgTable("phone_number_changes", {
  id: id(),
  workspaceId: workspaceId(),
  sourceWorkspaceId: uuid("source_workspace_id"),
  vapiPhoneNumberId: text("vapi_phone_number_id").notNull(),
  replacedVapiPhoneNumberId: text("replaced_vapi_phone_number_id"),
  // The number can still belong to the source workspace or have no local row during reservation.
  phoneNumberId: uuid("phone_number_id").notNull(),
  assistantId: uuid("assistant_id").notNull(),
  vapiAssistantId: text("vapi_assistant_id").notNull(),
  expectedVapiAssistantId: text("expected_vapi_assistant_id"),
  e164: text("e164"),
  status: text("status", { enum: ["pending", "applying", "completed", "rejected"] }).notNull().default("pending"),
  error: text("error"),
  reconcileAt: timestamp("reconcile_at", { withTimezone: true }).defaultNow(),
}, (t) => [
  foreignKey({
    name: "phone_number_changes_workspace_assistant_fk",
    columns: [t.workspaceId, t.assistantId],
    foreignColumns: [assistants.workspaceId, assistants.id],
  }),
  check("phone_number_changes_status_check", sql`${t.status} in ('pending', 'applying', 'completed', 'rejected')`),
  index("phone_number_changes_reconcile_at_idx").on(t.reconcileAt).where(sql`${t.reconcileAt} is not null`),
]).enableRLS();

export const services = pgTable("services", {
  id: id(),
  workspaceId: workspaceId(),
  name: text("name").notNull(),
  visitKind: text("visit_kind", { enum: ["standard", "estimate"] }).notNull().default("standard"),
  durationMin: integer("duration_min").notNull(),
  bufferMin: integer("buffer_min").notNull().default(0),
  priceText: text("price_text"),
  active: boolean("active").notNull().default(true),
}, (t) => [unique("services_workspace_id").on(t.workspaceId, t.id)]);

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
  publicBookingRequestOnly: boolean("public_booking_request_only").notNull().default(false),
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
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  },
  (t) => [
    unique("contacts_workspace_id").on(t.workspaceId, t.id),
    unique("contacts_workspace_phone").on(t.workspaceId, t.phoneE164),
  ],
);

export const conversations = pgTable(
  "conversations",
  {
    id: id(),
    workspaceId: workspaceId(),
    contactId: uuid("contact_id"),
    channel: text("channel").notNull(),
    externalId: text("external_id"),
    vapiAssistantId: text("vapi_assistant_id"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    durationS: integer("duration_s"),
    costUsd: numeric("cost_usd", { precision: 10, scale: 4 }),
    summary: text("summary"),
    structured: jsonb("structured").notNull().default({}),
    recordingUrl: text("recording_url"),
    recordingConsentAt: timestamp("recording_consent_at", { withTimezone: true }),
    outcome: text("outcome"),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
    idleNotifiedAt: timestamp("idle_notified_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("conversations_workspace_id").on(t.workspaceId, t.id),
    unique("conversations_workspace_external").on(t.workspaceId, t.externalId),
    foreignKey({
      name: "conversations_workspace_contact_fk",
      columns: [t.workspaceId, t.contactId],
      foreignColumns: [contacts.workspaceId, contacts.id],
    }).onDelete("set null"),
    check(
      "conversations_channel_check",
      sql`${t.channel} in ('phone', 'web_voice', 'chat', 'form')`,
    ),
  ],
);

export type CalendarOperation = {
  id: string;
  kind: "create" | "move" | "remove";
  phase: "apply" | "undo";
  previousStatus: string | null;
  nextStatus: string;
  timezone: string;
  summary?: string;
  description?: string;
  intake?: JobIntake;
  publicContact?: { name: string; phone: string; email?: string };
};

export const appointments = pgTable(
  "appointments",
  {
    id: id(),
    workspaceId: workspaceId(),
    contactId: uuid("contact_id"),
    serviceId: uuid("service_id"),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    blockedUntil: timestamp("blocked_until", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("booked"),
    googleEventId: text("google_event_id"),
    googleCalendarId: text("google_calendar_id"),
    calendarOperation: jsonb("calendar_operation").$type<CalendarOperation>(),
    targetStart: timestamp("target_start", { withTimezone: true }),
    targetEnd: timestamp("target_end", { withTimezone: true }),
    targetBlockedUntil: timestamp("target_blocked_until", { withTimezone: true }),
    reconcileAt: timestamp("reconcile_at", { withTimezone: true }),
    source: text("source").notNull(),
    conversationId: uuid("conversation_id"),
    notes: text("notes"),
    createdAt: createdAt(),
    piiErasedAt: timestamp("pii_erased_at", { withTimezone: true }),
  },
  (t) => [
    unique("appointments_workspace_id").on(t.workspaceId, t.id),
    foreignKey({
      name: "appointments_workspace_contact_fk",
      columns: [t.workspaceId, t.contactId],
      foreignColumns: [contacts.workspaceId, contacts.id],
    }).onDelete("set null"),
    foreignKey({
      name: "appointments_workspace_service_fk",
      columns: [t.workspaceId, t.serviceId],
      foreignColumns: [services.workspaceId, services.id],
    }).onDelete("set null"),
    foreignKey({
      name: "appointments_workspace_conversation_fk",
      columns: [t.workspaceId, t.conversationId],
      foreignColumns: [conversations.workspaceId, conversations.id],
    }).onDelete("set null"),
    check(
      "appointments_status_check",
      sql`${t.status} in ('pending', 'needs_review', 'requested', 'booked', 'confirmed', 'rescheduled', 'cancelled', 'no_show')`,
    ),
  ],
);

export const messages = pgTable("messages", {
  id: id(),
  workspaceId: workspaceId(),
  conversationId: uuid("conversation_id").notNull(),
  role: text("role").notNull(),
  content: text("content").notNull().default(""),
  toolName: text("tool_name"),
  createdAt: createdAt(),
}, (t) => [
  foreignKey({
    name: "messages_workspace_conversation_fk",
    columns: [t.workspaceId, t.conversationId],
    foreignColumns: [conversations.workspaceId, conversations.id],
  }).onDelete("cascade"),
  index("messages_workspace_conversation_created_idx").on(t.workspaceId, t.conversationId, t.createdAt),
]);

export const notificationChannels = pgTable("notification_channels", {
  id: id(),
  workspaceId: workspaceId(),
  type: text("type").notNull(),
  target: text("target").notNull(),
  events: text("events").array().notNull().default(sql`'{}'`),
  active: boolean("active").notNull().default(true),
}, (t) => [unique("notification_channels_workspace_id").on(t.workspaceId, t.id)]);

export const notificationLog = pgTable(
  "notification_log",
  {
    id: id(),
    workspaceId: workspaceId(),
    channelId: uuid("channel_id"),
    event: text("event").notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).defaultNow(),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    firstAttemptAt: timestamp("first_attempt_at", { withTimezone: true }),
    transport: text("transport", { enum: ["resend", "telegram", "smtp"] }),
    transportFingerprint: text("transport_fingerprint"),
    uncertainAttempt: boolean("uncertain_attempt").notNull().default(false),
    urgentConversationId: uuid("urgent_conversation_id"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    dedupeKey: text("dedupe_key").notNull(),
    payload: jsonb("payload").notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    unique("notification_log_channel_dedupe").on(t.workspaceId, t.channelId, t.dedupeKey),
    foreignKey({
      name: "notification_log_workspace_channel_fk",
      columns: [t.workspaceId, t.channelId],
      foreignColumns: [notificationChannels.workspaceId, notificationChannels.id],
    }).onDelete("set null"),
    foreignKey({
      name: "notification_log_workspace_urgent_conversation_fk",
      columns: [t.workspaceId, t.urgentConversationId],
      foreignColumns: [conversations.workspaceId, conversations.id],
    }).onDelete("cascade"),
    index("notification_log_due").on(t.nextAttemptAt).where(sql`${t.status} in ('pending', 'retryable')`),
    index("notification_log_leases").on(t.leaseUntil).where(sql`${t.status} = 'processing'`),
  ],
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
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    externalId: text("external_id").notNull(),
    callId: text("call_id"),
    vapiAssistantId: text("vapi_assistant_id"),
    raw: jsonb("raw").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    status: text("status", { enum: ["unscoped", "pending", "processing", "succeeded", "retryable", "invalid"] }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).defaultNow(),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    error: text("error"),
  },
  (t) => [
    unique("webhook_events_workspace_source_external").on(t.workspaceId, t.source, t.externalId),
    check("webhook_events_workspace_status_check", sql`(${t.workspaceId} is null) = (${t.status} = 'unscoped')`),
    index("webhook_events_due").on(t.nextAttemptAt).where(sql`${t.status} in ('pending', 'retryable')`),
    index("webhook_events_leases").on(t.leaseUntil).where(sql`${t.status} = 'processing'`),
    index("webhook_events_workspace_call").on(t.workspaceId, t.callId),
  ],
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

export const toolReceipts = pgTable("tool_receipts", {
  workspaceId: workspaceId(),
  callId: text("call_id").notNull(),
  toolCallId: text("tool_call_id").notNull(),
  name: text("name").notNull(),
  result: text("result"),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.workspaceId, t.callId, t.toolCallId] })]);

export const offeredSlots = pgTable("offered_slots", {
  id: id(),
  workspaceId: workspaceId(),
  conversationId: uuid("conversation_id").notNull(),
  serviceId: uuid("service_id").notNull(),
  start: timestamp("start_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (t) => [
  foreignKey({
    name: "offered_slots_workspace_conversation_fk",
    columns: [t.workspaceId, t.conversationId],
    foreignColumns: [conversations.workspaceId, conversations.id],
  }).onDelete("cascade"),
  foreignKey({
    name: "offered_slots_workspace_service_fk",
    columns: [t.workspaceId, t.serviceId],
    foreignColumns: [services.workspaceId, services.id],
  }).onDelete("cascade"),
]);

export const jobs = pgTable("jobs", {
  id: id(),
  workspaceId: workspaceId(),
  contactId: uuid("contact_id"),
  conversationId: uuid("conversation_id"),
  appointmentId: uuid("appointment_id"),
  address: text("address"),
  zip: text("zip"),
  city: text("city"),
  jobType: text("job_type"),
  problem: text("problem"),
  urgency: text("urgency"),
  callbackWindow: text("callback_window"),
  timezone: text("timezone").notNull(),
  leadSource: text("lead_source", { enum: ["google", "referral", "yard_sign", "other"] }),
  createdAt: createdAt(),
}, (t) => [
  unique("jobs_workspace_conversation").on(t.workspaceId, t.conversationId),
  unique("jobs_workspace_appointment").on(t.workspaceId, t.appointmentId),
  foreignKey({
    name: "jobs_workspace_contact_fk",
    columns: [t.workspaceId, t.contactId],
    foreignColumns: [contacts.workspaceId, contacts.id],
  }).onDelete("set null"),
  foreignKey({
    name: "jobs_workspace_conversation_fk",
    columns: [t.workspaceId, t.conversationId],
    foreignColumns: [conversations.workspaceId, conversations.id],
  }).onDelete("set null"),
  foreignKey({
    name: "jobs_workspace_appointment_fk",
    columns: [t.workspaceId, t.appointmentId],
    foreignColumns: [appointments.workspaceId, appointments.id],
  }).onDelete("set null"),
]);

export const urgentEvents = pgTable("urgent_events", {
  workspaceId: workspaceId(),
  conversationId: uuid("conversation_id").notNull(),
  sent: boolean("sent").notNull().default(false),
  deadlineAt: timestamp("deadline_at", { withTimezone: true }),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  deadlineMissedAt: timestamp("deadline_missed_at", { withTimezone: true }),
  escalatedAt: timestamp("escalated_at", { withTimezone: true }),
  payload: jsonb("payload").notNull().default({}),
  createdAt: createdAt(),
}, (t) => [
  primaryKey({ columns: [t.workspaceId, t.conversationId] }),
  foreignKey({
    name: "urgent_events_workspace_conversation_fk",
    columns: [t.workspaceId, t.conversationId],
    foreignColumns: [conversations.workspaceId, conversations.id],
  }).onDelete("cascade"),
  index("urgent_events_deadline").on(t.deadlineAt).where(sql`${t.deadlineMissedAt} is null`),
]);

export const deletionLog = pgTable("deletion_log", {
  id: id(),
  workspaceId: workspaceId(),
  requestId: uuid("request_id"),
  kind: text("kind", { enum: ["local", "vapi", "google"] }).notNull(),
  subjectKey: text("subject_key").notNull(),
  reason: text("reason", { enum: ["retention", "contact_request"] }).notNull(),
  status: text("status", { enum: ["pending", "processing", "retryable", "verified", "manual"] }).notNull(),
  // Encrypted provider locators are kept while verification is outstanding.
  targetEncrypted: text("target_encrypted"),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  errorCode: text("error_code"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [
  unique("deletion_log_workspace_id").on(t.workspaceId, t.id),
  unique("deletion_log_workspace_kind_subject").on(t.workspaceId, t.kind, t.subjectKey),
  foreignKey({
    name: "deletion_log_workspace_request_fk", columns: [t.workspaceId, t.requestId], foreignColumns: [t.workspaceId, t.id],
  }).onDelete("cascade"),
  check("deletion_log_request_check", sql`(${t.kind} = 'local') = (${t.requestId} is null)`),
  index("deletion_log_due").on(t.nextAttemptAt).where(sql`${t.nextAttemptAt} is not null`),
  index("deletion_log_leases").on(t.leaseUntil).where(sql`${t.leaseUntil} is not null`),
]).enableRLS();
