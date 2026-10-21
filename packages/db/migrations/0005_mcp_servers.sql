-- MCP servers the internal agent may use (adopt-mastra-internal-agent 2.12).
--
-- One row per server per workspace, keyed by `workspace` like every tenant table,
-- so deleting a workspace removes its servers. `name` prefixes the server's tools
-- as the model sees them. Only the tools named in `allow_json` ever reach the
-- model. Request headers carry credentials, so they are stored sealed under the
-- secret store's data key, never in clear.
CREATE TABLE mcp_servers (
  id text PRIMARY KEY,
  workspace text NOT NULL,
  name text NOT NULL,
  url text NOT NULL,
  allow_json text NOT NULL,
  headers_sealed text,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  UNIQUE (workspace, name)
);
