ALTER TABLE "workspaces" ALTER COLUMN "recording_enabled" SET DEFAULT false;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "recording_consent_at" timestamp with time zone;