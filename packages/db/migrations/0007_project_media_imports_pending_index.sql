-- The pending list filters by workspace, project and status, then pages by id.
DROP INDEX IF EXISTS idx_project_media_imports_project;
CREATE INDEX idx_project_media_imports_pending ON project_media_imports(workspace, project_id, status, id);
