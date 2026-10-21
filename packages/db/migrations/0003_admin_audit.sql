CREATE TABLE admin_audit (
  id text PRIMARY KEY,
  actor_id text NOT NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('success', 'refused')),
  reason text,
  created_at bigint NOT NULL
);
CREATE INDEX admin_audit_created_idx ON admin_audit (created_at DESC, id DESC);
CREATE INDEX admin_audit_actor_idx ON admin_audit (actor_id, created_at DESC);
CREATE INDEX admin_audit_target_idx ON admin_audit (target_type, target_id, created_at DESC);
