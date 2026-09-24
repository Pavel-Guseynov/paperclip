/**
 * A review admission is the durable identity of one review of one issue revision.
 *
 * An admission is written in the same transaction that launches the review, so there is
 * no window in which a review exists without its admission or the reverse. Its identity
 * is (company, issue, exact source SHA, digest of the normalized acceptance contract and
 * review policy, round), and the database enforces that identity as unique: one round of
 * one revision against one contract admits once. A new head or a materially changed
 * contract starts a new revision; a further review of an already-decided revision starts
 * a new round. Either way the new admission names the one it supersedes.
 */
export const REVIEW_ADMISSION_STATUSES = [
  "in_review",
  "completed",
  "superseded",
] as const;

export type ReviewAdmissionStatus = (typeof REVIEW_ADMISSION_STATUSES)[number];

/**
 * The outcome recorded on a completed admission. These are exactly the values the
 * service writes to `review_admissions.decision`; there is no second vocabulary, and no
 * value here that nothing writes.
 */
export const REVIEW_ADMISSION_DECISIONS = ["approved", "changes_requested"] as const;

export type ReviewAdmissionDecision = (typeof REVIEW_ADMISSION_DECISIONS)[number];

export interface ReviewAdmission {
  id: string;
  companyId: string;
  issueId: string;
  sourceSha: string;
  policyDigest: string;
  /** Which review of this revision against this contract: 1, then 2 for a further round. */
  round: number;
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
