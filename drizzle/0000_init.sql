CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"contact_id" uuid,
	"service_id" uuid,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"blocked_until" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'booked' NOT NULL,
	"google_event_id" text,
	"source" text NOT NULL,
	"conversation_id" uuid,
	"notes" text,
	CONSTRAINT "appointments_status_check" CHECK ("appointments"."status" in ('requested', 'booked', 'confirmed', 'rescheduled', 'cancelled', 'no_show'))
);
--> statement-breakpoint
CREATE TABLE "assistant_syncs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assistant_id" uuid NOT NULL,
	"vapi_account_id" uuid NOT NULL,
	"vapi_assistant_id" text,
	"vapi_tool_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"structured_output_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"synced_at" timestamp with time zone,
	"sync_error" text,
	CONSTRAINT "assistant_syncs_pair" UNIQUE("assistant_id","vapi_account_id")
);
--> statement-breakpoint
CREATE TABLE "assistants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"persona_name" text NOT NULL,
	"first_message" text NOT NULL,
	"system_prompt" text NOT NULL,
	"knowledge" text DEFAULT '' NOT NULL,
	"model" text DEFAULT 'gpt-4o-mini' NOT NULL,
	"voice_provider" text DEFAULT '11labs' NOT NULL,
	"voice_id" text,
	"max_duration_s" integer DEFAULT 240 NOT NULL,
	"structured_schema" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"google_calendar_id" text,
	"working_hours" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"slot_step_min" integer DEFAULT 30 NOT NULL,
	"min_notice_hours" integer DEFAULT 2 NOT NULL,
	"max_days_ahead" integer DEFAULT 30 NOT NULL,
	"busy_cache" jsonb,
	"busy_cached_at" timestamp with time zone,
	CONSTRAINT "calendars_workspace_id_unique" UNIQUE("workspace_id")
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text,
	"phone_e164" text,
	"email" text,
	"source" text,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contacts_workspace_phone" UNIQUE("workspace_id","phone_e164")
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"contact_id" uuid,
	"channel" text NOT NULL,
	"external_id" text,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"duration_s" integer,
	"cost_usd" numeric(10, 4),
	"summary" text,
	"structured" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"recording_url" text,
	"outcome" text,
	"last_activity_at" timestamp with time zone,
	"idle_notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_workspace_external" UNIQUE("workspace_id","external_id"),
	CONSTRAINT "conversations_channel_check" CHECK ("conversations"."channel" in ('phone', 'web_voice', 'chat', 'form'))
);
--> statement-breakpoint
CREATE TABLE "embeds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"public_key" text NOT NULL,
	"allowed_origins" text[] DEFAULT '{}' NOT NULL,
	"voice_enabled" boolean DEFAULT true NOT NULL,
	"chat_enabled" boolean DEFAULT true NOT NULL,
	"form_enabled" boolean DEFAULT true NOT NULL,
	"theme" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "embeds_workspace_id_unique" UNIQUE("workspace_id"),
	CONSTRAINT "embeds_public_key_unique" UNIQUE("public_key")
);
--> statement-breakpoint
CREATE TABLE "integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"provider" text NOT NULL,
	"credentials_encrypted" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'untested' NOT NULL,
	"last_tested_at" timestamp with time zone,
	"last_error" text,
	CONSTRAINT "integrations_scope_provider" UNIQUE NULLS NOT DISTINCT("workspace_id","provider")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"tool_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"type" text NOT NULL,
	"target" text NOT NULL,
	"events" text[] DEFAULT '{}' NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"channel_id" uuid,
	"event" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"sent_at" timestamp with time zone,
	"dedupe_key" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_log_channel_dedupe" UNIQUE("channel_id","dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "phone_numbers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"vapi_phone_number_id" text NOT NULL,
	"e164" text NOT NULL,
	"assistant_id" uuid,
	"vapi_account_id" uuid,
	CONSTRAINT "phone_numbers_vapi_phone_number_id_unique" UNIQUE("vapi_phone_number_id")
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limits_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"duration_min" integer NOT NULL,
	"buffer_min" integer DEFAULT 0 NOT NULL,
	"price_text" text,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vapi_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"owner_name" text NOT NULL,
	"credentials_encrypted" text NOT NULL,
	"budget_usd" numeric(10, 2) DEFAULT '10' NOT NULL,
	"spent_usd" numeric(10, 2) DEFAULT '0' NOT NULL,
	"order" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"phone_number_id" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vapi_accounts_status_check" CHECK ("vapi_accounts"."status" in ('active', 'exhausted', 'disabled'))
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"event_type" text NOT NULL,
	"external_id" text NOT NULL,
	"raw" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text,
	CONSTRAINT "webhook_events_source_external" UNIQUE("source","external_id")
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"niche" text,
	"country" text DEFAULT 'GB' NOT NULL,
	"timezone" text DEFAULT 'Europe/London' NOT NULL,
	"phone_display" text,
	"business_info" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"vapi_mode" text DEFAULT 'own' NOT NULL,
	"webhook_secret_encrypted" text NOT NULL,
	"retention_days" integer DEFAULT 90 NOT NULL,
	"daily_cost_alert_usd" numeric(10, 2),
	"demo_video_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspaces_slug_unique" UNIQUE("slug"),
	CONSTRAINT "workspaces_status_check" CHECK ("workspaces"."status" in ('active', 'archived')),
	CONSTRAINT "workspaces_vapi_mode_check" CHECK ("workspaces"."vapi_mode" in ('pool', 'own'))
);
--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_syncs" ADD CONSTRAINT "assistant_syncs_assistant_id_assistants_id_fk" FOREIGN KEY ("assistant_id") REFERENCES "public"."assistants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_syncs" ADD CONSTRAINT "assistant_syncs_vapi_account_id_vapi_accounts_id_fk" FOREIGN KEY ("vapi_account_id") REFERENCES "public"."vapi_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistants" ADD CONSTRAINT "assistants_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendars" ADD CONSTRAINT "calendars_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "embeds" ADD CONSTRAINT "embeds_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_channels" ADD CONSTRAINT "notification_channels_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_channel_id_notification_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."notification_channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phone_numbers" ADD CONSTRAINT "phone_numbers_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phone_numbers" ADD CONSTRAINT "phone_numbers_assistant_id_assistants_id_fk" FOREIGN KEY ("assistant_id") REFERENCES "public"."assistants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phone_numbers" ADD CONSTRAINT "phone_numbers_vapi_account_id_vapi_accounts_id_fk" FOREIGN KEY ("vapi_account_id") REFERENCES "public"."vapi_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;