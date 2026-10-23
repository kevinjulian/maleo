-- A client-minted UUIDv7 media identity; the finished import is registered under it.
-- Legacy request keys leave it NULL and keep a server-minted identity.
ALTER TABLE project_media_imports ADD COLUMN media_id text;
CREATE UNIQUE INDEX idx_project_media_imports_media_id ON project_media_imports(media_id) WHERE media_id IS NOT NULL;
