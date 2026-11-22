ALTER TABLE "workspaces" ADD COLUMN "transfer_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "callback_minutes" integer DEFAULT 15 NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "on_call_number" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "backup_number" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "escalation_triggers" text DEFAULT '' NOT NULL;