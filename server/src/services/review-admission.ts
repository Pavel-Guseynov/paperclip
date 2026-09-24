import { createHash } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { reviewAdmissions } from "@paperclipai/db";
import type { ReviewAdmissionDecision } from "@paperclipai/shared";
import { HttpError } from "../errors.js";
import { resolveDeliveryTarget, resolveReviewedHeadSha } from "./delivery-verification.js";

export type ReviewAdmissionRow = typeof reviewAdmissions.$inferSelect;

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * The part of an execution policy that changes what a review is being asked to accept.
 *
 * `monitor` and the other operational fields move for reasons that have nothing to do
 * with the reviewer's question — a wake time, a retry count, who scheduled a check. If
 * the digest covered them, an unrelated monitor write would change the identity and admit
 * a second review of the same commit against the same contract.
 */
export function acceptanceRelevantExecutionPolicy(policy: unknown): Record<string, unknown> | null {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) return null;
  const record = policy as Record<string, unknown>;
  const stages = Array.isArray(record.stages)
    ? record.stages.map((stage) => {
        const entry = (stage ?? {}) as Record<string, unknown>;
        return {
          id: entry.id ?? null,
          type: entry.type ?? null,
          approvalsNeeded: entry.approvalsNeeded ?? null,
          participants: entry.participants ?? null,
        };
      })
    : [];
  return {
    mode: record.mode ?? null,
    commentRequired: record.commentRequired ?? null,
    evidenceRequired: record.evidenceRequired ?? null,
    maxReviewRounds: record.maxReviewRounds ?? null,
    reviewPreset: record.reviewPreset ?? null,
    authorizationPolicy: record.authorizationPolicy ?? null,
    stages,
  };
}

/**
 * The digest half of a review's identity.
 *
 * Two reviews of the same commit are the same review only if the acceptance contract,
 * the review policy, and the acceptance-relevant part of the execution policy that
 * govern them are the same. Key order must not change the digest, so the input is
 * canonicalized before hashing.
 */
export function computeReviewPolicyDigest(input: {
  acceptanceContract?: unknown;
  reviewPolicy?: string | null;
  executionPolicy?: unknown;
}): string {
  const normalized = {
    acceptanceContract: input.acceptanceContract ?? null,
    reviewPolicy: input.reviewPolicy?.trim() || "anyone",
    executionPolicy: acceptanceRelevantExecutionPolicy(input.executionPolicy),
  };
  return createHash("sha256").update(canonicalJson(normalized)).digest("hex");
}

export interface AdmitReviewInput {
  companyId: string;
  /** The issue row the caller already holds; nothing here is read from a request body. */
  issue: {
    id: string;
    companyId: string;
    projectId?: string | null;
    title: string;
    description?: string | null;
    reviewPolicy?: string | null;
    executionPolicy?: unknown;
    sourceTrust?: unknown;
  };
  /** The interaction the caller created for this review, in this same transaction. */
  reviewInteractionId: string | null;
  /** The native status decision whose `bind_reviewer` effect launched the review. */
  decisionId: string | null;
  resolverPolicy: string;
}

export type AdmitReviewResult =
  | { admitted: false; reason: "no_revision_identity" }
  | { admitted: true; created: boolean; admission: ReviewAdmissionRow };

/**
 * Record the admission for a review that the caller is launching in this transaction.
 *
 * Every value is server-held: the revision comes from the issue's own `commit` work
 * product, the acceptance contract and review policy from the issue row, and the pull
 * request identity from the same binding delivery verification uses. Nothing is read
 * from a request.
 *
 * An issue with no recorded reviewed head has no revision identity, so there is nothing
 * to key an admission on and none is written. The caller's review still launches — this
 * function records, it does not gate.
 */
export class ReviewAdmissionService {
  constructor(private readonly db: Db) {}

  async admitReview(input: AdmitReviewInput, tx: Db = this.db): Promise<AdmitReviewResult> {
    const { companyId, issue } = input;
    const sourceSha = await resolveReviewedHeadSha(tx, { id: issue.id, companyId });
    if (!sourceSha) return { admitted: false, reason: "no_revision_identity" };

    const acceptanceContract: Record<string, unknown> = {
      objective: issue.title,
      criteria: [{ id: "objective", requirement: issue.description || issue.title }],
    };
    const reviewPolicy = issue.reviewPolicy?.trim() || input.resolverPolicy || "anyone";
    const policyDigest = computeReviewPolicyDigest({
      acceptanceContract,
      reviewPolicy,
      executionPolicy: issue.executionPolicy ?? null,
    });

    // No application lock: `review_admissions_issue_revision_digest_uq` is the single
    // authority on the identity. A racing pair either both find the active admission,
    // or one wins the insert and the other re-reads it below. An advisory lock would be
    // held for the rest of the launching transaction to decide nothing the index does
    // not already decide.
    const [latest] = await tx
      .select()
      .from(reviewAdmissions)
      .where(
        and(
          eq(reviewAdmissions.companyId, companyId),
          eq(reviewAdmissions.issueId, issue.id),
          eq(reviewAdmissions.sourceSha, sourceSha),
          eq(reviewAdmissions.policyDigest, policyDigest),
        ),
      )
      .orderBy(desc(reviewAdmissions.round))
      .limit(1);

    // An active admission already carries this revision's review; the repeated launch
    // returns it rather than opening a second one.
    if (latest?.status === "in_review") {
      return { admitted: true, created: false, admission: latest };
    }

    // `latest` decided or superseded: this is a further round of the same revision — a
    // changes-requested round the author answered without a new commit. Its outcome must
    // be recorded too, and the earlier decision is immutable, so it gets its own row.
    const round = (latest?.round ?? 0) + 1;
    const supersedes = latest ?? null;

    let priorActive = supersedes;
    if (!priorActive) {
      [priorActive] = await tx
        .select()
        .from(reviewAdmissions)
        .where(
          and(
            eq(reviewAdmissions.companyId, companyId),
            eq(reviewAdmissions.issueId, issue.id),
            inArray(reviewAdmissions.status, ["in_review"]),
          ),
        )
        .orderBy(desc(reviewAdmissions.createdAt))
        .limit(1);
    }
    if (priorActive?.status === "in_review") {
      await tx
        .update(reviewAdmissions)
        .set({ status: "superseded", updatedAt: new Date() })
        .where(
          and(
            eq(reviewAdmissions.id, priorActive.id),
            eq(reviewAdmissions.companyId, companyId),
          ),
        );
    }

    const target = await resolveDeliveryTarget(tx, {
      id: issue.id,
      companyId,
      projectId: issue.projectId ?? null,
      sourceTrust: issue.sourceTrust,
    });

    const [inserted] = await tx
      .insert(reviewAdmissions)
      .values({
        companyId,
        issueId: issue.id,
        sourceSha,
        policyDigest,
        round,
        status: "in_review",
        acceptanceContract,
        reviewPolicy,
        prDetails: target.ok
          ? {
              provider: "github",
              repository: `${target.target.owner}/${target.target.repo}`,
              pullNumber: target.target.pullNumber,
              baseRef: target.target.baseRef,
              reviewedHeadSha: target.target.reviewedHeadSha,
            }
          : null,
        supersedesAdmissionId: priorActive?.id ?? null,
        reviewInteractionId: input.reviewInteractionId,
        decisionId: input.decisionId,
      })
      // A racing insert that won the unique index keeps its row; this one yields to it.
      .onConflictDoNothing({
        target: [
          reviewAdmissions.companyId,
          reviewAdmissions.issueId,
          reviewAdmissions.sourceSha,
          reviewAdmissions.policyDigest,
          reviewAdmissions.round,
        ],
      })
      .returning();

    if (inserted) return { admitted: true, created: true, admission: inserted };

    const [winner] = await tx
      .select()
      .from(reviewAdmissions)
      .where(
        and(
          eq(reviewAdmissions.companyId, companyId),
          eq(reviewAdmissions.issueId, issue.id),
          eq(reviewAdmissions.sourceSha, sourceSha),
          eq(reviewAdmissions.policyDigest, policyDigest),
          eq(reviewAdmissions.round, round),
        ),
      )
      .limit(1);
    if (!winner) {
      throw new HttpError(500, "Review admission could not be recorded.", {
        code: "review_admission_unrecorded",
      });
    }
    return { admitted: true, created: false, admission: winner };
  }

  /**
   * Record the immutable outcome of an admitted review.
   *
   * Every predicate carries the company: an admission id alone never selects a row.
   * Once a decision is recorded it cannot be changed — the same decision again is a
   * no-op, a different one is a conflict. `changes_requested` must say what to change,
   * because a rejection a reviewer cannot act on is not a review.
   */
  async recordReviewDecision(
    input: {
      companyId: string;
      admissionId: string;
      decision: ReviewAdmissionDecision;
      reason?: string | null;
    },
    tx: Db = this.db,
  ): Promise<{ admission: ReviewAdmissionRow; deduplicated: boolean }> {
    const [admission] = await tx
      .select()
      .from(reviewAdmissions)
      .where(
        and(
          eq(reviewAdmissions.id, input.admissionId),
          eq(reviewAdmissions.companyId, input.companyId),
        ),
      )
      .for("update");

    if (!admission) {
      throw new HttpError(404, "Review admission not found.", { code: "admission_not_found" });
    }

    const reasonText = input.reason?.trim() || null;

    if (admission.status === "completed") {
      if (admission.decision === input.decision) {
        return { admission, deduplicated: true };
      }
      throw new HttpError(409, "Review decision is immutable and cannot be changed once recorded.", {
        code: "review_already_decided",
        existingDecision: admission.decision,
        attemptedDecision: input.decision,
      });
    }

    if (input.decision === "changes_requested" && !reasonText) {
      throw new HttpError(422, "Requesting changes requires stating the changes in reason.", {
        code: "rejection_reason_required",
      });
    }

    const now = new Date();
    const [updated] = await tx
      .update(reviewAdmissions)
      .set({
        status: "completed",
        decision: input.decision,
        decisionReason: reasonText,
        decidedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(reviewAdmissions.id, admission.id),
          eq(reviewAdmissions.companyId, input.companyId),
        ),
      )
      .returning();

    return { admission: updated ?? admission, deduplicated: false };
  }

  /**
   * The admission a resolved review interaction belongs to, scoped to its company.
   *
   * Returns null when the interaction is an ordinary completion review with no recorded
   * revision identity — that is the normal case for an issue without a commit work
   * product, and it must not be an error.
   */
  async findAdmissionForInteraction(
    input: { companyId: string; reviewInteractionId: string },
    tx: Db = this.db,
  ): Promise<ReviewAdmissionRow | null> {
    const [row] = await tx
      .select()
      .from(reviewAdmissions)
      .where(
        and(
          eq(reviewAdmissions.companyId, input.companyId),
          eq(reviewAdmissions.reviewInteractionId, input.reviewInteractionId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

}

export function createReviewAdmissionService(db: Db): ReviewAdmissionService {
  return new ReviewAdmissionService(db);
}
