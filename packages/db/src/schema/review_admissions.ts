import {
  foreignKey,
  index,
  integer,
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
import { issueThreadInteractions } from "./issue_thread_interactions.js";
import { statusDecisions } from "./status_decisions.js";

/**
 * One row per admitted review of one issue revision, per review round.
 *
 * `(company_id, issue_id, source_sha, policy_digest, round)` is unique, and that index
 * is the only authority on the identity: whatever concurrency the callers apply, one
 * round of one revision against one acceptance contract admits exactly once. A new head
 * or a materially changed contract starts a new revision at round 1; a further review of
 * an already-decided revision — a changes-requested round the author answered without a
 * new commit — starts round 2 rather than overwriting the immutable decision. Either way
 * the new row names the row it supersedes.
 */
export const reviewAdmissions = pgTable(
  "review_admissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    issueId: uuid("issue_id").notNull(),
    sourceSha: varchar("source_sha", { length: 40 }).notNull(),
    policyDigest: varchar("policy_digest", { length: 64 }).notNull(),
    round: integer("round").notNull().default(1),
    status: varchar("status", { length: 32 }).notNull().default("in_review"),
    acceptanceContract: jsonb("acceptance_contract").$type<Record<string, unknown>>().notNull(),
    reviewPolicy: varchar("review_policy", { length: 64 }).notNull().default("anyone"),
    prDetails: jsonb("pr_details").$type<Record<string, unknown>>(),
    supersedesAdmissionId: uuid("supersedes_admission_id"),
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
    // A superseded admission must belong to the same company and issue, so the chain
    // cannot cross a company boundary even if an id leaks.
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
      table.round,
    ),
    companyInteractionIdx: index("review_admissions_company_interaction_idx").on(
      table.companyId,
      table.reviewInteractionId,
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
