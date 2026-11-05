CREATE TABLE "appointments" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"patient_id" text,
	"pt_user_id" text,
	"invitee_name" text NOT NULL,
	"invitee_email" text NOT NULL,
	"event_name" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"visit_id" text,
	"simulated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_events" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"event_key" text NOT NULL,
	"event_type" text NOT NULL,
	"outcome" text NOT NULL,
	"detail" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "message_threads" ADD COLUMN "reply_token" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "via" text DEFAULT 'app' NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_events" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "display_name" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "notify_by_email" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "visits" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "visits" ADD COLUMN "appointment_id" text;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_pt_user_id_users_id_fk" FOREIGN KEY ("pt_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "appt_source_external_uq" ON "appointments" USING btree ("source","external_id");--> statement-breakpoint
CREATE INDEX "appt_starts_idx" ON "appointments" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "appt_patient_idx" ON "appointments" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "integration_events_key_idx" ON "integration_events" USING btree ("source","event_key");--> statement-breakpoint
CREATE UNIQUE INDEX "thread_reply_token_uq" ON "message_threads" USING btree ("reply_token");