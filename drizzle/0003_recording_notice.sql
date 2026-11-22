ALTER TABLE "workspaces" ADD COLUMN "recording_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
UPDATE calendars SET busy_cache = NULL, busy_cached_at = NULL;
--> statement-breakpoint
UPDATE integrations SET last_error = 'Previous provider check failed' WHERE last_error IS NOT NULL;
--> statement-breakpoint
UPDATE assistant_syncs SET sync_error = 'Previous sync failed' WHERE sync_error IS NOT NULL;
--> statement-breakpoint
UPDATE notification_log SET error = 'Previous delivery failed' WHERE error IS NOT NULL;
--> statement-breakpoint
UPDATE vapi_accounts SET last_error = 'Previous provider check failed' WHERE last_error IS NOT NULL;
