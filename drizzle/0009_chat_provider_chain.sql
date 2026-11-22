CREATE TABLE "chat_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"name" text NOT NULL,
	"base_url" text NOT NULL,
	"model" text NOT NULL,
	"api_key_encrypted" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"tool_capable" boolean DEFAULT false NOT NULL,
	"position" integer NOT NULL,
	"timeout_ms" integer DEFAULT 8000 NOT NULL,
	"revision" uuid DEFAULT gen_random_uuid() NOT NULL,
	"cooldown_until" timestamp with time zone,
	"tested_at" timestamp with time zone,
	"test_passed" boolean,
	CONSTRAINT "chat_providers_scope_position" UNIQUE NULLS NOT DISTINCT("workspace_id","position"),
	CONSTRAINT "chat_providers_position_range" CHECK ("chat_providers"."position" between 0 and 4),
	CONSTRAINT "chat_providers_timeout_range" CHECK ("chat_providers"."timeout_ms" between 100 and 30000)
);
--> statement-breakpoint
ALTER TABLE "chat_providers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "chat_turn_id" uuid;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "chat_lease_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "provider_name" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "provider_model" text;--> statement-breakpoint
ALTER TABLE "chat_providers" ADD CONSTRAINT "chat_providers_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
UPDATE "notification_channels"
SET "events" = array_append("events", 'chat_unavailable')
WHERE "active" AND NOT ('chat_unavailable' = ANY("events"));
