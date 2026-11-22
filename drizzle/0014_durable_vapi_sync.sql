ALTER TABLE "assistant_syncs" ADD COLUMN "desired_config_hash" text;--> statement-breakpoint
ALTER TABLE "assistant_syncs" ADD COLUMN "applied_config_hash" text;--> statement-breakpoint
ALTER TABLE "assistant_syncs" ADD COLUMN "resource_checkpoints" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "assistant_syncs" ADD COLUMN "replacement_vapi_assistant_id" text;--> statement-breakpoint
ALTER TABLE "assistant_syncs" ADD COLUMN "sync_lease_id" uuid;--> statement-breakpoint
ALTER TABLE "assistant_syncs" ADD COLUMN "sync_lease_until" timestamp with time zone;