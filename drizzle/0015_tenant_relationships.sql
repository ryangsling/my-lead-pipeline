-- These children previously inherited their tenant only from the existing, constrained parent ID.
ALTER TABLE "assistant_syncs" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
UPDATE "assistant_syncs" AS child SET "workspace_id" = parent."workspace_id"
FROM "assistants" AS parent WHERE child."assistant_id" = parent."id";--> statement-breakpoint
UPDATE "messages" AS child SET "workspace_id" = parent."workspace_id"
FROM "conversations" AS parent WHERE child."conversation_id" = parent."id";--> statement-breakpoint
ALTER TABLE "assistant_syncs" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "assistant_syncs" DROP CONSTRAINT "assistant_syncs_pair";--> statement-breakpoint
ALTER TABLE "notification_log" DROP CONSTRAINT "notification_log_channel_dedupe";--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_workspace_id" UNIQUE("workspace_id","id");--> statement-breakpoint
ALTER TABLE "assistant_syncs" ADD CONSTRAINT "assistant_syncs_pair" UNIQUE NULLS NOT DISTINCT("workspace_id","assistant_id","vapi_account_id");--> statement-breakpoint
ALTER TABLE "assistants" ADD CONSTRAINT "assistants_workspace_id" UNIQUE("workspace_id","id");--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_workspace_id" UNIQUE("workspace_id","id");--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_workspace_id" UNIQUE("workspace_id","id");--> statement-breakpoint
ALTER TABLE "notification_channels" ADD CONSTRAINT "notification_channels_workspace_id" UNIQUE("workspace_id","id");--> statement-breakpoint
ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_channel_dedupe" UNIQUE("workspace_id","channel_id","dedupe_key");--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_workspace_id" UNIQUE("workspace_id","id");--> statement-breakpoint
-- PostgreSQL's column list keeps workspace_id intact when a nullable parent is deleted.
-- A tenant mismatch in an existing relationship aborts the migration, preserving the original rows.
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_workspace_contact_fk" FOREIGN KEY ("workspace_id","contact_id") REFERENCES "public"."contacts"("workspace_id","id") ON DELETE SET NULL ("contact_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_workspace_service_fk" FOREIGN KEY ("workspace_id","service_id") REFERENCES "public"."services"("workspace_id","id") ON DELETE SET NULL ("service_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_workspace_conversation_fk" FOREIGN KEY ("workspace_id","conversation_id") REFERENCES "public"."conversations"("workspace_id","id") ON DELETE SET NULL ("conversation_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_syncs" ADD CONSTRAINT "assistant_syncs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_syncs" ADD CONSTRAINT "assistant_syncs_workspace_assistant_fk" FOREIGN KEY ("workspace_id","assistant_id") REFERENCES "public"."assistants"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_workspace_contact_fk" FOREIGN KEY ("workspace_id","contact_id") REFERENCES "public"."contacts"("workspace_id","id") ON DELETE SET NULL ("contact_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_workspace_contact_fk" FOREIGN KEY ("workspace_id","contact_id") REFERENCES "public"."contacts"("workspace_id","id") ON DELETE SET NULL ("contact_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_workspace_conversation_fk" FOREIGN KEY ("workspace_id","conversation_id") REFERENCES "public"."conversations"("workspace_id","id") ON DELETE SET NULL ("conversation_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_workspace_appointment_fk" FOREIGN KEY ("workspace_id","appointment_id") REFERENCES "public"."appointments"("workspace_id","id") ON DELETE SET NULL ("appointment_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_workspace_conversation_fk" FOREIGN KEY ("workspace_id","conversation_id") REFERENCES "public"."conversations"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_workspace_channel_fk" FOREIGN KEY ("workspace_id","channel_id") REFERENCES "public"."notification_channels"("workspace_id","id") ON DELETE SET NULL ("channel_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_workspace_urgent_conversation_fk" FOREIGN KEY ("workspace_id","urgent_conversation_id") REFERENCES "public"."conversations"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offered_slots" ADD CONSTRAINT "offered_slots_workspace_conversation_fk" FOREIGN KEY ("workspace_id","conversation_id") REFERENCES "public"."conversations"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offered_slots" ADD CONSTRAINT "offered_slots_workspace_service_fk" FOREIGN KEY ("workspace_id","service_id") REFERENCES "public"."services"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phone_number_changes" ADD CONSTRAINT "phone_number_changes_workspace_assistant_fk" FOREIGN KEY ("workspace_id","assistant_id") REFERENCES "public"."assistants"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phone_numbers" ADD CONSTRAINT "phone_numbers_workspace_assistant_fk" FOREIGN KEY ("workspace_id","assistant_id") REFERENCES "public"."assistants"("workspace_id","id") ON DELETE SET NULL ("assistant_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "urgent_events" ADD CONSTRAINT "urgent_events_workspace_conversation_fk" FOREIGN KEY ("workspace_id","conversation_id") REFERENCES "public"."conversations"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" DROP CONSTRAINT "appointments_contact_id_contacts_id_fk";--> statement-breakpoint
ALTER TABLE "appointments" DROP CONSTRAINT "appointments_service_id_services_id_fk";--> statement-breakpoint
ALTER TABLE "appointments" DROP CONSTRAINT "appointments_conversation_id_conversations_id_fk";--> statement-breakpoint
ALTER TABLE "assistant_syncs" DROP CONSTRAINT "assistant_syncs_assistant_id_assistants_id_fk";--> statement-breakpoint
ALTER TABLE "conversations" DROP CONSTRAINT "conversations_contact_id_contacts_id_fk";--> statement-breakpoint
ALTER TABLE "jobs" DROP CONSTRAINT "jobs_contact_id_contacts_id_fk";--> statement-breakpoint
ALTER TABLE "jobs" DROP CONSTRAINT "jobs_conversation_id_conversations_id_fk";--> statement-breakpoint
ALTER TABLE "jobs" DROP CONSTRAINT "jobs_appointment_id_appointments_id_fk";--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT "messages_conversation_id_conversations_id_fk";--> statement-breakpoint
ALTER TABLE "notification_log" DROP CONSTRAINT "notification_log_channel_id_notification_channels_id_fk";--> statement-breakpoint
ALTER TABLE "notification_log" DROP CONSTRAINT "notification_log_urgent_conversation_id_conversations_id_fk";--> statement-breakpoint
ALTER TABLE "offered_slots" DROP CONSTRAINT "offered_slots_conversation_id_conversations_id_fk";--> statement-breakpoint
ALTER TABLE "offered_slots" DROP CONSTRAINT "offered_slots_service_id_services_id_fk";--> statement-breakpoint
ALTER TABLE "phone_numbers" DROP CONSTRAINT "phone_numbers_assistant_id_assistants_id_fk";--> statement-breakpoint
ALTER TABLE "urgent_events" DROP CONSTRAINT "urgent_events_conversation_id_conversations_id_fk";--> statement-breakpoint
CREATE INDEX "messages_workspace_conversation_created_idx" ON "messages" USING btree ("workspace_id","conversation_id","created_at");--> statement-breakpoint
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_workspace_status_check" CHECK (("webhook_events"."workspace_id" is null) = ("webhook_events"."status" = 'unscoped'));
