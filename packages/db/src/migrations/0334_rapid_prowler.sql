WITH ranked_retries AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY company_id, idempotency_key
      ORDER BY created_at ASC, id ASC
    ) AS row_num
  FROM agent_wakeup_requests
  WHERE idempotency_key LIKE 'review-handoff:%'
    AND status <> 'skipped'
)
UPDATE agent_wakeup_requests
SET status = 'skipped',
    updated_at = NOW()
WHERE id IN (
  SELECT id FROM ranked_retries WHERE row_num > 1
);
--> statement-breakpoint
-- paperclip:migration-safety-ignore large-create-index-not-concurrently: Drizzle migrations run transactionally, so CONCURRENTLY is unavailable. This partial unique index coalesces review-handoff retries, and only review-handoff rows match its predicate.
CREATE UNIQUE INDEX IF NOT EXISTS "agent_wakeup_requests_review_handoff_retry_idempotency_uq" ON "agent_wakeup_requests" USING btree ("company_id","idempotency_key") WHERE "agent_wakeup_requests"."idempotency_key" LIKE 'review-handoff:%' AND "agent_wakeup_requests"."status" <> 'skipped';
