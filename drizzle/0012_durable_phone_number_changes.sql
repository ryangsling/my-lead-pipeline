CREATE TABLE "phone_number_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source_workspace_id" uuid,
	"vapi_phone_number_id" text NOT NULL,
	"replaced_vapi_phone_number_id" text,
	"phone_number_id" uuid NOT NULL,
	"assistant_id" uuid NOT NULL,
	"vapi_assistant_id" text NOT NULL,
	"expected_vapi_assistant_id" text,
	"e164" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"reconcile_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "phone_number_changes_status_check" CHECK ("phone_number_changes"."status" in ('pending', 'applying', 'completed', 'rejected'))
);
--> statement-breakpoint
ALTER TABLE "phone_number_changes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "phone_number_changes" ADD CONSTRAINT "phone_number_changes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "phone_number_changes_reconcile_at_idx" ON "phone_number_changes" USING btree ("reconcile_at") WHERE "phone_number_changes"."reconcile_at" is not null;