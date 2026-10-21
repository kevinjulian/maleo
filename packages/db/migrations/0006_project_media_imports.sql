-- Upload quarantine is project-owned and invisible to the ready media registry.
CREATE TABLE project_media_imports (
  id text PRIMARY KEY,
  workspace text NOT NULL,
  project_id text NOT NULL REFERENCES content_projects(id) ON DELETE CASCADE,
  request_key text NOT NULL,
  original_filename text NOT NULL,
  claimed_kind text NOT NULL CHECK (claimed_kind IN ('image', 'video', 'audio')),
  source_revision text NOT NULL,
  status text NOT NULL CHECK (status IN ('uploading', 'processing', 'ready', 'failed', 'cancelled')),
  original_json text,
  worker_job_id text,
  asset_json text,
  error text,
  lease_until bigint NOT NULL,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  UNIQUE (workspace, project_id, request_key)
);
CREATE INDEX idx_project_media_imports_project ON project_media_imports(project_id, created_at);
