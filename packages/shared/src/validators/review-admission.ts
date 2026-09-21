import { z } from "zod";
import { REVIEW_ADMISSION_STATUSES } from "../types/review-admission.js";

export const reviewAdmissionStatusSchema = z.enum(REVIEW_ADMISSION_STATUSES);

export const reviewAdmissionSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  issueId: z.string().uuid(),
  sourceSha: z.string().regex(/^[0-9a-f]{7,64}$/i, "sourceSha must be a valid git SHA"),
  policyDigest: z.string().regex(/^[0-9a-f]{64}$/i, "policyDigest must be a 64-character hex SHA-256"),
  status: reviewAdmissionStatusSchema,
  acceptanceContract: z.record(z.string(), z.unknown()),
  reviewPolicy: z.string().default("anyone"),
  prDetails: z.record(z.string(), z.unknown()).optional().nullable(),
  preflightEvidence: z.record(z.string(), z.unknown()).optional().nullable(),
  supersedesAdmissionId: z.string().uuid().optional().nullable(),
  reviewerRunId: z.string().uuid().optional().nullable(),
  reviewInteractionId: z.string().uuid().optional().nullable(),
  decisionId: z.string().uuid().optional().nullable(),
  decision: z.enum(["accept", "reject", "withdrawn"]).optional().nullable(),
  decisionReason: z.string().optional().nullable(),
  decidedAt: z.union([z.date(), z.string().datetime()]).optional().nullable(),
  createdAt: z.union([z.date(), z.string().datetime()]),
  updatedAt: z.union([z.date(), z.string().datetime()]),
});

export const compactReviewContextSchema = z.object({
  admissionId: z.string().uuid(),
  issueId: z.string().uuid(),
  identifier: z.string().optional().nullable(),
  title: z.string().min(1),
  sourceSha: z.string().min(7),
  policyDigest: z.string().min(1),
  reviewPolicy: z.string(),
  pullRequest: z
    .object({
      provider: z.string(),
      repo: z.string(),
      pullNumber: z.number().int().positive(),
      headSha: z.string(),
      baseRef: z.string(),
      checksSummary: z
        .object({
          status: z.string(),
          total: z.number().int().nonnegative(),
          passed: z.number().int().nonnegative(),
          failed: z.number().int().nonnegative(),
          pending: z.number().int().nonnegative(),
        })
        .optional(),
    })
    .optional()
    .nullable(),
  acceptanceCriteria: z.object({
    objective: z.string().optional(),
    criteria: z
      .array(
        z.object({
          id: z.string(),
          requirement: z.string(),
        }),
      )
      .optional(),
    instructions: z.string().optional(),
  }),
  workProductSummary: z
    .array(
      z.object({
        id: z.string().optional(),
        kind: z.string(),
        title: z.string().optional(),
        location: z.string().optional(),
      }),
    )
    .optional(),
  instructions: z.string(),
});

export const prReadInputSchema = z.object({
  pullNumber: z.number().int().positive().optional(),
  includeDiff: z.boolean().optional().default(false),
});

export const submitReviewInputSchema = z
  .object({
    decision: z.enum(["accept", "reject"]),
    reason: z.string().trim().optional(),
    summary: z.string().trim().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.decision === "reject" && (!val.reason || val.reason.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Reason is required when rejecting a review.",
        path: ["reason"],
      });
    }
  });

export const submitReviewResultSchema = z.object({
  admissionId: z.string().uuid(),
  status: z.string(),
  decision: z.string(),
  deduplicated: z.boolean().optional(),
});
