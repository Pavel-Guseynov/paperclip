import { createHash } from "node:crypto";
import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  issueLabels,
  issues,
  issueThreadInteractions,
  labels,
  reviewAdmissions,
} from "@paperclipai/db";
import type {
  CompactReviewContext,
  PRReadResult,
  ReviewAdmission,
  ReviewAdmissionStatus,
  SubmitReviewInput,
  SubmitReviewResult,
} from "@paperclipai/shared";
import { HttpError } from "../errors.js";
import {
  DELIVERY_ERROR_CODES,
  DeliveryVerificationError,
  DeliveryVerificationService,
  createDeliveryVerificationService,
  type DeliveryProviderClient,
  type PreflightReviewDeliveryInput,
  type PreflightReviewDeliveryResult,
} from "./delivery-verification.js";
import { issueThreadInteractionService } from "./issue-thread-interactions.js";

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function computeReviewPolicyDigest(input: {
  acceptanceCriteria?: unknown;
  acceptanceContract?: unknown;
  acceptance?: unknown;
  reviewPolicy?: string | null;
  policy?: string | null;
  instructions?: string | null;
  executionPolicy?: unknown;
}): string {
  const normalized = {
    acceptanceCriteria: input.acceptanceCriteria ?? input.acceptanceContract ?? input.acceptance ?? null,
    reviewPolicy: (input.reviewPolicy ?? input.policy)?.trim() || "anyone",
    instructions: input.instructions?.trim() || null,
    executionPolicy: input.executionPolicy ?? null,
  };
  return createHash("sha256").update(canonicalJson(normalized)).digest("hex");
}

export interface AdmitReviewInput {
  companyId: string;
  issueId: string;
  sourceSha: string;
  acceptanceContract?: Record<string, unknown> | null;
  reviewPolicy?: string | null;
  instructions?: string | null;
  executionPolicy?: unknown;
  evidence?: {
    pr?: string | number | null;
    repo?: string | null;
    repoUrl?: string | null;
    headSha?: string | null;
    mergedSha?: string | null;
    checkRun?: string | number | null;
    note?: string | null;
  } | null;
  repoUrl?: string | null;
  baseRef?: string | null;
  workProducts?: Array<{
    kind?: string;
    title?: string;
    location?: string;
    [key: string]: unknown;
  }> | null;
  actorId?: string;
  actorType?: "agent" | "user" | "system";
  client?: DeliveryProviderClient;
  reviewerAgentId?: string | null;
  reviewerUserId?: string | null;
  labels?: Array<{ name?: string } | string> | null;
}

export interface AdmitReviewResult {
  status: "admitted" | "active" | "completed";
  admission: typeof reviewAdmissions.$inferSelect;
  created?: boolean;
  deduplicated?: boolean;
  immutable?: boolean;
  decision?: string | null;
  decisionReason?: string | null;
  decidedAt?: Date | null;
  supersededAdmissionId?: string | null;
}

export class ReviewAdmissionService {
  constructor(
    private readonly db: Db,
    private readonly deliveryVerificationService: DeliveryVerificationService = createDeliveryVerificationService(),
  ) {}

  async admitReview(
    input: AdmitReviewInput,
    externalTx?: Db,
  ): Promise<AdmitReviewResult> {
    const runInTx = async (tx: any): Promise<AdmitReviewResult> => {
      const companyId = input.companyId;
      const issueId = input.issueId;
      const sourceSha = input.sourceSha.trim();

      if (!sourceSha || !/^[0-9a-f]{7,64}$/i.test(sourceSha)) {
        throw new HttpError(422, "A valid git source SHA is required for review admission.", {
          code: "invalid_source_sha",
        });
      }

      const policyDigest = computeReviewPolicyDigest({
        acceptanceCriteria: input.acceptanceContract,
        reviewPolicy: input.reviewPolicy,
        instructions: input.instructions,
        executionPolicy: input.executionPolicy,
      });

      // 1. Transactional advisory lock serialized per issue
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`paperclip:review-admission:${companyId}:${issueId}`}, 0))`);

      // 2. Check for exact match admission by (companyId, issueId, sourceSha, policyDigest)
      const existing = await tx
        .select()
        .from(reviewAdmissions)
        .where(
          and(
            eq(reviewAdmissions.companyId, companyId),
            eq(reviewAdmissions.issueId, issueId),
            eq(reviewAdmissions.sourceSha, sourceSha),
            eq(reviewAdmissions.policyDigest, policyDigest),
          ),
        )
        .limit(1)
        .then((rows: any[]) => rows[0] ?? null);

      if (existing) {
        // If already completed: return immutable decision
        if (existing.status === "completed") {
          return {
            status: "completed",
            admission: existing,
            decision: existing.decision,
            decisionReason: existing.decisionReason,
            decidedAt: existing.decidedAt,
            immutable: true,
            deduplicated: true,
          };
        }
        // If active/admitted/in_review: return existing active review without duplicate dispatch
        if (existing.status === "admitted" || existing.status === "in_review") {
          return {
            status: "active",
            admission: existing,
            deduplicated: true,
          };
        }
      }

      // 3. Fetch issue to verify existence & disposition
      const [issue] = await tx
        .select()
        .from(issues)
        .where(and(eq(issues.id, issueId), eq(issues.companyId, companyId)))
        .for("update");

      if (!issue) {
        throw new HttpError(404, "Issue not found for review admission.", {
          code: "issue_not_found",
        });
      }

      // 4. Preflight gating boundary: PR identity, work products, exact head, disposition, checks
      let issueLabelsList: Array<{ name: string }> = [];
      if (Array.isArray(input.labels)) {
        issueLabelsList = input.labels.map((l) =>
          typeof l === "string" ? { name: l } : { name: l.name ?? "" },
        );
      } else {
        const labelRows = await tx
          .select({ name: labels.name })
          .from(issueLabels)
          .innerJoin(labels, eq(issueLabels.labelId, labels.id))
          .where(eq(issueLabels.issueId, issue.id));
        issueLabelsList = labelRows;
      }

      const preflightInput: PreflightReviewDeliveryInput = {
        issue: {
          id: issue.id,
          title: issue.title,
          status: issue.status,
          originKind: issue.originKind,
          labels: issueLabelsList,
        },
        sourceSha,
        evidence: input.evidence,
        repoUrl: input.repoUrl,
        baseRef: input.baseRef,
        workProducts: input.workProducts,
        client: input.client,
      };

      const preflight = await this.deliveryVerificationService.preflightReviewDelivery(preflightInput);

      if (!preflight.verified) {
        throw new DeliveryVerificationError(
          preflight.errorCode ?? DELIVERY_ERROR_CODES.REPOSITORY_UNAVAILABLE,
          preflight.reason ?? "Delivery evidence preflight verification failed before review admission.",
          {
            issueId,
            sourceSha,
            errorCode: preflight.errorCode,
            reason: preflight.reason,
          },
        );
      }

      // 5. Look for any prior active admission to supersede
      const priorActive = await tx
        .select()
        .from(reviewAdmissions)
        .where(
          and(
            eq(reviewAdmissions.companyId, companyId),
            eq(reviewAdmissions.issueId, issueId),
            inArray(reviewAdmissions.status, ["admitted", "in_review"]),
          ),
        )
        .orderBy(desc(reviewAdmissions.createdAt))
        .limit(1)
        .then((rows: any[]) => rows[0] ?? null);

      if (priorActive) {
        await tx
          .update(reviewAdmissions)
          .set({
            status: "superseded",
            updatedAt: new Date(),
          })
          .where(eq(reviewAdmissions.id, priorActive.id));

        if (priorActive.reviewInteractionId) {
          await tx
            .update(issueThreadInteractions)
            .set({
              status: "cancelled",
              updatedAt: new Date(),
              result: {
                version: 1,
                outcome: "superseded",
                reason: "Review superseded by a newer revision or policy",
              },
            })
            .where(
              and(
                eq(issueThreadInteractions.id, priorActive.reviewInteractionId),
                eq(issueThreadInteractions.status, "pending"),
              ),
            );
        }
      }

      // 6. Persist admission BEFORE external work (database uniqueness enforced)
      const normalizedContract = input.acceptanceContract ?? {
        objective: issue.title,
        criteria: [{ id: "objective", requirement: issue.description || issue.title }],
      };
      const normalizedReviewPolicy = input.reviewPolicy?.trim() || issue.reviewPolicy || "anyone";

      const [admitted] = await tx
        .insert(reviewAdmissions)
        .values({
          companyId,
          issueId,
          sourceSha,
          policyDigest,
          status: "admitted",
          acceptanceContract: normalizedContract,
          reviewPolicy: normalizedReviewPolicy,
          prDetails: preflight.pr
            ? {
                provider: preflight.provider,
                repo: preflight.repo,
                pullNumber: preflight.pullNumber,
                headSha: preflight.pr.headSha,
                baseRef: preflight.pr.baseRef,
                checksSummary: preflight.checksSummary,
              }
            : null,
          preflightEvidence: preflight.preflightEvidence ?? null,
          supersedesAdmissionId: priorActive?.id ?? null,
        })
        .returning();

      if (!admitted) {
        throw new Error("Failed to persist review admission");
      }

      // 7. Perform external work: create review confirmation interaction
      let reviewInteractionId: string | null = null;
      try {
        const interaction = await issueThreadInteractionService(tx as unknown as Db).create(
          issue,
          {
            kind: "request_confirmation",
            idempotencyKey: `review-admission:${admitted.id}`,
            title: `Review requested: ${issue.title}`,
            summary: `Review revision ${sourceSha.slice(0, 8)} against acceptance criteria`,
            continuationPolicy: "none",
            resolverPolicy: normalizedReviewPolicy === "human_only" ? "human_only" : "anyone",
            addresseeAgentId: input.reviewerAgentId ?? null,
            addresseeUserId: input.reviewerUserId ?? null,
            payload: {
              version: 1,
              prompt: `Review the proposed changes for commit ${sourceSha.slice(0, 8)} and verify that the acceptance criteria are met.`,
              acceptLabel: "Approve review",
              rejectLabel: "Request changes",
              allowDeclineReason: true,
              rejectRequiresReason: true,
              target: {
                type: "custom",
                key: "revision_keyed_review",
                revisionId: admitted.id,
                label: `Review revision ${sourceSha.slice(0, 8)}`,
              },
            },
          },
          {
            systemId: "review-admission-service",
            userId: input.actorType === "user" ? input.actorId : undefined,
          },
        );
        reviewInteractionId = interaction.id;
      } catch (err: any) {
        // If interaction creation failed, the transaction will roll back cleanly
        throw new HttpError(500, `Failed to create review interaction: ${err.message}`);
      }

      // 8. Update admission to in_review with interaction link
      const [finalAdmission] = await tx
        .update(reviewAdmissions)
        .set({
          status: "in_review",
          reviewInteractionId,
          updatedAt: new Date(),
        })
        .where(eq(reviewAdmissions.id, admitted.id))
        .returning();

      return {
        status: "admitted",
        admission: finalAdmission ?? admitted,
        created: true,
        supersededAdmissionId: priorActive?.id ?? null,
      };
    };

    if (externalTx) {
      return runInTx(externalTx);
    }
    return this.db.transaction(async (tx) => runInTx(tx));
  }

  async recordReviewDecision(
    input: {
      companyId: string;
      admissionId: string;
      decision: "accept" | "reject" | "approved" | "changes_requested" | "withdrawn";
      reason?: string | null;
      decisionReason?: string | null;
      actorId?: string | null;
      actorType?: "agent" | "user" | "system";
    },
    externalTx?: Db,
  ): Promise<{ admission: typeof reviewAdmissions.$inferSelect; completed: boolean; deduplicated?: boolean; decision: string }> {
    const runInTx = async (tx: any) => {
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
        throw new HttpError(404, "Review admission not found.", {
          code: "admission_not_found",
        });
      }

      const normalizedDecision =
        input.decision === "approved" || input.decision === "accept"
          ? "approved"
          : input.decision === "changes_requested" || input.decision === "reject"
            ? "changes_requested"
            : "withdrawn";
      const reasonText = (input.reason ?? input.decisionReason)?.trim() ?? null;

      // Immutability check: once completed, a conflicting decision is rejected
      if (admission.status === "completed") {
        if (admission.decision === normalizedDecision) {
          return { admission, completed: true, deduplicated: true, decision: admission.decision };
        }
        throw new HttpError(409, "Review decision is immutable and cannot be changed once recorded.", {
          code: "review_already_decided",
          existingDecision: admission.decision,
          attemptedDecision: normalizedDecision,
        });
      }

      if (normalizedDecision === "changes_requested" && (!reasonText || reasonText.length === 0)) {
        throw new HttpError(422, "Rejection requires specific changes to be stated in reason.", {
          code: "rejection_reason_required",
        });
      }

      const now = new Date();
      const [updated] = await tx
        .update(reviewAdmissions)
        .set({
          status: "completed",
          decision: normalizedDecision,
          decisionReason: reasonText,
          decidedAt: now,
          updatedAt: now,
        })
        .where(eq(reviewAdmissions.id, admission.id))
        .returning();

      // Resolve linked interaction if pending
      if (admission.reviewInteractionId) {
        const expectedStatus = normalizedDecision === "approved" ? "accepted" : "rejected";
        await tx
          .update(issueThreadInteractions)
          .set({
            status: expectedStatus,
            resolvedAt: now,
            updatedAt: now,
            result: {
              version: 1,
              outcome: expectedStatus,
              reason: reasonText,
            },
          })
          .where(
            and(
              eq(issueThreadInteractions.id, admission.reviewInteractionId),
              eq(issueThreadInteractions.status, "pending"),
            ),
          );
      }

      return {
        admission: updated ?? admission,
        completed: true,
        decision: normalizedDecision,
      };
    };

    if (externalTx) {
      return runInTx(externalTx);
    }
    return this.db.transaction(async (tx) => runInTx(tx));
  }

  async recoverInterruptedLaunches(
    optionsOrCompanyId?: { companyId?: string; staleThresholdMs?: number } | string,
  ): Promise<
    typeof reviewAdmissions.$inferSelect[] & {
      recoveredCount: number;
      recoveredAdmissions: typeof reviewAdmissions.$inferSelect[];
    }
  > {
    const options =
      typeof optionsOrCompanyId === "string"
        ? { companyId: optionsOrCompanyId }
        : optionsOrCompanyId ?? {};
    const companyId = options.companyId;
    const staleThresholdMs = options.staleThresholdMs ?? 0;
    const staleCutoff = staleThresholdMs > 0 ? new Date(Date.now() - staleThresholdMs) : null;

    const candidates = await this.db
      .select()
      .from(reviewAdmissions)
      .where(
        and(
          eq(reviewAdmissions.status, "admitted"),
          ...(companyId ? [eq(reviewAdmissions.companyId, companyId)] : []),
          ...(staleCutoff ? [lte(reviewAdmissions.createdAt, staleCutoff)] : []),
        ),
      );

    const recoveredAdmissions: typeof reviewAdmissions.$inferSelect[] = [];

    for (const admission of candidates) {
      await this.db.transaction(async (tx) => {
        const [locked] = await tx
          .select()
          .from(reviewAdmissions)
          .where(and(eq(reviewAdmissions.id, admission.id), eq(reviewAdmissions.status, "admitted")))
          .for("update");

        if (!locked) return;

        const [issue] = await tx
          .select()
          .from(issues)
          .where(and(eq(issues.id, locked.issueId), eq(issues.companyId, locked.companyId)));

        if (!issue) return;

        // Check if interaction was already created
        const existingInteraction = locked.reviewInteractionId
          ? await tx
              .select()
              .from(issueThreadInteractions)
              .where(eq(issueThreadInteractions.id, locked.reviewInteractionId))
              .limit(1)
              .then((rows) => rows[0] ?? null)
          : null;

        let interactionId = locked.reviewInteractionId;
        if (!existingInteraction) {
          const created = await issueThreadInteractionService(tx as unknown as Db).create(
            issue,
            {
              kind: "request_confirmation",
              idempotencyKey: `review-admission:${locked.id}`,
              title: `Review requested: ${issue.title}`,
              summary: `Review revision ${locked.sourceSha.slice(0, 8)} against acceptance criteria`,
              continuationPolicy: "none",
              resolverPolicy: locked.reviewPolicy === "human_only" ? "human_only" : "anyone",
              payload: {
                version: 1,
                prompt: `Review the proposed changes for commit ${locked.sourceSha.slice(0, 8)} and verify that the acceptance criteria are met.`,
                acceptLabel: "Approve review",
                rejectLabel: "Request changes",
                allowDeclineReason: true,
                rejectRequiresReason: true,
                target: {
                  type: "custom",
                  key: "revision_keyed_review",
                  revisionId: locked.id,
                  label: `Review revision ${locked.sourceSha.slice(0, 8)}`,
                },
              },
            },
            { systemId: "review-admission-recovery" },
          );
          interactionId = created.id;
        }

        const [recovered] = await tx
          .update(reviewAdmissions)
          .set({
            status: "in_review",
            reviewInteractionId: interactionId,
            updatedAt: new Date(),
          })
          .where(eq(reviewAdmissions.id, locked.id))
          .returning();

        if (recovered) {
          recoveredAdmissions.push(recovered);
        }
      });
    }

    return Object.assign(recoveredAdmissions, {
      recoveredCount: recoveredAdmissions.length,
      recoveredAdmissions,
    });
  }

  async getCompactReviewContext(
    companyIdOrAdmissionId: string,
    maybeAdmissionId?: string,
  ): Promise<CompactReviewContext> {
    const admissionId = maybeAdmissionId ?? companyIdOrAdmissionId;
    const companyId = maybeAdmissionId ? companyIdOrAdmissionId : undefined;
    const whereClause = companyId
      ? and(
          eq(reviewAdmissions.id, admissionId),
          eq(reviewAdmissions.companyId, companyId),
        )
      : eq(reviewAdmissions.id, admissionId);

    const admission = await this.db
      .select()
      .from(reviewAdmissions)
      .where(whereClause)
      .limit(1)
      .then((rows) => rows[0] ?? null);

    if (!admission) {
      throw new HttpError(404, "Review admission not found.", {
        code: "admission_not_found",
      });
    }

    const issue = await this.db
      .select()
      .from(issues)
      .where(and(eq(issues.id, admission.issueId), eq(issues.companyId, admission.companyId)))
      .limit(1)
      .then((rows) => rows[0] ?? null);

    if (!issue) {
      throw new HttpError(404, "Issue not found.", { code: "issue_not_found" });
    }

    const prDetails = admission.prDetails as any;
    const acceptance = admission.acceptanceContract as any;

    // Compact bounds: ensure summaries are bounded
    const title = issue.title.slice(0, 200);
    const objective = typeof acceptance?.objective === "string" ? acceptance.objective.slice(0, 500) : undefined;
    const instructions = "Inspect the PR changes against the criteria using read_pr. Submit your immutable decision using submit_review (accept or reject with specific feedback).";

    return {
      admissionId: admission.id,
      issueId: issue.id,
      identifier: issue.identifier ?? null,
      title,
      sourceSha: admission.sourceSha,
      policyDigest: admission.policyDigest,
      reviewPolicy: admission.reviewPolicy,
      pullRequest: prDetails
        ? {
            provider: prDetails.provider,
            repo: prDetails.repo,
            pullNumber: prDetails.pullNumber,
            headSha: prDetails.headSha,
            baseRef: prDetails.baseRef,
            checksSummary: prDetails.checksSummary,
          }
        : null,
      acceptanceCriteria: {
        objective,
        criteria: Array.isArray(acceptance?.criteria)
          ? acceptance.criteria.slice(0, 20).map((c: any) => ({
              id: String(c.id).slice(0, 50),
              requirement: String(c.requirement).slice(0, 500),
            }))
          : undefined,
        instructions: typeof acceptance?.instructions === "string" ? acceptance.instructions.slice(0, 500) : undefined,
      },
      instructions,
    };
  }
}

export function createReviewAdmissionService(
  db: Db,
  deliveryVerificationService?: DeliveryVerificationService,
): ReviewAdmissionService {
  return new ReviewAdmissionService(db, deliveryVerificationService);
}

export const reviewAdmissionService = createReviewAdmissionService;

