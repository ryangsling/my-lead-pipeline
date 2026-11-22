ALTER TABLE "appointments" DROP CONSTRAINT "appointments_status_check";--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "google_calendar_id" text;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "calendar_operation" jsonb;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "target_start" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "target_end" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "target_blocked_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "reconcile_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_status_check" CHECK ("appointments"."status" in ('pending', 'needs_review', 'requested', 'booked', 'confirmed', 'rescheduled', 'cancelled', 'no_show'));--> statement-breakpoint
UPDATE appointments AS a SET google_calendar_id = c.google_calendar_id
FROM calendars AS c WHERE c.workspace_id = a.workspace_id AND a.google_event_id IS NOT NULL;
--> statement-breakpoint
-- Earlier writes did not identify their Google event before insertion. These rows
-- need a dispatcher to match them before any new event can safely be created.
UPDATE appointments SET status = 'needs_review'
WHERE google_event_id IS NULL AND status IN ('booked', 'confirmed', 'rescheduled');
--> statement-breakpoint
ALTER TABLE appointments DROP CONSTRAINT appointments_no_overlap;
--> statement-breakpoint
-- A move holds exactly the union, including overlapping ranges and both buffers.
ALTER TABLE appointments ADD CONSTRAINT appointments_no_overlap EXCLUDE USING gist
(workspace_id WITH =, (tstzmultirange(
  CASE WHEN calendar_operation->>'previousStatus' IN ('cancelled', 'no_show')
       THEN 'empty'::tstzrange ELSE tstzrange(start_at, blocked_until) END,
  CASE WHEN target_start IS NULL THEN 'empty'::tstzrange ELSE tstzrange(target_start, target_blocked_until) END
)) WITH &&) WHERE (status NOT IN ('cancelled', 'no_show'));
--> statement-breakpoint
CREATE INDEX appointments_reconcile_at ON appointments(reconcile_at) WHERE reconcile_at IS NOT NULL;
