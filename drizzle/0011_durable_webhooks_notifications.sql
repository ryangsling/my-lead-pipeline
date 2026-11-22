ALTER TABLE "webhook_events" DROP CONSTRAINT "webhook_events_source_external";--> statement-breakpoint
ALTER TABLE "notification_log" ADD COLUMN "next_attempt_at" timestamp with time zone DEFAULT now();--> statement-breakpoint
ALTER TABLE "notification_log" ADD COLUMN "lease_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notification_log" ADD COLUMN "first_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notification_log" ADD COLUMN "transport" text;--> statement-breakpoint
ALTER TABLE "notification_log" ADD COLUMN "transport_fingerprint" text;--> statement-breakpoint
ALTER TABLE "notification_log" ADD COLUMN "uncertain_attempt" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_log" ADD COLUMN "urgent_conversation_id" uuid;--> statement-breakpoint
ALTER TABLE "urgent_events" ADD COLUMN "deadline_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "urgent_events" ADD COLUMN "acknowledged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "urgent_events" ADD COLUMN "deadline_missed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "urgent_events" ADD COLUMN "escalated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "urgent_events" ADD COLUMN "payload" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD COLUMN "status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD COLUMN "next_attempt_at" timestamp with time zone DEFAULT now();--> statement-breakpoint
ALTER TABLE "webhook_events" ADD COLUMN "lease_until" timestamp with time zone;--> statement-breakpoint
-- Historical receipts recorded no trusted workspace. Keep them for inspection without replaying them.
UPDATE "webhook_events" SET "status" = 'unscoped', "next_attempt_at" = NULL;--> statement-breakpoint
-- The old sender did not record its attempt until after sending. Acceptance of a pending row is unknown.
UPDATE "notification_log" SET "status" = 'uncertain', "uncertain_attempt" = true,
  "next_attempt_at" = NULL, "error" = 'Provider acceptance could not be confirmed. Check before sending again.'
  WHERE "status" = 'pending';--> statement-breakpoint
ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_urgent_conversation_id_conversations_id_fk" FOREIGN KEY ("urgent_conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_log_due" ON "notification_log" USING btree ("next_attempt_at") WHERE "notification_log"."status" in ('pending', 'retryable');--> statement-breakpoint
CREATE INDEX "notification_log_leases" ON "notification_log" USING btree ("lease_until") WHERE "notification_log"."status" = 'processing';--> statement-breakpoint
CREATE INDEX "urgent_events_deadline" ON "urgent_events" USING btree ("deadline_at") WHERE "urgent_events"."deadline_missed_at" is null;--> statement-breakpoint
CREATE INDEX "webhook_events_due" ON "webhook_events" USING btree ("next_attempt_at") WHERE "webhook_events"."status" in ('pending', 'retryable');--> statement-breakpoint
CREATE INDEX "webhook_events_leases" ON "webhook_events" USING btree ("lease_until") WHERE "webhook_events"."status" = 'processing';--> statement-breakpoint
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_workspace_source_external" UNIQUE("workspace_id","source","external_id");
