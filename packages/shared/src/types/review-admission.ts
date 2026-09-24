/**
 * A review admission is the durable identity of one review of one issue revision.
 *
 * An admission is written in the same transaction that launches the review, so there is
 * no window in which a review exists without its admission or the reverse. Its identity
 * is (company, issue, exact source SHA, digest of the normalized acceptance contract and
 * review policy), and the database enforces that identity as unique: the same revision
 * reviewed against the same contract admits once, and a new head or a materially changed
 * contract admits a new review linked to the one it supersedes.
 */
export const REVIEW_ADMISSION_STATUSES = [
  "in_review",
  "completed",
  "superseded",
] as const;

export type ReviewAdmissionStatus = (typeof REVIEW_ADMISSION_STATUSES)[number];

/**
 * The outcome recorded on a completed admission. These are exactly the values written to
 * `review_admissions.decision`; there is no second vocabulary.
 */
export const REVIEW_ADMISSION_DECISIONS = [
  "approved",
  "changes_requested",
  "withdrawn",
] as const;

export type ReviewAdmissionDecision = (typeof REVIEW_ADMISSION_DECISIONS)[number];

export interface ReviewAdmission {
  id: string;
  companyId: string;
  issueId: string;
  sourceSha: string;
  policyDigest: string;
  status: ReviewAdmissionStatus;
  acceptanceContract: Record<string, unknown>;
  reviewPolicy: string;
  /** The pull request identity the server held for this issue when the review launched. */
  prDetails?: Record<string, unknown> | null;
  supersedesAdmissionId?: string | null;
  reviewInteractionId?: string | null;
  /** The native status decision whose `bind_reviewer` effect launched this review. */
  decisionId?: string | null;
  decision?: ReviewAdmissionDecision | null;
  decisionReason?: string | null;
  decidedAt?: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}
