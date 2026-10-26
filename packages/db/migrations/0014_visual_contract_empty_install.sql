-- Empty installations need no destructive cleanup. Existing data requires apply.
INSERT INTO global_settings (key, value, updated_at)
SELECT 'visual.contract.version', '1', 0
WHERE NOT EXISTS (SELECT 1 FROM content_projects)
  AND NOT EXISTS (SELECT 1 FROM content_clip_templates)
ON CONFLICT (key) DO NOTHING;
