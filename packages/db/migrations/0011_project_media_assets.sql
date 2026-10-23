-- A project's media library (`p1-media-library`): one row per asset, owned by the
-- server and changed only by commands in the project command log. `asset_json` is
-- the asset as the editable scope holds it; `position` keeps the library's order.
CREATE TABLE project_media_assets (
  project_id text NOT NULL REFERENCES content_projects(id) ON DELETE CASCADE,
  id text NOT NULL,
  url text NOT NULL,
  asset_json text NOT NULL,
  position integer NOT NULL,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  PRIMARY KEY (project_id, id)
);
CREATE UNIQUE INDEX idx_project_media_assets_url ON project_media_assets(project_id, url);
-- An entry that changes only the library writes no storyboard version.
ALTER TABLE content_project_commands ALTER COLUMN version DROP NOT NULL;
-- Set when the project's stored media list was imported into rows; null until then.
ALTER TABLE content_projects ADD COLUMN media_library_imported_at bigint;
