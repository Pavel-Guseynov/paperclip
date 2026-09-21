CREATE TABLE "review_admissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"source_sha" varchar(64) NOT NULL,
	"policy_digest" varchar(64) NOT NULL,
	"status" varchar(32) DEFAULT 'admitted' NOT NULL,
	"acceptance_contract" jsonb NOT NULL,
	"review_policy" varchar(64) DEFAULT 'anyone' NOT NULL,
	"pr_details" jsonb,
	"preflight_evidence" jsonb,
	"supersedes_admission_id" uuid,
	"reviewer_run_id" uuid,
	"review_interaction_id" uuid,
	"decision_id" uuid,
	"decision" varchar(32),
	"decision_reason" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_admissions_company_issue_id_uq" UNIQUE("company_id","issue_id","id")
);
--> statement-breakpoint
ALTER TABLE "review_admissions" ADD CONSTRAINT "review_admissions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_admissions" ADD CONSTRAINT "review_admissions_reviewer_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("reviewer_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_admissions" ADD CONSTRAINT "review_admissions_review_interaction_id_issue_thread_interactions_id_fk" FOREIGN KEY ("review_interaction_id") REFERENCES "public"."issue_thread_interactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_admissions" ADD CONSTRAINT "review_admissions_decision_id_status_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."status_decisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_admissions" ADD CONSTRAINT "review_admissions_issue_company_fk" FOREIGN KEY ("company_id","issue_id") REFERENCES "public"."issues"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_admissions" ADD CONSTRAINT "review_admissions_supersedes_owner_fk" FOREIGN KEY ("company_id","issue_id","supersedes_admission_id") REFERENCES "public"."review_admissions"("company_id","issue_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "review_admissions_issue_revision_digest_uq" ON "review_admissions" USING btree ("company_id","issue_id","source_sha","policy_digest");--> statement-breakpoint
CREATE INDEX "review_admissions_company_issue_idx" ON "review_admissions" USING btree ("company_id","issue_id");--> statement-breakpoint
CREATE INDEX "review_admissions_status_idx" ON "review_admissions" USING btree ("company_id","status");