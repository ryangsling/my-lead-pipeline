CREATE TABLE "urgent_events" (
	"workspace_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"sent" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "urgent_events_workspace_id_conversation_id_pk" PRIMARY KEY("workspace_id","conversation_id")
);
--> statement-breakpoint
ALTER TABLE "urgent_events" ADD CONSTRAINT "urgent_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "urgent_events" ADD CONSTRAINT "urgent_events_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE urgent_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
UPDATE notification_channels SET events = array_append(events, 'urgent_callback') WHERE NOT ('urgent_callback' = ANY(events));
