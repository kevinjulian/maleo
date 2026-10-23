-- The project command log: the editor commands that produced each storyboard version,
-- in order, at a per-project sequence issued under the storyboard version lock. A
-- writer that submits no commands records one `scope.replace`. Pruned with its version.
CREATE TABLE content_project_commands (
  project_id text NOT NULL REFERENCES content_projects(id) ON DELETE CASCADE,
  seq bigint NOT NULL,
  position integer NOT NULL,
  version bigint NOT NULL,
  command_json text NOT NULL,
  client_command_id text,
  actor_type text NOT NULL,
  created_at bigint NOT NULL,
  PRIMARY KEY (project_id, seq, position)
);
CREATE INDEX idx_content_project_commands_version ON content_project_commands(project_id, version);
CREATE UNIQUE INDEX idx_content_project_commands_client_id ON content_project_commands(project_id, client_command_id) WHERE client_command_id IS NOT NULL;
-- A submitted command the server refused, kept by identity so a retry returns the same refusal.
CREATE TABLE content_project_command_rejections (
  project_id text NOT NULL REFERENCES content_projects(id) ON DELETE CASCADE,
  client_command_id text NOT NULL,
  error_json text NOT NULL,
  created_at bigint NOT NULL,
  PRIMARY KEY (project_id, client_command_id)
);
