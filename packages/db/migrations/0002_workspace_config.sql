-- Workspace configuration moves from data/workspaces/<ws>/config.yaml into the
-- database (migrate-to-postgres, workspace-configuration-storage).
--
-- One row per workspace holding the configuration document. It is stored as the
-- YAML text an operator edits, not re-serialised JSON, because the settings
-- surface rewrites one block at a time through a parsed document and an
-- operator's comments and key order survive that rewrite. The document is
-- validated against the workspace schema before it is written, so a stored row
-- is always a valid configuration.
--
-- Keyed by the `workspace` column like every tenant table, so deleting a
-- workspace removes its configuration with the rest of its rows.
--
-- No credential is stored here: secrets stay in the encrypted secret store,
-- and a write naming a credential-shaped key is refused.
CREATE TABLE workspace_config (
  workspace text PRIMARY KEY,
  config_yaml text NOT NULL,
  updated_at bigint NOT NULL
);

-- The registry pointed at the file. There is no file.
ALTER TABLE workspaces DROP COLUMN config_path;
