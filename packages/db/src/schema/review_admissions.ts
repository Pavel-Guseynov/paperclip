import {
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { issues } from "./issues.js";
import { heartbeatRuns } from "./heartbeat_runs.js";
import { issueThreadInteractions } from "./issue_thread_interactions.js";
import { statusDecisions } from "./status_decisions.js";

export const reviewAdmissions = pgTable(
  "review_admissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    issueId: uuid("issue_id").notNull(),
    sourceSha: varchar("source_sha", { length: 64 }).notNull(),
    policyDigest: varchar("policy_digest", { length: 64 }).notNull(),
    status: varchar("status", { length: 32 }).notNull().default("admitted"),
    acceptanceContract: jsonb("acceptance_contract").$type<Record<string, unknown>>().notNull(),
    reviewPolicy: varchar("review_policy", { length: 64 }).notNull().default("anyone"),
    prDetails: jsonb("pr_details").$type<Record<string, unknown>>(),
    preflightEvidence: jsonb("preflight_evidence").$type<Record<string, unknown>>(),
    supersedesAdmissionId: uuid("supersedes_admission_id"),
    reviewerRunId: uuid("reviewer_run_id").references(() => heartbeatRuns.id, { onDelete: "set null" }),
    reviewInteractionId: uuid("review_interaction_id").references(() => issueThreadInteractions.id, { onDelete: "set null" }),
    decisionId: uuid("decision_id").references(() => statusDecisions.id, { onDelete: "set null" }),
    decision: varchar("decision", { length: 32 }),
    decisionReason: text("decision_reason"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIssueIdUq: unique("review_admissions_company_issue_id_uq").on(
      table.companyId,
      table.issueId,
      table.id,
    ),
    issueCompanyFk: foreignKey({
      columns: [table.companyId, table.issueId],
      foreignColumns: [issues.companyId, issues.id],
      name: "review_admissions_issue_company_fk",
    }).onDelete("cascade"),
    supersedesOwnerFk: foreignKey({
      columns: [table.companyId, table.issueId, table.supersedesAdmissionId],
      foreignColumns: [table.companyId, table.issueId, table.id],
      name: "review_admissions_supersedes_owner_fk",
    }),
    issueRevisionDigestUq: uniqueIndex("review_admissions_issue_revision_digest_uq").on(
      table.companyId,
      table.issueId,
      table.sourceSha,
      table.policyDigest,
    ),
    companyIssueIdx: index("review_admissions_company_issue_idx").on(
      table.companyId,
      table.issueId,
    ),
    statusIdx: index("review_admissions_status_idx").on(
      table.companyId,
      table.status,
    ),
  }),
);
