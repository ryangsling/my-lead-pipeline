CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_no_overlap" EXCLUDE USING gist ("workspace_id" WITH =, tstzrange("start_at", "blocked_until") WITH &&) WHERE ("status" NOT IN ('cancelled', 'no_show'));--> statement-breakpoint
ALTER TABLE "workspaces" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "integrations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "vapi_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "assistants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "assistant_syncs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "phone_numbers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "services" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "calendars" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contacts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "conversations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "appointments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notification_channels" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notification_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "embeds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "webhook_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rate_limits" ENABLE ROW LEVEL SECURITY;
