CREATE TABLE "deletion_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"request_id" uuid,
	"kind" text NOT NULL,
	"subject_key" text NOT NULL,
	"reason" text NOT NULL,
	"status" text NOT NULL,
	"target_encrypted" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"lease_until" timestamp with time zone,
	"error_code" text,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deletion_log_workspace_id" UNIQUE("workspace_id","id"),
	CONSTRAINT "deletion_log_workspace_kind_subject" UNIQUE("workspace_id","kind","subject_key"),
	CONSTRAINT "deletion_log_request_check" CHECK (("deletion_log"."kind" = 'local') = ("deletion_log"."request_id" is null))
);
--> statement-breakpoint
ALTER TABLE "deletion_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "pii_erased_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "last_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "vapi_assistant_id" text;--> statement-breakpoint
ALTER TABLE "tool_receipts" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD COLUMN "call_id" text;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD COLUMN "vapi_assistant_id" text;--> statement-breakpoint
ALTER TABLE "deletion_log" ADD CONSTRAINT "deletion_log_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deletion_log" ADD CONSTRAINT "deletion_log_workspace_request_fk" FOREIGN KEY ("workspace_id","request_id") REFERENCES "public"."deletion_log"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deletion_log_due" ON "deletion_log" USING btree ("next_attempt_at") WHERE "deletion_log"."next_attempt_at" is not null;--> statement-breakpoint
CREATE INDEX "deletion_log_leases" ON "deletion_log" USING btree ("lease_until") WHERE "deletion_log"."lease_until" is not null;--> statement-breakpoint
CREATE INDEX "webhook_events_workspace_call" ON "webhook_events" USING btree ("workspace_id","call_id");
--> statement-breakpoint
-- Existing appointments have no creation timestamp. The scheduled start is the conservative fallback.
UPDATE "appointments" SET "created_at" = LEAST("start_at", now());
--> statement-breakpoint
-- A historical receipt is usable as provenance only when the original ingest scoped it and its ID matches.
UPDATE "webhook_events" SET
  "call_id" = "raw" #>> '{message,call,id}',
  "vapi_assistant_id" = NULLIF("raw" #>> '{message,call,assistantId}', '')
WHERE "workspace_id" IS NOT NULL AND "source" = 'vapi'
  AND NULLIF("raw" #>> '{message,call,id}', '') IS NOT NULL
  AND (("event_type" = 'end-of-call-report' AND "external_id" = "raw" #>> '{message,call,id}')
    OR ("event_type" <> 'end-of-call-report' AND starts_with("external_id", ("raw" #>> '{message,call,id}') || ':')));
--> statement-breakpoint
UPDATE "tool_receipts" AS r SET "created_at" = c."created_at"
FROM "conversations" AS c
WHERE r."workspace_id" = c."workspace_id" AND r."call_id" = c."external_id";
