CREATE TABLE "offered_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_receipts" (
	"workspace_id" uuid NOT NULL,
	"call_id" text NOT NULL,
	"tool_call_id" text NOT NULL,
	"name" text NOT NULL,
	"result" text,
	CONSTRAINT "tool_receipts_workspace_id_call_id_tool_call_id_pk" PRIMARY KEY("workspace_id","call_id","tool_call_id")
);
--> statement-breakpoint
ALTER TABLE "offered_slots" ADD CONSTRAINT "offered_slots_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offered_slots" ADD CONSTRAINT "offered_slots_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offered_slots" ADD CONSTRAINT "offered_slots_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_receipts" ADD CONSTRAINT "tool_receipts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE tool_receipts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE offered_slots ENABLE ROW LEVEL SECURITY;
