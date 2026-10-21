-- A generation keeps one identity across retries (adopt-mastra-internal-agent 2.10).
--
-- A durable step that is re-entered after its process died calls the provider
-- again. The key — the step or tool call, plus what is being generated — lets the
-- retry find the attempt it already submitted and poll that job instead of
-- submitting another. A failed attempt gives its key up, so a retry after a real
-- failure generates again.
ALTER TABLE image_ledger ADD COLUMN generation_key text;
CREATE UNIQUE INDEX idx_image_ledger_generation_key ON image_ledger(generation_key)
  WHERE generation_key IS NOT NULL AND status <> 'failed';

-- The usage record of an unenforced billable operation is written once per
-- operation key, the same as the enforced path's capture.
ALTER TABLE usage_records ADD COLUMN idempotency_key text;
CREATE UNIQUE INDEX idx_usage_records_idempotency ON usage_records(idempotency_key)
  WHERE idempotency_key IS NOT NULL;
