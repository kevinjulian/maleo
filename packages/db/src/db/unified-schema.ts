import { Database } from "bun:sqlite";

// Single-DB runtime schema. Every per-workspace memory table (formerly each
// workspace's db.sqlite) lives here, scoped by a `workspace` column instead of by
// file. Reconciled from three historical sources: core memory/db.ts SCHEMA +
// MIGRATIONS (fully-migrated shape), dashboard workspace-db.ts open block
// (image_generation_log, replies.image_url), and the read-model mirror column
// lists.
//
// Key rules:
//  - UUID-keyed tables keep `id TEXT PRIMARY KEY` (UUIDs are globally unique)
//    and add `workspace TEXT NOT NULL` plus a workspace-scoped index.
//  - Natural-key tables (post_id + fetched_at, suppressed_ref) get a composite
//    PRIMARY KEY that includes workspace.
//  - `action_id` uniqueness becomes per-workspace: UNIQUE(workspace, action_id).
//  - `drafts.campaign_id` links a draft to a campaign directly (replaces the
//    ticket layer).
//
// Idempotent: safe to run on every open via CREATE TABLE/INDEX IF NOT EXISTS.
//
// Table renames (2026-08-18): `workspace_settings` → `global_settings`. Despite
// the old name it was never workspace-scoped — its primary key is `key` alone,
// with no workspace column — and it holds app-level configuration: the media
// provider choice, the default content preset, and the AI text provider
// selection. Existing databases are migrated by renameWorkspaceSettingsTable
// below, which MUST run before the CREATE statements: `CREATE TABLE IF NOT
// EXISTS global_settings` on a pre-rename database would create an empty second
// table beside the populated one and every stored setting would read back as
// missing, with nothing raised anywhere. See ADR 0004.
export const UNIFIED_SCHEMA = `
CREATE TABLE IF NOT EXISTS workspaces (
  name TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  workspace_dir TEXT NOT NULL,
  config_path TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_synced_at INTEGER,
  color TEXT,
  color_bright TEXT,
  color_deep TEXT,
  tagline TEXT,
  initials TEXT,
  /* Prose an owner writes for other people, and NOT a second spelling of
   * tagline above it.
   *
   * tagline is branding: deriveBranding() invents one from a name hash when the
   * column is null, and the switcher chip renders it. A description is blank
   * until somebody types it, and stays blank. One field that fills itself in
   * and one that must not cannot be the same field -- collapsing them would
   * mean either a description nobody wrote or a chip with nothing in it. */
  description TEXT
);
CREATE INDEX IF NOT EXISTS idx_workspaces_status ON workspaces(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  goal TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  workspaces_json TEXT,
  budget_json TEXT,
  start_at INTEGER,
  end_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS approval_decisions (
  id TEXT PRIMARY KEY,
  workspace TEXT,
  draft_id TEXT NOT NULL,
  decision TEXT NOT NULL,
  reason_code TEXT,
  notes TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_approval_draft ON approval_decisions(workspace, draft_id, created_at DESC);

CREATE TABLE IF NOT EXISTS routines (
  id TEXT PRIMARY KEY,
  workspace TEXT NOT NULL,
  name TEXT NOT NULL,
  schedule TEXT NOT NULL,
  action TEXT NOT NULL,
  instruction TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  last_run_at INTEGER,
  next_run_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_routines_due ON routines(enabled, next_run_at);
CREATE INDEX IF NOT EXISTS idx_routines_workspace ON routines(workspace, updated_at DESC);

CREATE TABLE IF NOT EXISTS credit_accounts (
  id TEXT PRIMARY KEY,
  scope_type TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  available_credits INTEGER NOT NULL DEFAULT 0,
  reserved_credits INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(scope_type, scope_id)
);

CREATE TABLE IF NOT EXISTS credit_policies (
  id TEXT PRIMARY KEY,
  scope_type TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  daily_limit_credits INTEGER,
  rolling_5h_limit_credits INTEGER,
  per_run_limit_credits INTEGER,
  require_approval_above_credits INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(scope_type, scope_id)
);

CREATE TABLE IF NOT EXISTS credit_reservations (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  reference_type TEXT NOT NULL,
  reference_id TEXT NOT NULL,
  requested_credits INTEGER NOT NULL,
  reserved_credits INTEGER NOT NULL,
  captured_credits INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  expires_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(account_id, reference_type, reference_id)
);

CREATE TABLE IF NOT EXISTS credit_transactions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  type TEXT NOT NULL,
  amount_credits INTEGER NOT NULL,
  balance_available_after INTEGER NOT NULL,
  balance_reserved_after INTEGER NOT NULL,
  reference_type TEXT,
  reference_id TEXT,
  idempotency_key TEXT UNIQUE,
  description TEXT,
  metadata_json TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_account_created ON credit_transactions(account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS usage_records (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  reservation_id TEXT,
  operation TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  quantity REAL NOT NULL,
  unit TEXT NOT NULL,
  provider_cost_usd REAL NOT NULL DEFAULT 0,
  charged_credits INTEGER NOT NULL,
  pricing_version TEXT NOT NULL,
  metadata_json TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_usage_records_account_created ON usage_records(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_records_operation_created ON usage_records(operation, created_at DESC);

CREATE TABLE IF NOT EXISTS drafts (
  workspace TEXT NOT NULL,
  id TEXT PRIMARY KEY,
  action_id TEXT NOT NULL,
  parent_draft_id TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  action TEXT NOT NULL,
  reasoning TEXT NOT NULL,
  content TEXT,
  reply_to_id TEXT,
  scheduled_for INTEGER,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  ttl_at INTEGER,
  campaign_id TEXT,
  image_urls_json TEXT,
  thread_image_urls_json TEXT,
  thread_drafts_json TEXT,
  thought_id TEXT,
  codex_invocation_id TEXT,
  reject_score INTEGER,
  reject_notes TEXT,
  video_product_json TEXT,
  video_job_id TEXT,
  product_snapshot_json TEXT,
  video_status TEXT,
  video_output_path TEXT,
  video_output_url TEXT,
  video_thumbnail_path TEXT,
  video_manifest_path TEXT,
  video_duration_sec REAL,
  video_preset TEXT,
  video_updated_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_drafts_action ON drafts(workspace, action_id);
CREATE INDEX IF NOT EXISTS idx_drafts_status ON drafts(workspace, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_drafts_thought ON drafts(workspace, thought_id);
CREATE INDEX IF NOT EXISTS idx_drafts_campaign ON drafts(workspace, campaign_id);

CREATE TABLE IF NOT EXISTS posts (
  workspace TEXT NOT NULL,
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  platform_post_id TEXT,
  content TEXT NOT NULL,
  posted_at INTEGER NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  verified_status TEXT,
  verified_detail TEXT,
  verified_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_posts_posted_at ON posts(workspace, posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_draft_platform ON posts(workspace, draft_id, platform);

CREATE TABLE IF NOT EXISTS metrics (
  workspace TEXT NOT NULL,
  post_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  likes INTEGER NOT NULL DEFAULT 0,
  replies INTEGER NOT NULL DEFAULT 0,
  reposts INTEGER NOT NULL DEFAULT 0,
  views INTEGER NOT NULL DEFAULT 0,
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (workspace, post_id, fetched_at)
);

CREATE TABLE IF NOT EXISTS replies (
  workspace TEXT NOT NULL,
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  platform_reply_id TEXT,
  author TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  responded_at INTEGER,
  response_draft_id TEXT,
  thread_depth INTEGER NOT NULL DEFAULT 0,
  sentiment TEXT,
  sentiment_at INTEGER,
  response_status TEXT,
  response_reason TEXT,
  image_url TEXT
);
CREATE INDEX IF NOT EXISTS idx_replies_created ON replies(workspace, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_replies_platform_reply_id ON replies(platform_reply_id);

CREATE TABLE IF NOT EXISTS directives (
  workspace TEXT NOT NULL,
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  consumed_at INTEGER,
  max_injections INTEGER NOT NULL DEFAULT 1,
  injections_used INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_directives_workspace ON directives(workspace, status);










CREATE TABLE IF NOT EXISTS scenarios (
  workspace TEXT NOT NULL,
  id TEXT PRIMARY KEY,
  situation TEXT NOT NULL,
  workspace_response TEXT NOT NULL,
  reasoning TEXT NOT NULL,
  category TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  notes TEXT,
  decided_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scenarios_status ON scenarios(workspace, status);
CREATE INDEX IF NOT EXISTS idx_scenarios_created ON scenarios(workspace, created_at DESC);




CREATE TABLE IF NOT EXISTS image_generation_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace TEXT NOT NULL,
  kind TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  channel TEXT,
  cost_usd REAL
);
CREATE INDEX IF NOT EXISTS idx_image_gen_log_created ON image_generation_log(workspace, created_at DESC);

CREATE TABLE IF NOT EXISTS video_generation_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace TEXT NOT NULL,
  kind TEXT NOT NULL,
  channel TEXT,
  cost_usd REAL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_video_gen_log_created ON video_generation_log(workspace, created_at DESC);

-- prompt_library is GONE. It was UNIQUE(workspace, prompt) with image_url merged
-- via COALESCE on conflict, so it held one row per PROMPT and a regenerated prompt
-- overwrote its own previous image. It carried no project_id, and only one of the
-- four image producers ever wrote to it. image_ledger replaces it.
--
-- Deliberately not dropped: an existing database still has the table, and the
-- one-time backfill that migrated those rows into image_ledger has run. Removing
-- it here only stops a FRESH database from creating it; the rows the recovery
-- produced are already in image_ledger, marked with its backfilled column.

-- One row per GENERATION ATTEMPT, opened before the provider is called and resolved
-- when the attempt concludes. Not one row per prompt: prompt_library was
-- UNIQUE(workspace, prompt) and merged the url on conflict, so regenerating a prompt
-- overwrote the previous image and no project_id was carried anywhere.
--
-- The table is still named image_ledger, but it records more than images. medium
-- names what a row recorded ('image' | 'speech'), and every read scopes by it -- see
-- db/image-ledger.ts, where that predicate lives so no call site can forget it and
-- leak one medium into the other's gallery.
--
-- The row is opened before the call, not at completion, because that is what makes
-- attribution durable. Attribution used to live in an in-memory Map keyed by job id,
-- so an API restart between submit and completion lost it and the completion handler
-- silently skipped every write. This holds for synchronous producers too: speech
-- returns inside one request, but generation is metered BEFORE the response is
-- written, so a single write-on-success would let billed spend leave no artifact row
-- at all when a process dies mid-request.
--
-- status is the lifecycle: pending -> completed | failed. Only completed rows are
-- artifacts; pending and failed are operational state and must never render.
-- deleted_at is a soft hide -- this row is the artifact side of billed spend, so
-- tidying a gallery must not make that spend unattributable.
--
-- source distinguishes the producers, and its vocabulary is per medium: an image is
-- lab|clip|reference|agent, speech is lab|scene|agent. There is no reference speech,
-- so a flat union would let a Speech filter offer a value that always returns
-- nothing. project_id is NULL for workspace-scoped generations and means exactly
-- that, not "unknown".
--
-- asset_url locates the artifact for every medium. aspect is image-only; voice,
-- provider and duration_sec are speech-only. An absent medium-specific column means
-- the medium does not have that attribute, not that it is unknown.
CREATE TABLE IF NOT EXISTS image_ledger (
  id TEXT PRIMARY KEY,
  workspace TEXT NOT NULL,
  project_id TEXT,
  medium TEXT NOT NULL DEFAULT 'image',
  source TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  prompt TEXT,
  asset_url TEXT,
  aspect TEXT,
  voice TEXT,
  provider TEXT,
  duration_sec REAL,
  job_id TEXT,
  backfilled INTEGER NOT NULL DEFAULT 0,
  starred INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER,
  deleted_at INTEGER
);
-- Resolution is idempotent on job id: a doubly-polled completion must not open a
-- second row. Partial, because backfilled rows have no job id and would otherwise
-- collide with each other on NULL.
CREATE UNIQUE INDEX IF NOT EXISTS idx_image_ledger_job ON image_ledger(job_id) WHERE job_id IS NOT NULL;
-- Historical backfill is complete. Distinct ledger rows may now share one
-- content-addressed media URL while retaining their own attempt/provenance ids.
-- The gallery's three read shapes, each led by medium because every one of them is
-- asked for one medium at a time. created_at DESC because every one is newest-first.
CREATE INDEX IF NOT EXISTS idx_image_ledger_created ON image_ledger(medium, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_image_ledger_workspace ON image_ledger(medium, workspace, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_image_ledger_project ON image_ledger(medium, project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS image_jobs (
  workspace TEXT NOT NULL,
  job_id TEXT PRIMARY KEY,
  prompt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  image_url TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_image_jobs_status ON image_jobs(workspace, status);

-- App-global key/value settings. Named workspace_settings until this table
-- gained the AI provider choice; the primary key is "key" alone, with no
-- workspace column, so it was never workspace-scoped. Existing databases are
-- renamed in place by renameWorkspaceSettingsTable before this CREATE runs.
CREATE TABLE IF NOT EXISTS global_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- The three library tables below share an identity pair: id is the local relational
-- key every reference stores, and slug is the immutable logical key shipped fixtures
-- are found and updated by. A fixture may hold a different id on two databases; it
-- holds the same slug on both, which is what lets bootstrap rewrite a shipped row
-- without disturbing anything that points at it.
--
-- slug is nullable because rows written before it existed have none, and the unique
-- indexes are partial (WHERE slug IS NOT NULL) so those rows do not all collide on
-- NULL. source separates a shipped row from an operator's; retired marks a fixture
-- whose slug stopped shipping, which stays resolvable by id for whatever still
-- references it but leaves every list. fixture_rank is the order the fixtures are
-- declared in code, so a list can put shipped rows first in a stable order --
-- ordering them by updated_at would reshuffle the library on every bootstrap.
CREATE TABLE IF NOT EXISTS content_timeline_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  template_json TEXT NOT NULL,
  slug TEXT,
  source TEXT NOT NULL DEFAULT 'user',
  retired INTEGER NOT NULL DEFAULT 0,
  fixture_rank INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_content_timeline_templates_updated ON content_timeline_templates(updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_content_timeline_templates_slug ON content_timeline_templates(slug) WHERE slug IS NOT NULL;

CREATE TABLE IF NOT EXISTS content_presets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  preset_json TEXT NOT NULL,
  slug TEXT,
  source TEXT NOT NULL DEFAULT 'user',
  retired INTEGER NOT NULL DEFAULT 0,
  fixture_rank INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_content_presets_updated ON content_presets(updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_content_presets_slug ON content_presets(slug) WHERE slug IS NOT NULL;

-- Reusable materials: the generation context (Story, Visual, Voice, Rules) a
-- project selects and a Project Preset names per group. Tenant-scoped like every
-- other row carrying operator writing — a brief is exactly the kind of content a
-- workspace must not leak. The DEFAULT exists so reconcileColumns can add the
-- column to a database that predates it without a nullable window.
--
-- Fixture materials are the one exception to the scoping: they are stored once in
-- the reserved empty workspace and read alongside whichever workspace is asking.
-- Presets are global, so a fixture preset bundle naming a per-workspace material id
-- could only ever name one workspace's copy.
CREATE TABLE IF NOT EXISTS content_materials (
  id TEXT PRIMARY KEY,
  workspace TEXT NOT NULL DEFAULT 'default',
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  material_group TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  asset_ids_json TEXT NOT NULL DEFAULT '[]',
  reference_settings_json TEXT NOT NULL DEFAULT '[]',
  slug TEXT,
  source TEXT NOT NULL DEFAULT 'user',
  retired INTEGER NOT NULL DEFAULT 0,
  fixture_rank INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_content_materials_workspace ON content_materials(workspace, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_materials_group ON content_materials(workspace, material_group, updated_at DESC);
-- Scoped by workspace: fixtures all sit in the reserved empty workspace, so this
-- makes fixture slugs unique database-wide and user slugs unique per workspace.
CREATE UNIQUE INDEX IF NOT EXISTS idx_content_materials_slug ON content_materials(workspace, slug) WHERE slug IS NOT NULL;

CREATE TABLE IF NOT EXISTS content_motion_presets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  keyframes_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_content_motion_presets_updated ON content_motion_presets(updated_at DESC);

CREATE TABLE IF NOT EXISTS content_clip_templates (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  intent TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL,
  base TEXT NOT NULL,
  config_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_content_clip_templates_updated ON content_clip_templates(updated_at DESC);

CREATE TABLE IF NOT EXISTS content_projects (
  id TEXT PRIMARY KEY,
  workspace TEXT NOT NULL DEFAULT 'default',
  title TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  target_platform TEXT,
  target_audience TEXT,
  target_duration_sec INTEGER,
  target_format TEXT,
  language TEXT,
  campaign_id TEXT,
  brief_json TEXT,
  reference_notes TEXT,
  editor_state_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_content_projects_status ON content_projects(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_projects_workspace ON content_projects(workspace, updated_at DESC);

CREATE TABLE IF NOT EXISTS content_storyboards (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  source_prompt TEXT,
  reference_notes TEXT,
  storyboard_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_content_storyboards_version ON content_storyboards(project_id, version);
CREATE INDEX IF NOT EXISTS idx_content_storyboards_project ON content_storyboards(project_id, created_at DESC);

-- content_references is GONE. It held one concept across two orthogonal axes
-- (asset type and scene role) in a free-text kind column, so every consumer re-derived
-- role with its own filter and the filters disagreed. Its contents were split into
-- the stores that model them: reference_entity + project_reference (castable
-- subjects), project_note, project_speaker, project_style_lock, project_citation.

CREATE TABLE IF NOT EXISTS content_renders (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  output_id TEXT,
  storyboard_id TEXT,
  draft_id TEXT,
  video_job_id TEXT,
  status TEXT NOT NULL,
  phase TEXT,
  output_path TEXT,
  output_url TEXT,
  manifest_path TEXT,
  duration_sec REAL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_content_renders_project ON content_renders(project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_renders_output ON content_renders(output_id, updated_at DESC);
-- Storyboard retention asks "does a render point at this version?" once per version.
CREATE INDEX IF NOT EXISTS idx_content_renders_storyboard ON content_renders(storyboard_id);

CREATE TABLE IF NOT EXISTS content_project_outputs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  storyboard_id TEXT,
  channel TEXT,
  platform TEXT,
  kind TEXT NOT NULL DEFAULT 'draft',
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  draft_id TEXT,
  render_id TEXT,
  publish_job_id TEXT,
  content_json TEXT,
  notes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_content_outputs_project ON content_project_outputs(project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_outputs_storyboard ON content_project_outputs(storyboard_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS content_project_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  output_id TEXT,
  storyboard_id TEXT,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  kind TEXT NOT NULL,
  summary TEXT NOT NULL,
  payload_json TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_content_project_events_project ON content_project_events(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_project_events_output ON content_project_events(output_id, created_at DESC);

CREATE TABLE IF NOT EXISTS content_assets (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL DEFAULT 'workspace',
  campaign_id TEXT,
  project_id TEXT,
  workspace TEXT,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  tags_json TEXT,
  note TEXT,
  seed INTEGER NOT NULL DEFAULT 0,
  is_default INTEGER NOT NULL DEFAULT 0,
  src TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'manual',
  origin TEXT NOT NULL DEFAULT 'linked',
  source_ref TEXT,
  collection TEXT,
  item_id TEXT,
  meta_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_content_assets_source ON content_assets(source_type, source_ref);
CREATE INDEX IF NOT EXISTS idx_content_assets_scope ON content_assets(scope, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_assets_kind ON content_assets(kind, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_assets_project ON content_assets(project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_assets_campaign ON content_assets(campaign_id, updated_at DESC);

-- The workspace-scoped reference entity: one row per castable subject. Owns its
-- own identity (the PK is the only id — no client-generated key nested in JSON),
-- its role on a CHECK-constrained column, one canonical image, and a written
-- description that reaches the generation reference map.
--
-- The role column is the SCENE-ROLE axis only. Never store an asset type (note,
-- audio, research, image, video): conflating both axes in content_references.kind
-- is what forced five divergent filter/fallback implementations, two of which
-- disagreed on what an unknown value meant.
CREATE TABLE IF NOT EXISTS reference_entity (
  id TEXT PRIMARY KEY,
  workspace TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('style', 'character', 'location', 'product', 'prop')),
  label TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  canonical_image_url TEXT,
  tags_json TEXT,
  origin TEXT NOT NULL DEFAULT 'linked',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reference_entity_workspace_role ON reference_entity(workspace, role, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_reference_entity_workspace_label ON reference_entity(workspace, label);

-- A workspace's cloned TTS voices: one row per voice an operator supplied as a
-- recording, for a provider that imitates an audio prompt rather than selecting
-- a speaker from a catalogue.
--
-- NOT a reference_entity row with role='voice'. That table is the SCENE-ROLE
-- axis — the roster of castable subjects — and content_references was split
-- precisely because it conflated that axis with the asset's medium. Filing a
-- voice there, with a wav in canonical_image_url, re-merges what the split paid
-- for.
--
-- The id is the voice identity everywhere a voice identity already travels:
-- stored selections, the media-worker cache key, storySpeechInputHash, and the
-- speech ledger. ref_url is resolved to bytes once, at the provider boundary,
-- and never carried beside the id through the layers above it.
--
-- ref_url is therefore IMMUTABLE in practice: re-recording mints a new clone
-- with a new id rather than replacing the audio under an existing one. A voice
-- whose sound changed while its id did not would leave every cache entry and
-- staleness hash naming it silently wrong.
--
-- provider_id is NOT NULL because cloning belongs to a model, not to TTS. A
-- clone offered under a provider that cannot speak it is a voice that fails at
-- the point of use.
--
-- deleted_at is a soft delete, matching content_assets: a removed clone leaves
-- every listing, but a metered synthesis that names it must stay attributable.
CREATE TABLE IF NOT EXISTS voice_clone (
  id TEXT PRIMARY KEY,
  workspace TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  label TEXT NOT NULL,
  lang TEXT NOT NULL,
  gender TEXT CHECK (gender IS NULL OR gender IN ('male', 'female')),
  ref_url TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_voice_clone_workspace ON voice_clone(workspace, provider_id, created_at DESC);

-- A project's selection of workspace reference entities. Pure join: it holds NO
-- copy of the entity's role, label, description, or image, so editing an entity
-- propagates everywhere instead of forking per project.
--
-- This replaces content_references as the project-reference surface. The old
-- table stored a full copy per project, keyed by a client-generated id nested in
-- meta_json, with kind in its dedupe key — which is how (a) editing a role
-- inserted a duplicate instead of updating, and (b) two references sharing a
-- source_url could overwrite each other's identity.
--
-- The unique index uses ifnull(scene_key,'') deliberately: SQLite treats NULLs as
-- distinct, so a plain UNIQUE(project_id, entity_id, scene_key) would still admit
-- duplicate project-level selections.
--
-- No FOREIGN KEY clause: this schema declares none anywhere and never enables
-- PRAGMA foreign_keys, so one here would be inert. entity_id/project_id integrity
-- is enforced in the accessors.
-- is_primary marks the project's lead subject, inherited into any scene whose cast
-- is empty (roster >= 2). It lives here, not on reference_entity, because primacy
-- is per-project: the same character can be the lead in one project and background
-- in another.
CREATE TABLE IF NOT EXISTS project_reference (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  scene_key TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_reference_unique ON project_reference(project_id, entity_id, ifnull(scene_key, ''));
CREATE INDEX IF NOT EXISTS idx_project_reference_project ON project_reference(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_reference_entity ON project_reference(entity_id);

-- Text-only project notes. Formerly content_references rows with kind='note' /
-- kind='audio', which made them resolvable as cast even though they carry no
-- image. They are project state, not library entities.
CREATE TABLE IF NOT EXISTS project_note (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  label TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  tags_json TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_project_note_project ON project_note(project_id, created_at DESC);

-- Refs suppressed from the reference library.
--
-- Needed because listContentCatalogueImages RE-DERIVES workspace-collection assets
-- from disk on every read, so deleting such an asset is undone on the next call.
-- Suppression used to be a fake content_assets row (source_type='reference_deleted',
-- src='__deleted_reference__') which polluted the asset table, collided with the
-- UNIQUE(source_type, source_ref) index, and forced every catalogue read to scan
-- assets and test three columns for a match.
--
-- Mirror-derived assets do NOT need an entry here: they are removed outright by
-- deleteMirroredContentReferenceAssets and nothing re-derives them.
-- Suppression is per WORKSPACE. Keyed on suppressed_ref alone, one tenant
-- deleting a reference hid it for every tenant, and two tenants deleting an
-- item that shares an id silently collapsed into one row — the second
-- suppression was dropped by ON CONFLICT and that workspace's asset came back
-- on the next catalogue read.
--
-- workspace = '' marks a LEGACY row, written before suppression was scoped.
-- Those apply everywhere, because the workspace they were made under was not
-- recorded and guessing it would resurrect references an operator deleted.
CREATE TABLE IF NOT EXISTS asset_suppression (
  suppressed_ref TEXT NOT NULL,
  workspace TEXT NOT NULL DEFAULT '',
  reason TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (suppressed_ref, workspace)
);

-- A project's voice cast. Formerly content_references rows with kind='audio',
-- where label held the voice name, voice_key the opaque provider key, and
-- meta_json {default, hue} the display state ("Voices are opaque keys stored on
-- content_references.voice_key; no table needed").
--
-- A speaker is an AUDIO identity and is deliberately NOT a reference entity: it
-- carries no image and can never be cast into a frame. Keeping it in the reference
-- table is also where the "cast" name collision came from: the UI's Cast meant
-- voice actor while the generation CastEntity meant visual subject.
CREATE TABLE IF NOT EXISTS project_speaker (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  voice_key TEXT NOT NULL,
  name TEXT NOT NULL,
  hue INTEGER,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_speaker_unique ON project_speaker(project_id, voice_key);
CREATE INDEX IF NOT EXISTS idx_project_speaker_project ON project_speaker(project_id, created_at ASC);

-- Per-project generated style lock ("style bible"): the visual-style text plus the
-- optional style-board image. Real state, not a library entry — later jobs read it
-- back so a project keeps one look instead of regenerating a divergent one.
--
-- Formerly 6,270 content_references rows, ALL sharing the logical id
-- 'style-bible' (one per project, differing only by job_id). Living in the
-- reference table made a per-project generated plate look like a reusable library
-- entry. One row per project is the honest shape.
CREATE TABLE IF NOT EXISTS project_style_lock (
  project_id TEXT PRIMARY KEY,
  visual_style TEXT NOT NULL DEFAULT '',
  board_image_url TEXT,
  updated_at INTEGER NOT NULL
);

-- Agent-cited research sources. Formerly stored as content_references rows with
-- kind='research', which put citations in the castable reference library: they
-- reached projectRoster and could bind as a subject reference at generation.
-- Citations keep the durability/queryability that motivated the original design
-- (a Sources panel survives research_bundle artifact churn) without being cast.
CREATE TABLE IF NOT EXISTS project_citation (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  excerpt TEXT,
  topic TEXT,
  job_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_project_citation_project ON project_citation(project_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_citation_url ON project_citation(project_id, url);

-- WP3: DB-first durable run model. workflow_run is the source of truth for an
-- agent run; snapshot_json holds the full serialized AgentJob so a parked or
-- running run rehydrates with full fidelity on any instance (not just
-- awaiting_input checkpoints). step_run/tool_run/artifact/required_action give
-- durable, queryable per-step + per-tool records (WP5).
CREATE TABLE IF NOT EXISTS workflow_run (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  workspace_id TEXT,
  content_type TEXT NOT NULL,
  status TEXT NOT NULL,
  cursor INTEGER NOT NULL DEFAULT 0,
  instruction TEXT NOT NULL DEFAULT '',
  snapshot_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workflow_run_project ON workflow_run(project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_run_status ON workflow_run(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS step_run (
  id TEXT PRIMARY KEY,
  workflow_run_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  tool_name TEXT NOT NULL,
  status TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 0,
  input_json TEXT,
  output_json TEXT,
  error_code TEXT,
  error_message TEXT,
  retry_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_step_run_workflow ON step_run(workflow_run_id, idx);

CREATE TABLE IF NOT EXISTS tool_run (
  id TEXT PRIMARY KEY,
  step_run_id TEXT,
  workflow_run_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  status TEXT NOT NULL,
  input_json TEXT,
  output_json TEXT,
  error_json TEXT,
  cost REAL,
  idempotency_key TEXT,
  artifacts_json TEXT,
  latency_ms INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tool_run_workflow ON tool_run(workflow_run_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tool_run_idempotency ON tool_run(idempotency_key);

CREATE TABLE IF NOT EXISTS run_artifact (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  tool_run_id TEXT,
  logical_ref TEXT,
  parent_artifact_id TEXT,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready',
  storage_key TEXT,
  public_url TEXT,
  metadata_json TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_run_artifact_project ON run_artifact(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_run_artifact_tool ON run_artifact(tool_run_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_run_artifact_logical_ref ON run_artifact(project_id, logical_ref, version DESC);

CREATE TABLE IF NOT EXISTS required_action (
  id TEXT PRIMARY KEY,
  workflow_run_id TEXT NOT NULL,
  type TEXT NOT NULL,
  step INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  payload_json TEXT,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_required_action_workflow ON required_action(workflow_run_id, created_at DESC);

/* Which accounts may act in which workspace.
 *
 * Declared HERE, not by the auth library, and that is the whole point. The
 * library's own tenancy plugin brings a second identifier for a workspace --
 * its organization.id beside our workspaces.name -- and roughly forty tables
 * are partitioned by ours. Two identifiers for one concept is a sync nobody
 * owns. So membership joins the partition key we already have to an account id
 * we borrow.
 *
 * user_id is a loose reference to the auth library's user row with NO foreign
 * key, deliberately: the two schemas migrate independently (see
 * AUTH_OWNED_TABLES below) and a constraint across that line would couple them.
 * Orphan rows are unreachable rather than dangerous -- the registry check
 * refuses a request naming an absent workspace before membership is read -- and
 * the registry sync deletes them anyway. */
CREATE TABLE IF NOT EXISTS workspace_members (
  workspace TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (workspace, user_id)
);
CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON workspace_members(user_id, workspace);

CREATE TABLE IF NOT EXISTS media_objects (
  id TEXT PRIMARY KEY,
  workspace TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('image', 'audio', 'video', 'manifest', 'file')),
  hash TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  /* hash is recorded, not identity: object keys are unique per write, so
   * identical bytes legitimately appear under several keys and rows. Only the
   * key is unique. See migrateMediaObjectHashUniqueness. */
  UNIQUE (storage_key)
);
CREATE TABLE IF NOT EXISTS legacy_media_links (
  legacy_path TEXT NOT NULL,
  workspace TEXT NOT NULL,
  media_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (legacy_path, workspace)
);
CREATE INDEX IF NOT EXISTS idx_legacy_media_links_media ON legacy_media_links(media_id);
CREATE INDEX IF NOT EXISTS idx_media_objects_workspace ON media_objects(workspace, created_at);

/* A pending invitation to a workspace.
 *
 * THE TOKEN IS NOT STORED. token_hash holds sha256 of the value that went into
 * the link, and the plaintext is returned exactly once, at creation. This row
 * grants membership to whoever presents the matching token, so a database read
 * must not hand out working invitations to every workspace on the deployment --
 * the same reason a password verifier is a verifier and not a password.
 *
 * Single use and time-bounded, both enforced by the columns below rather than
 * by the caller: redeemed_at set means spent, expires_at passed means dead, and
 * revoked_at set means an owner withdrew it. A link that could not be withdrawn
 * after being sent to the wrong address is a hole with a tidy UI.
 *
 * invited_by and redeemed_by are auth user ids held as plain columns, with no
 * foreign key -- the auth tables migrate independently (see AUTH_OWNED_TABLES).
 * An invitation naming a deleted account is inert, not dangerous: redemption
 * checks the workspace and the token, never the inviter. */
CREATE TABLE IF NOT EXISTS workspace_invitations (
  id TEXT PRIMARY KEY,
  workspace TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  invited_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  redeemed_at INTEGER,
  redeemed_by TEXT,
  revoked_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_invitations_token ON workspace_invitations(token_hash);
CREATE INDEX IF NOT EXISTS idx_workspace_invitations_workspace ON workspace_invitations(workspace, created_at DESC);
`;

/* Auth ownership and the unowned-table check live with the migration sequence,
 * which owns the schema now; re-exported so callers need not move while the
 * SQLite path is retired. */
export { AUTH_OWNED_TABLES, AUTH_TABLE_PREFIX, unownedTables } from "./schema.ts";

/* Tables owned by the unified runtime schema (used by the importer + tests).
 *
 * Derived from the declaration rather than listed by hand: the list drives the
 * persona→workspace rename and the column reconcile, so a table present in the
 * schema but missing from a hand-kept list would silently opt out of both. */
export const UNIFIED_RUNTIME_TABLES: readonly string[] = [
	...UNIFIED_SCHEMA.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g),
].map((m) => m[1]!);

/* The declared shape of one table, parsed out of UNIFIED_SCHEMA — constraints
 * included, because `workspace TEXT NOT NULL` is the entire reason the
 * content_projects rebuild exists.
 *
 * This is what makes the schema the single owner of its columns. The rebuild used
 * to read a second, hand-kept copy of the shape, so a column added anywhere else
 * (`openMaleoDb` ALTER-added `editor_state_json` after this file ran) was invisible
 * to it and got dropped on the swap. */
export function canonicalColumns(table: string): ReadonlyArray<{ name: string; decl: string }> {
	const match = new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n\\);`).exec(
		UNIFIED_SCHEMA,
	);
	if (!match) return [];
	return (
		splitTopLevel(match[1]!)
			.map((line) => line.trim())
			.filter(Boolean)
			// Table-level constraints (UNIQUE(...), PRIMARY KEY(...)) are not columns.
			.filter((line) => !/^(UNIQUE|PRIMARY KEY|FOREIGN KEY|CHECK|CONSTRAINT)\b/i.test(line))
			.map((line) => {
				const space = line.indexOf(" ");
				return space === -1
					? { name: line, decl: "" }
					: { name: line.slice(0, space), decl: line.slice(space + 1).trim() };
			})
	);
}

/** Split a CREATE TABLE body on commas that are not inside parentheses, so a
 *  `UNIQUE(a, b)` or `DEFAULT (x, y)` does not fracture into fake columns. */
function splitTopLevel(body: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let current = "";
	for (const ch of body) {
		if (ch === "(") depth += 1;
		if (ch === ")") depth -= 1;
		if (ch === "," && depth === 0) {
			parts.push(current);
			current = "";
			continue;
		}
		current += ch;
	}
	parts.push(current);
	return parts;
}

const TABLES_ONLY_SCHEMA = UNIFIED_SCHEMA.split(/;\s*\n/)
	.map((stmt) => stmt.trim())
	.filter(Boolean)
	// Every index is deferred to the full-schema pass, UNIQUE ones included: an index
	// over a column reconcileColumns has not added yet throws here, before the ALTER
	// that would create it — which aborts the whole migration and leaves the database
	// on its old shape.
	//
	// The leading comments have to be stripped before the test. Statements split on
	// `;\n`, so a statement preceded by a `--` comment block does not START with
	// CREATE, and an anchored match silently fails to defer it.
	.filter((stmt) => !/^CREATE (?:UNIQUE )?INDEX /i.test(withoutLeadingComments(stmt)))
	.map((stmt) => `${stmt};`)
	.join("\n");

/** A statement with its leading `--` comment lines removed, so a keyword test can be
 *  anchored to the SQL rather than to whatever documentation precedes it. */
function withoutLeadingComments(stmt: string): string {
	return stmt.replace(/^(?:\s*--[^\n]*\n)+/, "").trimStart();
}

interface ColumnInfo {
	name: string;
	type: string;
}

function tableColumns(db: Database, table: string): ColumnInfo[] {
	return db
		.query<{ name: string; type: string }, []>(`PRAGMA table_info(${table})`)
		.all()
		.map((c) => ({ name: c.name, type: c.type }));
}

// Self-healing column reconciliation. CREATE TABLE IF NOT EXISTS never adds
// columns to a table that already exists, so a table created by an earlier
// version of this schema can be missing columns added later (e.g. posts
// gaining verified_*). Compare each runtime table against the canonical shape
// (built in a scratch in-memory DB) and ALTER-add any missing column. Columns
// are added nullable regardless of the canonical NOT NULL — pre-existing rows
// cannot satisfy NOT NULL without a default, and these late columns are all
// optional in practice.
function reconcileColumns(db: Database): void {
	const scratch = new Database(":memory:");
	try {
		scratch.exec(UNIFIED_SCHEMA);
		for (const table of UNIFIED_RUNTIME_TABLES) {
			const existing = new Set(tableColumns(db, table).map((c) => c.name));
			if (existing.size === 0) continue; // table not present yet; CREATE handled it
			for (const col of tableColumns(scratch, table)) {
				if (existing.has(col.name)) continue;
				const type = col.type && col.type.trim().length > 0 ? col.type : "TEXT";
				try {
					db.exec(`ALTER TABLE ${table} ADD COLUMN ${col.name} ${type}`);
				} catch {
					/* column raced in or cannot be added — safe to skip */
				}
			}
		}
	} finally {
		scratch.close();
	}
}

// Legacy rename (persona→workspace): tables created before the rename carry a
// `persona` scoping column. Rename it in place BEFORE CREATE/reconcile so the
// data is preserved (otherwise reconcileColumns would add an empty `workspace`
// column and strand every row's tenant key under the old name). SQLite 3.25+
// RENAME COLUMN updates index/trigger references automatically. Guarded per
// table: skipped on fresh DBs (no columns) and already-migrated DBs.
function renamePersonaScopeColumn(db: Database): void {
	for (const table of UNIFIED_RUNTIME_TABLES) {
		const cols = new Set(tableColumns(db, table).map((c) => c.name));
		if (cols.has("persona") && !cols.has("workspace")) {
			try {
				db.exec(`ALTER TABLE ${table} RENAME COLUMN persona TO workspace`);
			} catch {
				/* already renamed or raced — safe to skip */
			}
		}
	}
}

import { DEFAULT_CONTENT_WORKSPACE } from "./schema.ts";
export { DEFAULT_CONTENT_WORKSPACE };

/* image_ledger became medium-aware: it records speech as well as images.
 *
 * Three things a plain CREATE/reconcile pass cannot do, so they are done here,
 * BEFORE TABLES_ONLY_SCHEMA runs:
 *
 * 1. `image_url` -> `asset_url`. Renamed rather than added, or reconcileColumns
 *    would add an empty `asset_url` beside the populated `image_url` and strand
 *    every recorded image's location under the old name — the same failure the
 *    persona->workspace rename above exists to prevent. SQLite 3.25+ RENAME COLUMN
 *    updates the index references for us.
 *
 * 2. `medium` with its DEFAULT. reconcileColumns reads only name and type from
 *    PRAGMA table_info, so it would add this column nullable and default-less, and
 *    every pre-existing row would carry NULL rather than 'image'. Adding it here
 *    with the default backfills the whole table in one statement: rows written
 *    before speech existed are images, because that is what they are.
 *
 * 3. Dropping the three read indexes. Their definitions now lead with `medium`,
 *    and `CREATE INDEX IF NOT EXISTS` will not redefine an index that already
 *    exists — a legacy database would silently keep scanning the old shape. They
 *    are dropped so the CREATE at the end of applyUnifiedSchema rebuilds them.
 *
 * Every step is guarded on the state it changes, so this is idempotent and a no-op
 * on a fresh database (which CREATE TABLE builds in the new shape directly). */
function migrateImageLedgerMedium(db: Database): void {
	const cols = new Set(tableColumns(db, "image_ledger").map((c) => c.name));
	if (cols.size === 0) return; // fresh DB — CREATE TABLE handles it

	if (cols.has("image_url") && !cols.has("asset_url")) {
		try {
			db.exec(`ALTER TABLE image_ledger RENAME COLUMN image_url TO asset_url`);
		} catch {
			/* already renamed or raced — safe to skip */
		}
	}

	if (!cols.has("medium")) {
		try {
			db.exec(`ALTER TABLE image_ledger ADD COLUMN medium TEXT NOT NULL DEFAULT 'image'`);
			// The read indexes are stale only on a database that predates `medium`,
			// which is exactly the branch we are in.
			for (const index of [
				"idx_image_ledger_created",
				"idx_image_ledger_workspace",
				"idx_image_ledger_project",
			]) {
				db.exec(`DROP INDEX IF EXISTS ${index}`);
			}
		} catch {
			/* column raced in — safe to skip */
		}
	}
}

// content_projects gained `workspace` after rows existed. reconcileColumns can add
// the column but not its NOT NULL/DEFAULT (it ALTERs with name+type only, since a
// pre-existing row cannot satisfy NOT NULL without a default), so:
//   1. backfill every NULL/empty workspace to DEFAULT_CONTENT_WORKSPACE, then
//   2. rebuild the table to actually enforce NOT NULL — SQLite has no
//      ALTER COLUMN, so the constraint needs a table swap.
// Both steps are guarded and idempotent: step 2 runs only while the live column is
// still nullable, so this is a one-shot cost, not per-open work.
function migrateContentProjectWorkspace(db: Database): void {
	const cols = tableColumns(db, "content_projects");
	if (cols.length === 0) return; // fresh DB — CREATE already applied the constraint
	const workspace = cols.find((c) => c.name === "workspace");
	if (!workspace) return; // reconcileColumns has not run yet

	db.run(
		`UPDATE content_projects SET workspace = ? WHERE workspace IS NULL OR trim(workspace) = ''`,
		[DEFAULT_CONTENT_WORKSPACE],
	);

	// notnull is 1 once the rebuild below has happened; skip the swap after that.
	const info = db
		.query<{ nn: number }, []>(
			`SELECT "notnull" AS nn FROM pragma_table_info('content_projects') WHERE name = 'workspace'`,
		)
		.get();
	if (!info || info.nn === 1) return;

	/* `count(*)` without GROUP BY always returns exactly one row, so this is never
	 * null in practice — the previous cast said so by asserting the row non-null.
	 * It falls back to 1 rather than 0 anyway: if the count cannot be read, the
	 * safe answer is "there may be rows", which declines to tighten. Reading it as
	 * 0 would tighten a constraint on unknown data. */
	const remaining =
		db
			.query<{ c: number }, []>(
				`SELECT count(*) AS c FROM content_projects WHERE workspace IS NULL OR trim(workspace) = ''`,
			)
			.get()?.c ?? 1;
	if (remaining > 0) return; // never tighten a constraint the data cannot satisfy

	/* Copy every column the live table actually has, ordered canonical-first.
	 *
	 * The declaration owns the shape now, so `canonicalColumns` already knows about
	 * `editor_state_json` and the rest. Extras can still exist on an old DB (a
	 * column some past version added and the schema no longer declares), and those
	 * ride along rather than being dropped — which is precisely what went wrong on
	 * 2026-07-30, when this swap destroyed editor_state_json for 141 projects
	 * (2,883 chat messages) and the schema looked healthy afterwards because an
	 * ALTER re-added the column empty on the next open. */
	const canonical = canonicalColumns("content_projects");
	const canonicalNames = new Set(canonical.map((c) => c.name));
	const live = new Set(cols.map((c) => c.name));
	const extras = cols.filter((c) => !canonicalNames.has(c.name));
	// Only columns present on BOTH sides can be selected from the old table.
	const carried = [
		...canonical.map((c) => c.name).filter((n) => live.has(n)),
		...extras.map((c) => c.name),
	];
	const columnList = carried.map((c) => `"${c}"`).join(", ");

	try {
		db.exec("BEGIN");
		db.exec(`
			CREATE TABLE content_projects__new (
			  ${canonical.map((c) => `${c.name} ${c.decl}`).join(",\n\t\t\t  ")}
			);
		`);
		// Re-attach anything the canonical shape does not know about, so the copy
		// below can carry its data across.
		for (const extra of extras) {
			db.exec(`ALTER TABLE content_projects__new ADD COLUMN ${extra.name} ${extra.type || "TEXT"}`);
		}
		db.exec(`
			INSERT INTO content_projects__new (${columnList})
			SELECT ${columnList} FROM content_projects;
			DROP TABLE content_projects;
			ALTER TABLE content_projects__new RENAME TO content_projects;
		`);
		db.exec("COMMIT");
		// Indexes were dropped with the old table; UNIFIED_SCHEMA recreates them.
	} catch {
		try {
			db.exec("ROLLBACK");
		} catch {
			/* nothing to roll back */
		}
	}
}

/* reconcileColumns adds late columns nullable (it cannot satisfy NOT NULL for
 * pre-existing rows), so a boolean flag added after rows existed arrives as NULL
 * rather than 0. That breaks `WHERE flag = 0` as surely as it breaks `= 1`.
 * Normalise those to their intended default. */
function backfillNullableFlags(db: Database): void {
	if (tableColumns(db, "project_reference").some((c) => c.name === "is_primary")) {
		db.run(`UPDATE project_reference SET is_primary = 0 WHERE is_primary IS NULL`);
	}
}

/* Workspace-scoped assets written before any surface sent a tenant carry a NULL
 * workspace. Once the catalogue filters by workspace they would belong to no
 * workspace and appear in none — the same "my references vanished" reading that
 * registering `default` exists to prevent for projects, and for the same reason:
 * they were created by the tenant that owns everything else.
 *
 * Only `scope = 'workspace'` rows are touched. A campaign- or project-scoped
 * asset resolves its tenant through its parent, so stamping one here would
 * invent an owner rather than name the one it already has.
 *
 * Idempotent: after the first pass there is nothing left to match. */
function migrateContentAssetWorkspace(db: Database): void {
	const cols = tableColumns(db, "content_assets");
	if (cols.length === 0) return; // fresh DB — nothing predates the column
	if (!cols.some((c) => c.name === "workspace")) return; // reconcileColumns has not run yet
	db.run(
		`UPDATE content_assets SET workspace = ?
		 WHERE scope = 'workspace' AND (workspace IS NULL OR trim(workspace) = '')`,
		[DEFAULT_CONTENT_WORKSPACE],
	);
}

/* asset_suppression gained a `workspace` column and a composite primary key.
 *
 * reconcileColumns can add the column but not change the key, and the key is
 * the load-bearing half: with PRIMARY KEY(suppressed_ref) alone, the second
 * workspace to suppress a shared id hits ON CONFLICT DO NOTHING and loses its
 * suppression. SQLite has no ALTER of a primary key, so this is a table swap.
 *
 * Existing rows keep workspace = '' (legacy, applies everywhere) rather than
 * being assigned one: the workspace they were suppressed under was never
 * recorded, and guessing wrong un-deletes a reference an operator removed.
 *
 * Guarded on the column being absent, so this runs once. */
function migrateAssetSuppressionWorkspace(db: Database): void {
	const cols = db
		.query<{ name: string; pk: number }, []>(`PRAGMA table_info(asset_suppression)`)
		.all();
	if (cols.length === 0) return; // fresh DB — CREATE already has the new shape
	/* Keyed on the PRIMARY KEY, not on the column.
	 *
	 * `reconcileColumns` runs before this and will happily ADD `workspace` on its
	 * own — as a plain nullable column, with no DEFAULT applied to existing rows
	 * and the old single-column key intact. Guarding on "does the column exist"
	 * therefore skipped the rebuild on exactly the databases that needed it, and
	 * left every pre-existing row with workspace NULL: matched by neither
	 * `workspace = ?` nor `workspace = ''`, so 21 live suppressions went inert
	 * and the references they hid came back. */
	if (cols.find((c) => c.name === "workspace")?.pk) return; // composite key in place
	// COALESCE only when the column is actually there. A database reconcileColumns
	// has touched has it (nullable); an untouched one does not, and naming it in
	// the SELECT would fail with "no such column".
	const workspaceExpr = cols.some((c) => c.name === "workspace") ? "COALESCE(workspace, '')" : "''";
	db.exec(`
		CREATE TABLE asset_suppression__new (
		  suppressed_ref TEXT NOT NULL,
		  workspace TEXT NOT NULL DEFAULT '',
		  reason TEXT,
		  created_at INTEGER NOT NULL,
		  PRIMARY KEY (suppressed_ref, workspace)
		);
		INSERT OR IGNORE INTO asset_suppression__new (suppressed_ref, workspace, reason, created_at)
		  SELECT suppressed_ref, ${workspaceExpr}, reason, created_at FROM asset_suppression;
		DROP TABLE asset_suppression;
		ALTER TABLE asset_suppression__new RENAME TO asset_suppression;
	`);
}

/* media_objects dropped UNIQUE (workspace, kind, hash).
 *
 * That constraint was the deduplication: object keys were the SHA-256 of the
 * bytes, so one hash meant one object and the unique index made concurrent
 * identical writes converge on one row. Keys are now unique per write
 * (uuid-suffixed, owner-scoped), so identical bytes legitimately occupy several
 * keys — and with the old index still present the second such write hits
 * ON CONFLICT and returns the first row, whose storage_key names different
 * bytes than the caller just uploaded.
 *
 * SQLite cannot drop a table-level constraint, so this is a table swap. Guarded
 * on the auto-index actually being there, so it runs once and skips fresh
 * databases, where CREATE TABLE already has the new shape. */
function migrateMediaObjectHashUniqueness(db: Database): void {
	const cols = tableColumns(db, "media_objects");
	if (cols.length === 0) return; // fresh DB — CREATE already has the new shape
	const stale = db
		.query<{ name: string }, []>(`PRAGMA index_list(media_objects)`)
		.all()
		.some(({ name }) => {
			const columns = db
				.query<{ name: string }, []>(`PRAGMA index_info(${name})`)
				.all()
				.map((c) => c.name);
			return (
				columns.length === 3 &&
				columns.includes("workspace") &&
				columns.includes("kind") &&
				columns.includes("hash")
			);
		});
	if (!stale) return;
	db.exec(`
		CREATE TABLE media_objects__new (
		  id TEXT PRIMARY KEY,
		  workspace TEXT NOT NULL,
		  kind TEXT NOT NULL CHECK (kind IN ('image', 'audio', 'video', 'manifest', 'file')),
		  hash TEXT NOT NULL,
		  storage_key TEXT NOT NULL,
		  content_type TEXT NOT NULL,
		  size INTEGER NOT NULL,
		  created_at INTEGER NOT NULL,
		  UNIQUE (storage_key)
		);
		INSERT INTO media_objects__new (id, workspace, kind, hash, storage_key, content_type, size, created_at)
		  SELECT id, workspace, kind, hash, storage_key, content_type, size, created_at FROM media_objects;
		DROP TABLE media_objects;
		ALTER TABLE media_objects__new RENAME TO media_objects;
	`);
}

/* Legacy rename (workspace_settings→global_settings): the table's primary key is
 * `key` alone, with no workspace column. It is app-global and always has been;
 * the name was simply wrong, and it became actively misleading once an
 * app-level AI provider setting moved into it, mid-pivot from tenant to
 * workspace terminology.
 *
 * The guard is load-bearing, not defensive. Every other table here is created
 * with CREATE TABLE IF NOT EXISTS, and on an existing database that statement
 * would cheerfully create an empty `global_settings` beside the populated
 * `workspace_settings` — every stored setting would then read back as missing,
 * with no error raised anywhere. So this must run BEFORE the CREATE, and only
 * when the old table exists and the new one does not. */
function renameWorkspaceSettingsTable(db: Database): void {
	if (!tableExists(db, "workspace_settings")) return; // fresh DB, or already renamed
	if (tableExists(db, "global_settings")) return; // already migrated
	try {
		db.exec(`ALTER TABLE workspace_settings RENAME TO global_settings`);
	} catch {
		/* raced with another opener — the guard above makes this a no-op, not a loss */
	}
}

/* Provider ids that no longer name a registered provider.
 *
 * `gemini-canvas` was the Chrome CDP image/TTS driver, retired with its package.
 * A row still holding it is not an operator error — it was a valid choice when
 * it was made, and the provider was removed underneath it — so the row is
 * cleared and the capability falls back to the registry default.
 *
 * Selection also tolerates an unresolvable persisted id at runtime, which is
 * what protects a deploy that rolls forward without this migration. This clears
 * the row so the settings picker stops OFFERING a provider that cannot run;
 * the two answer different failures. */
const RETIRED_PROVIDER_IDS = ["gemini-canvas", "supertonic"];

function clearRetiredProviderSettings(db: Database): void {
	if (!tableExists(db, "global_settings")) return;
	const placeholders = RETIRED_PROVIDER_IDS.map(() => "?").join(", ");
	db.run(
		`DELETE FROM global_settings WHERE key LIKE 'media.provider.%' AND value IN (${placeholders})`,
		RETIRED_PROVIDER_IDS,
	);
}

function tableExists(db: Database, table: string): boolean {
	const row = db
		.query<{ name: string }, [string]>(
			`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
		)
		.get(table);
	return row != null;
}

function migrateReferenceEntityRoleVocabulary(db: Database): void {
	const source = db
		.query<{ sql: string | null }, []>(
			`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'reference_entity'`,
		)
		.get()?.sql;
	if (!source) return;
	if (source.includes("'location'") && !source.includes("'environment'")) return;

	const cols = tableColumns(db, "reference_entity");
	if (cols.length === 0 || !cols.some((c) => c.name === "role")) return;
	db.run(`UPDATE reference_entity SET role = 'style' WHERE role = 'environment'`);

	const canonical = canonicalColumns("reference_entity");
	const canonicalNames = new Set(canonical.map((c) => c.name));
	const live = new Set(cols.map((c) => c.name));
	const extras = cols.filter((c) => !canonicalNames.has(c.name));
	const carried = [
		...canonical.map((c) => c.name).filter((n) => live.has(n)),
		...extras.map((c) => c.name),
	];
	const insertColumns = carried.map((c) => `"${c}"`).join(", ");
	const selectColumns = carried
		.map((c) =>
			c === "role" ? `CASE role WHEN 'environment' THEN 'style' ELSE role END` : `"${c}"`,
		)
		.join(", ");

	try {
		db.exec("BEGIN");
		db.exec(`
			CREATE TABLE reference_entity__new (
			  ${canonical.map((c) => `${c.name} ${c.decl}`).join(",\n\t\t\t  ")}
			);
		`);
		for (const extra of extras) {
			db.exec(`ALTER TABLE reference_entity__new ADD COLUMN ${extra.name} ${extra.type || "TEXT"}`);
		}
		db.exec(`
			INSERT INTO reference_entity__new (${insertColumns})
			SELECT ${selectColumns} FROM reference_entity;
			DROP TABLE reference_entity;
			ALTER TABLE reference_entity__new RENAME TO reference_entity;
		`);
		db.exec("COMMIT");
	} catch {
		try {
			db.exec("ROLLBACK");
		} catch {
			/* nothing to roll back */
		}
	}
}

export function applyUnifiedSchema(db: Database): void {
	renameWorkspaceSettingsTable(db);
	renamePersonaScopeColumn(db);
	migrateImageLedgerMedium(db);
	db.exec(TABLES_ONLY_SCHEMA);
	reconcileColumns(db);
	db.exec("DROP INDEX IF EXISTS idx_image_ledger_backfill");
	migrateReferenceEntityRoleVocabulary(db);
	migrateContentProjectWorkspace(db);
	migrateContentAssetWorkspace(db);
	migrateAssetSuppressionWorkspace(db);
	migrateMediaObjectHashUniqueness(db);
	backfillNullableFlags(db);
	clearRetiredProviderSettings(db);
	db.exec(UNIFIED_SCHEMA);
}
