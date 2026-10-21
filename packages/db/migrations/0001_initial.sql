-- The schema as it stood when the runtime database moved from SQLite to
-- Postgres: the tables unified-schema.ts declared, translated mechanically.
--
--   INTEGER -> bigint            SQLite integers are 64-bit, and every timestamp
--                                here is epoch milliseconds, which overflows integer
--   REAL -> double precision     Postgres real is 4 bytes; SQLite REAL is 8
--   INTEGER PRIMARY KEY AUTOINCREMENT -> bigint identity
--   ifnull -> coalesce
--
-- The comments are carried over as they were written; they explain why each
-- table has its shape. Applied migrations are never edited -- a correction is a
-- new migration.

CREATE TABLE workspaces (
  name TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  workspace_dir TEXT NOT NULL,
  config_path TEXT NOT NULL,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  last_synced_at bigint,
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
CREATE INDEX idx_workspaces_status ON workspaces(status, updated_at DESC);

CREATE TABLE campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  goal TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  workspaces_json TEXT,
  budget_json TEXT,
  start_at bigint,
  end_at bigint,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);
CREATE INDEX idx_campaigns_status ON campaigns(status, updated_at DESC);

CREATE TABLE approval_decisions (
  id TEXT PRIMARY KEY,
  workspace TEXT,
  draft_id TEXT NOT NULL,
  decision TEXT NOT NULL,
  reason_code TEXT,
  notes TEXT,
  created_at bigint NOT NULL
);
CREATE INDEX idx_approval_draft ON approval_decisions(workspace, draft_id, created_at DESC);

CREATE TABLE routines (
  id TEXT PRIMARY KEY,
  workspace TEXT NOT NULL,
  name TEXT NOT NULL,
  schedule TEXT NOT NULL,
  action TEXT NOT NULL,
  instruction TEXT NOT NULL DEFAULT '',
  enabled bigint NOT NULL DEFAULT 1,
  last_run_at bigint,
  next_run_at bigint,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);
CREATE INDEX idx_routines_due ON routines(enabled, next_run_at);
CREATE INDEX idx_routines_workspace ON routines(workspace, updated_at DESC);

CREATE TABLE credit_accounts (
  id TEXT PRIMARY KEY,
  scope_type TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  available_credits bigint NOT NULL DEFAULT 0,
  reserved_credits bigint NOT NULL DEFAULT 0,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  UNIQUE(scope_type, scope_id)
);

CREATE TABLE credit_policies (
  id TEXT PRIMARY KEY,
  scope_type TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  daily_limit_credits bigint,
  rolling_5h_limit_credits bigint,
  per_run_limit_credits bigint,
  require_approval_above_credits bigint,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  UNIQUE(scope_type, scope_id)
);

CREATE TABLE credit_reservations (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  reference_type TEXT NOT NULL,
  reference_id TEXT NOT NULL,
  requested_credits bigint NOT NULL,
  reserved_credits bigint NOT NULL,
  captured_credits bigint NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  expires_at bigint,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  UNIQUE(account_id, reference_type, reference_id)
);

CREATE TABLE credit_transactions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  type TEXT NOT NULL,
  amount_credits bigint NOT NULL,
  balance_available_after bigint NOT NULL,
  balance_reserved_after bigint NOT NULL,
  reference_type TEXT,
  reference_id TEXT,
  idempotency_key TEXT UNIQUE,
  description TEXT,
  metadata_json TEXT,
  created_at bigint NOT NULL
);
CREATE INDEX idx_credit_transactions_account_created ON credit_transactions(account_id, created_at DESC);

CREATE TABLE usage_records (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  reservation_id TEXT,
  operation TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  quantity double precision NOT NULL,
  unit TEXT NOT NULL,
  provider_cost_usd double precision NOT NULL DEFAULT 0,
  charged_credits bigint NOT NULL,
  pricing_version TEXT NOT NULL,
  metadata_json TEXT,
  created_at bigint NOT NULL
);
CREATE INDEX idx_usage_records_account_created ON usage_records(account_id, created_at DESC);
CREATE INDEX idx_usage_records_operation_created ON usage_records(operation, created_at DESC);

CREATE TABLE drafts (
  workspace TEXT NOT NULL,
  id TEXT PRIMARY KEY,
  action_id TEXT NOT NULL,
  parent_draft_id TEXT,
  revision bigint NOT NULL DEFAULT 1,
  action TEXT NOT NULL,
  reasoning TEXT NOT NULL,
  content TEXT,
  reply_to_id TEXT,
  scheduled_for bigint,
  status TEXT NOT NULL,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  ttl_at bigint,
  campaign_id TEXT,
  image_urls_json TEXT,
  thread_image_urls_json TEXT,
  thread_drafts_json TEXT,
  thought_id TEXT,
  codex_invocation_id TEXT,
  reject_score bigint,
  reject_notes TEXT,
  video_product_json TEXT,
  video_job_id TEXT,
  product_snapshot_json TEXT,
  video_status TEXT,
  video_output_path TEXT,
  video_output_url TEXT,
  video_thumbnail_path TEXT,
  video_manifest_path TEXT,
  video_duration_sec double precision,
  video_preset TEXT,
  video_updated_at bigint
);
CREATE UNIQUE INDEX idx_drafts_action ON drafts(workspace, action_id);
CREATE INDEX idx_drafts_status ON drafts(workspace, status, updated_at DESC);
CREATE INDEX idx_drafts_thought ON drafts(workspace, thought_id);
CREATE INDEX idx_drafts_campaign ON drafts(workspace, campaign_id);

CREATE TABLE posts (
  workspace TEXT NOT NULL,
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  platform_post_id TEXT,
  content TEXT NOT NULL,
  posted_at bigint NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  verified_status TEXT,
  verified_detail TEXT,
  verified_at bigint
);
CREATE INDEX idx_posts_posted_at ON posts(workspace, posted_at DESC);
CREATE INDEX idx_posts_draft_platform ON posts(workspace, draft_id, platform);

CREATE TABLE metrics (
  workspace TEXT NOT NULL,
  post_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  likes bigint NOT NULL DEFAULT 0,
  replies bigint NOT NULL DEFAULT 0,
  reposts bigint NOT NULL DEFAULT 0,
  views bigint NOT NULL DEFAULT 0,
  fetched_at bigint NOT NULL,
  PRIMARY KEY (workspace, post_id, fetched_at)
);

CREATE TABLE replies (
  workspace TEXT NOT NULL,
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  platform_reply_id TEXT,
  author TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at bigint NOT NULL,
  responded_at bigint,
  response_draft_id TEXT,
  thread_depth bigint NOT NULL DEFAULT 0,
  sentiment TEXT,
  sentiment_at bigint,
  response_status TEXT,
  response_reason TEXT,
  image_url TEXT
);
CREATE INDEX idx_replies_created ON replies(workspace, created_at DESC);
CREATE INDEX idx_replies_platform_reply_id ON replies(platform_reply_id);

CREATE TABLE directives (
  workspace TEXT NOT NULL,
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  priority bigint NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  created_at bigint NOT NULL,
  expires_at bigint,
  consumed_at bigint,
  max_injections bigint NOT NULL DEFAULT 1,
  injections_used bigint NOT NULL DEFAULT 0
);
CREATE INDEX idx_directives_workspace ON directives(workspace, status);

CREATE TABLE scenarios (
  workspace TEXT NOT NULL,
  id TEXT PRIMARY KEY,
  situation TEXT NOT NULL,
  workspace_response TEXT NOT NULL,
  reasoning TEXT NOT NULL,
  category TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  notes TEXT,
  decided_at bigint,
  created_at bigint NOT NULL
);
CREATE INDEX idx_scenarios_status ON scenarios(workspace, status);
CREATE INDEX idx_scenarios_created ON scenarios(workspace, created_at DESC);

CREATE TABLE image_generation_log (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  workspace TEXT NOT NULL,
  kind TEXT NOT NULL,
  created_at bigint NOT NULL,
  channel TEXT,
  cost_usd double precision
);
CREATE INDEX idx_image_gen_log_created ON image_generation_log(workspace, created_at DESC);

CREATE TABLE video_generation_log (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  workspace TEXT NOT NULL,
  kind TEXT NOT NULL,
  channel TEXT,
  cost_usd double precision,
  created_at bigint NOT NULL
);
CREATE INDEX idx_video_gen_log_created ON video_generation_log(workspace, created_at DESC);

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
CREATE TABLE image_ledger (
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
  duration_sec double precision,
  job_id TEXT,
  backfilled bigint NOT NULL DEFAULT 0,
  starred bigint NOT NULL DEFAULT 0,
  created_at bigint NOT NULL,
  resolved_at bigint,
  deleted_at bigint
);
-- Resolution is idempotent on job id: a doubly-polled completion must not open a
-- second row. Partial, because backfilled rows have no job id and would otherwise
-- collide with each other on NULL.
CREATE UNIQUE INDEX idx_image_ledger_job ON image_ledger(job_id) WHERE job_id IS NOT NULL;
-- Historical backfill is complete. Distinct ledger rows may now share one
-- content-addressed media URL while retaining their own attempt/provenance ids.
-- The gallery's three read shapes, each led by medium because every one of them is
-- asked for one medium at a time. created_at DESC because every one is newest-first.
CREATE INDEX idx_image_ledger_created ON image_ledger(medium, created_at DESC);
CREATE INDEX idx_image_ledger_workspace ON image_ledger(medium, workspace, created_at DESC);
CREATE INDEX idx_image_ledger_project ON image_ledger(medium, project_id, created_at DESC);

CREATE TABLE image_jobs (
  workspace TEXT NOT NULL,
  job_id TEXT PRIMARY KEY,
  prompt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  image_url TEXT,
  created_at bigint NOT NULL,
  completed_at bigint
);
CREATE INDEX idx_image_jobs_status ON image_jobs(workspace, status);

-- App-global key/value settings. Named workspace_settings until this table
-- gained the AI provider choice; the primary key is "key" alone, with no
-- workspace column, so it was never workspace-scoped. Existing databases are
-- renamed in place by renameWorkspaceSettingsTable before this CREATE runs.
CREATE TABLE global_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at bigint NOT NULL
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
CREATE TABLE content_timeline_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  template_json TEXT NOT NULL,
  slug TEXT,
  source TEXT NOT NULL DEFAULT 'user',
  retired bigint NOT NULL DEFAULT 0,
  fixture_rank bigint NOT NULL DEFAULT 0,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);
CREATE INDEX idx_content_timeline_templates_updated ON content_timeline_templates(updated_at DESC);
CREATE UNIQUE INDEX idx_content_timeline_templates_slug ON content_timeline_templates(slug) WHERE slug IS NOT NULL;

CREATE TABLE content_presets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  preset_json TEXT NOT NULL,
  slug TEXT,
  source TEXT NOT NULL DEFAULT 'user',
  retired bigint NOT NULL DEFAULT 0,
  fixture_rank bigint NOT NULL DEFAULT 0,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);
CREATE INDEX idx_content_presets_updated ON content_presets(updated_at DESC);
CREATE UNIQUE INDEX idx_content_presets_slug ON content_presets(slug) WHERE slug IS NOT NULL;

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
CREATE TABLE content_materials (
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
  retired bigint NOT NULL DEFAULT 0,
  fixture_rank bigint NOT NULL DEFAULT 0,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);
CREATE INDEX idx_content_materials_workspace ON content_materials(workspace, updated_at DESC);
CREATE INDEX idx_content_materials_group ON content_materials(workspace, material_group, updated_at DESC);
-- Scoped by workspace: fixtures all sit in the reserved empty workspace, so this
-- makes fixture slugs unique database-wide and user slugs unique per workspace.
CREATE UNIQUE INDEX idx_content_materials_slug ON content_materials(workspace, slug) WHERE slug IS NOT NULL;

CREATE TABLE content_motion_presets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  keyframes_json TEXT NOT NULL,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);
CREATE INDEX idx_content_motion_presets_updated ON content_motion_presets(updated_at DESC);

CREATE TABLE content_clip_templates (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  intent TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL,
  base TEXT NOT NULL,
  config_json TEXT NOT NULL,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);
CREATE INDEX idx_content_clip_templates_updated ON content_clip_templates(updated_at DESC);

CREATE TABLE content_projects (
  id TEXT PRIMARY KEY,
  workspace TEXT NOT NULL DEFAULT 'default',
  title TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  target_platform TEXT,
  target_audience TEXT,
  target_duration_sec bigint,
  target_format TEXT,
  language TEXT,
  campaign_id TEXT,
  brief_json TEXT,
  reference_notes TEXT,
  editor_state_json TEXT,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);
CREATE INDEX idx_content_projects_status ON content_projects(status, updated_at DESC);
CREATE INDEX idx_content_projects_workspace ON content_projects(workspace, updated_at DESC);

CREATE TABLE content_storyboards (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  version bigint NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  source_prompt TEXT,
  reference_notes TEXT,
  storyboard_json TEXT NOT NULL,
  created_at bigint NOT NULL
);
CREATE UNIQUE INDEX idx_content_storyboards_version ON content_storyboards(project_id, version);
CREATE INDEX idx_content_storyboards_project ON content_storyboards(project_id, created_at DESC);

-- content_references is GONE. It held one concept across two orthogonal axes
-- (asset type and scene role) in a free-text kind column, so every consumer re-derived
-- role with its own filter and the filters disagreed. Its contents were split into
-- the stores that model them: reference_entity + project_reference (castable
-- subjects), project_note, project_speaker, project_style_lock, project_citation.

CREATE TABLE content_renders (
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
  duration_sec double precision,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);
CREATE INDEX idx_content_renders_project ON content_renders(project_id, updated_at DESC);
CREATE INDEX idx_content_renders_output ON content_renders(output_id, updated_at DESC);
-- Storyboard retention asks "does a render point at this version?" once per version.
CREATE INDEX idx_content_renders_storyboard ON content_renders(storyboard_id);

CREATE TABLE content_project_outputs (
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
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);
CREATE INDEX idx_content_outputs_project ON content_project_outputs(project_id, updated_at DESC);
CREATE INDEX idx_content_outputs_storyboard ON content_project_outputs(storyboard_id, updated_at DESC);

CREATE TABLE content_project_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  output_id TEXT,
  storyboard_id TEXT,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  kind TEXT NOT NULL,
  summary TEXT NOT NULL,
  payload_json TEXT,
  created_at bigint NOT NULL
);
CREATE INDEX idx_content_project_events_project ON content_project_events(project_id, created_at DESC);
CREATE INDEX idx_content_project_events_output ON content_project_events(output_id, created_at DESC);

CREATE TABLE content_assets (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL DEFAULT 'workspace',
  campaign_id TEXT,
  project_id TEXT,
  workspace TEXT,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  tags_json TEXT,
  note TEXT,
  seed bigint NOT NULL DEFAULT 0,
  is_default bigint NOT NULL DEFAULT 0,
  src TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'manual',
  origin TEXT NOT NULL DEFAULT 'linked',
  source_ref TEXT,
  collection TEXT,
  item_id TEXT,
  meta_json TEXT,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);
CREATE UNIQUE INDEX idx_content_assets_source ON content_assets(source_type, source_ref);
CREATE INDEX idx_content_assets_scope ON content_assets(scope, updated_at DESC);
CREATE INDEX idx_content_assets_kind ON content_assets(kind, updated_at DESC);
CREATE INDEX idx_content_assets_project ON content_assets(project_id, updated_at DESC);
CREATE INDEX idx_content_assets_campaign ON content_assets(campaign_id, updated_at DESC);

-- The workspace-scoped reference entity: one row per castable subject. Owns its
-- own identity (the PK is the only id — no client-generated key nested in JSON),
-- its role on a CHECK-constrained column, one canonical image, and a written
-- description that reaches the generation reference map.
--
-- The role column is the SCENE-ROLE axis only. Never store an asset type (note,
-- audio, research, image, video): conflating both axes in content_references.kind
-- is what forced five divergent filter/fallback implementations, two of which
-- disagreed on what an unknown value meant.
CREATE TABLE reference_entity (
  id TEXT PRIMARY KEY,
  workspace TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('style', 'character', 'location', 'product', 'prop')),
  label TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  canonical_image_url TEXT,
  tags_json TEXT,
  origin TEXT NOT NULL DEFAULT 'linked',
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);
CREATE INDEX idx_reference_entity_workspace_role ON reference_entity(workspace, role, updated_at DESC);
CREATE INDEX idx_reference_entity_workspace_label ON reference_entity(workspace, label);

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
CREATE TABLE voice_clone (
  id TEXT PRIMARY KEY,
  workspace TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  label TEXT NOT NULL,
  lang TEXT NOT NULL,
  gender TEXT CHECK (gender IS NULL OR gender IN ('male', 'female')),
  ref_url TEXT NOT NULL,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  deleted_at bigint
);
CREATE INDEX idx_voice_clone_workspace ON voice_clone(workspace, provider_id, created_at DESC);

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
CREATE TABLE project_reference (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  scene_key TEXT,
  is_primary bigint NOT NULL DEFAULT 0,
  created_at bigint NOT NULL
);
CREATE UNIQUE INDEX idx_project_reference_unique ON project_reference(project_id, entity_id, coalesce(scene_key, ''));
CREATE INDEX idx_project_reference_project ON project_reference(project_id, created_at DESC);
CREATE INDEX idx_project_reference_entity ON project_reference(entity_id);

-- Text-only project notes. Formerly content_references rows with kind='note' /
-- kind='audio', which made them resolvable as cast even though they carry no
-- image. They are project state, not library entities.
CREATE TABLE project_note (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  label TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  tags_json TEXT,
  is_default bigint NOT NULL DEFAULT 0,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);
CREATE INDEX idx_project_note_project ON project_note(project_id, created_at DESC);

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
CREATE TABLE asset_suppression (
  suppressed_ref TEXT NOT NULL,
  workspace TEXT NOT NULL DEFAULT '',
  reason TEXT,
  created_at bigint NOT NULL,
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
CREATE TABLE project_speaker (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  voice_key TEXT NOT NULL,
  name TEXT NOT NULL,
  hue bigint,
  is_default bigint NOT NULL DEFAULT 0,
  created_at bigint NOT NULL
);
CREATE UNIQUE INDEX idx_project_speaker_unique ON project_speaker(project_id, voice_key);
CREATE INDEX idx_project_speaker_project ON project_speaker(project_id, created_at ASC);

-- Per-project generated style lock ("style bible"): the visual-style text plus the
-- optional style-board image. Real state, not a library entry — later jobs read it
-- back so a project keeps one look instead of regenerating a divergent one.
--
-- Formerly 6,270 content_references rows, ALL sharing the logical id
-- 'style-bible' (one per project, differing only by job_id). Living in the
-- reference table made a per-project generated plate look like a reusable library
-- entry. One row per project is the honest shape.
CREATE TABLE project_style_lock (
  project_id TEXT PRIMARY KEY,
  visual_style TEXT NOT NULL DEFAULT '',
  board_image_url TEXT,
  updated_at bigint NOT NULL
);

-- Agent-cited research sources. Formerly stored as content_references rows with
-- kind='research', which put citations in the castable reference library: they
-- reached projectRoster and could bind as a subject reference at generation.
-- Citations keep the durability/queryability that motivated the original design
-- (a Sources panel survives research_bundle artifact churn) without being cast.
CREATE TABLE project_citation (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  excerpt TEXT,
  topic TEXT,
  job_id TEXT,
  created_at bigint NOT NULL
);
CREATE INDEX idx_project_citation_project ON project_citation(project_id, created_at DESC);
CREATE UNIQUE INDEX idx_project_citation_url ON project_citation(project_id, url);

-- WP3: DB-first durable run model. workflow_run is the source of truth for an
-- agent run; snapshot_json holds the full serialized AgentJob so a parked or
-- running run rehydrates with full fidelity on any instance (not just
-- awaiting_input checkpoints). step_run/tool_run/artifact/required_action give
-- durable, queryable per-step + per-tool records (WP5).
CREATE TABLE workflow_run (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  workspace_id TEXT,
  content_type TEXT NOT NULL,
  status TEXT NOT NULL,
  cursor bigint NOT NULL DEFAULT 0,
  instruction TEXT NOT NULL DEFAULT '',
  snapshot_json TEXT,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);
CREATE INDEX idx_workflow_run_project ON workflow_run(project_id, updated_at DESC);
CREATE INDEX idx_workflow_run_status ON workflow_run(status, updated_at DESC);

CREATE TABLE step_run (
  id TEXT PRIMARY KEY,
  workflow_run_id TEXT NOT NULL,
  idx bigint NOT NULL,
  tool_name TEXT NOT NULL,
  status TEXT NOT NULL,
  attempt bigint NOT NULL DEFAULT 0,
  input_json TEXT,
  output_json TEXT,
  error_code TEXT,
  error_message TEXT,
  retry_at bigint,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);
CREATE INDEX idx_step_run_workflow ON step_run(workflow_run_id, idx);

CREATE TABLE tool_run (
  id TEXT PRIMARY KEY,
  step_run_id TEXT,
  workflow_run_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  status TEXT NOT NULL,
  input_json TEXT,
  output_json TEXT,
  error_json TEXT,
  cost double precision,
  idempotency_key TEXT,
  artifacts_json TEXT,
  latency_ms bigint,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);
CREATE INDEX idx_tool_run_workflow ON tool_run(workflow_run_id, created_at DESC);
CREATE UNIQUE INDEX idx_tool_run_idempotency ON tool_run(idempotency_key);

CREATE TABLE run_artifact (
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
  version bigint NOT NULL DEFAULT 1,
  active bigint NOT NULL DEFAULT 1,
  created_at bigint NOT NULL
);
CREATE INDEX idx_run_artifact_project ON run_artifact(project_id, created_at DESC);
CREATE INDEX idx_run_artifact_tool ON run_artifact(tool_run_id, created_at DESC);
CREATE INDEX idx_run_artifact_logical_ref ON run_artifact(project_id, logical_ref, version DESC);

CREATE TABLE required_action (
  id TEXT PRIMARY KEY,
  workflow_run_id TEXT NOT NULL,
  type TEXT NOT NULL,
  step bigint,
  status TEXT NOT NULL DEFAULT 'pending',
  payload_json TEXT,
  created_at bigint NOT NULL,
  resolved_at bigint
);
CREATE INDEX idx_required_action_workflow ON required_action(workflow_run_id, created_at DESC);

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
CREATE TABLE workspace_members (
  workspace TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  created_at bigint NOT NULL,
  PRIMARY KEY (workspace, user_id)
);
CREATE INDEX idx_workspace_members_user ON workspace_members(user_id, workspace);

CREATE TABLE media_objects (
  id TEXT PRIMARY KEY,
  workspace TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('image', 'audio', 'video', 'manifest', 'file')),
  hash TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size bigint NOT NULL,
  created_at bigint NOT NULL,
  /* hash is recorded, not identity: object keys are unique per write, so
   * identical bytes legitimately appear under several keys and rows. Only the
   * key is unique. See migrateMediaObjectHashUniqueness. */
  UNIQUE (storage_key)
);
CREATE TABLE legacy_media_links (
  legacy_path TEXT NOT NULL,
  workspace TEXT NOT NULL,
  media_id TEXT NOT NULL,
  created_at bigint NOT NULL,
  PRIMARY KEY (legacy_path, workspace)
);
CREATE INDEX idx_legacy_media_links_media ON legacy_media_links(media_id);
CREATE INDEX idx_media_objects_workspace ON media_objects(workspace, created_at);

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
CREATE TABLE workspace_invitations (
  id TEXT PRIMARY KEY,
  workspace TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  invited_by TEXT NOT NULL,
  created_at bigint NOT NULL,
  expires_at bigint NOT NULL,
  redeemed_at bigint,
  redeemed_by TEXT,
  revoked_at bigint
);
CREATE UNIQUE INDEX idx_workspace_invitations_token ON workspace_invitations(token_hash);
CREATE INDEX idx_workspace_invitations_workspace ON workspace_invitations(workspace, created_at DESC);
