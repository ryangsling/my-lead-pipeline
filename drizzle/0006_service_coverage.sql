ALTER TABLE "services" ADD COLUMN "visit_kind" text DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "service_zips" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "service_cities" text[] DEFAULT '{}' NOT NULL;