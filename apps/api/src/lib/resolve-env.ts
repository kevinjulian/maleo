// Env resolution for the dashboard process.
//
// There is intentionally nothing to resolve here anymore. Runtime data
// (workspaces configs/secrets + the shared maleo.db) lives under the
// centralized data root, and core owns its resolution:
//   - MALEO_DATA_DIR  -> resolveDataDir()       (default <repo>/data)
//   - workspaces dir     -> resolveWorkspacesDir()   (<data>/workspaces)
//   - MALEO_DB_PATH   -> resolveMaleoDbPath()  (default <data>/maleo.db)
//
// The dashboard no longer spawns the `maleo` CLI, so MALEO_REPO_DIR is gone.
// This module is kept as the single side-effect import in index.ts in case
// future dashboard-local env normalization is needed; today it is a no-op.

export {};
