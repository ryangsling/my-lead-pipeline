ALTER TABLE "assistant_syncs" DROP CONSTRAINT "assistant_syncs_pair";--> statement-breakpoint
ALTER TABLE "assistant_syncs" ALTER COLUMN "vapi_account_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "assistant_syncs" ADD CONSTRAINT "assistant_syncs_pair" UNIQUE NULLS NOT DISTINCT("assistant_id","vapi_account_id");