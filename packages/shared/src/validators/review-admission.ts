import { z } from "zod";
import {
  REVIEW_ADMISSION_DECISIONS,
  REVIEW_ADMISSION_STATUSES,
} from "../types/review-admission.js";

export const reviewAdmissionStatusSchema = z.enum(REVIEW_ADMISSION_STATUSES);

/** The single decision vocabulary — the same values the database column stores. */
export const reviewAdmissionDecisionSchema = z.enum(REVIEW_ADMISSION_DECISIONS);

export const reviewAdmissionSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  issueId: z.string().uuid(),
  sourceSha: z.string().regex(/^[0-9a-f]{40}$/i, "sourceSha must be a full 40-character git SHA"),
  policyDigest: z.string().regex(/^[0-9a-f]{64}$/i, "policyDigest must be a 64-character hex SHA-256"),
  status: reviewAdmissionStatusSchema,
  acceptanceContract: z.record(z.string(), z.unknown()),
  reviewPolicy: z.string(),
  prDetails: z.record(z.string(), z.unknown()).optional().nullable(),
  supersedesAdmissionId: z.string().uuid().optional().nullable(),
  reviewInteractionId: z.string().uuid().optional().nullable(),
  decisionId: z.string().uuid().optional().nullable(),
  decision: reviewAdmissionDecisionSchema.optional().nullable(),
  decisionReason: z.string().optional().nullable(),
  decidedAt: z.union([z.date(), z.string().datetime()]).optional().nullable(),
  createdAt: z.union([z.date(), z.string().datetime()]),
  updatedAt: z.union([z.date(), z.string().datetime()]),
});
