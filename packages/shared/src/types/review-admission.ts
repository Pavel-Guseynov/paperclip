export const REVIEW_ADMISSION_STATUSES = [
  "admitted",
  "in_review",
  "completed",
  "superseded",
  "cancelled",
] as const;

export type ReviewAdmissionStatus = (typeof REVIEW_ADMISSION_STATUSES)[number];

export interface ReviewAdmission {
  id: string;
  companyId: string;
  issueId: string;
  sourceSha: string;
  policyDigest: string;
  status: ReviewAdmissionStatus;
  acceptanceContract: Record<string, unknown>;
  reviewPolicy: string;
  prDetails?: Record<string, unknown> | null;
  preflightEvidence?: Record<string, unknown> | null;
  supersedesAdmissionId?: string | null;
  reviewerRunId?: string | null;
  reviewInteractionId?: string | null;
  decisionId?: string | null;
  decision?: "accept" | "reject" | "withdrawn" | null;
  decisionReason?: string | null;
  decidedAt?: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface CompactReviewContext {
  admissionId: string;
  issueId: string;
  identifier?: string | null;
  title: string;
  sourceSha: string;
  policyDigest: string;
  reviewPolicy: string;
  pullRequest?: {
    provider: string;
    repo: string;
    pullNumber: number;
    headSha: string;
    baseRef: string;
    checksSummary?: {
      status: string;
      total: number;
      passed: number;
      failed: number;
      pending: number;
    };
  } | null;
  acceptanceCriteria: {
    objective?: string;
    criteria?: Array<{ id: string; requirement: string }>;
    instructions?: string;
  };
  workProductSummary?: Array<{
    id?: string;
    kind: string;
    title?: string;
    location?: string;
  }>;
  instructions: string;
}

export interface PRReadInput {
  pullNumber?: number;
  includeDiff?: boolean;
}

export interface PRReadResult {
  pullNumber: number;
  provider: string;
  repo: string;
  title: string;
  state: string;
  headSha: string;
  baseRef: string;
  changedFiles?: number;
  additions?: number;
  deletions?: number;
  diffSummary?: string;
  checksSummary?: {
    status: string;
    total: number;
    passed: number;
    failed: number;
    pending: number;
  };
}

export interface SubmitReviewInput {
  decision: "accept" | "reject";
  reason?: string;
  summary?: string;
}

export interface SubmitReviewResult {
  admissionId: string;
  status: string;
  decision: string;
  deduplicated?: boolean;
}
