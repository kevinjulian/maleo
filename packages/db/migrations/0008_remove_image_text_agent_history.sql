-- Image and text projects are retired: they stay editable by hand, and their
-- agent history goes. Keyed by the project's stored type, so only those projects
-- are touched. Projects, slides and posts, produced media (run_artifact) and
-- billing records are kept. Durable execution state for these runs lives in the
-- library-owned mastra schema, cannot resume once the runs are gone, and expires
-- through its scheduled prune.
DELETE FROM required_action WHERE workflow_run_id IN (
  SELECT r.id FROM workflow_run r JOIN content_projects p ON p.id = r.project_id WHERE p.type IN ('image', 'text')
);
DELETE FROM tool_run WHERE workflow_run_id IN (
  SELECT r.id FROM workflow_run r JOIN content_projects p ON p.id = r.project_id WHERE p.type IN ('image', 'text')
);
DELETE FROM step_run WHERE workflow_run_id IN (
  SELECT r.id FROM workflow_run r JOIN content_projects p ON p.id = r.project_id WHERE p.type IN ('image', 'text')
);
DELETE FROM workflow_run WHERE project_id IN (
  SELECT id FROM content_projects WHERE type IN ('image', 'text')
);

-- The chat transcript lives in editor state. A state that is not valid JSON is
-- left as it is rather than failing the whole migration.
DO $$
DECLARE
  project record;
BEGIN
  FOR project IN SELECT id, editor_state_json FROM content_projects WHERE type IN ('image', 'text') AND editor_state_json IS NOT NULL LOOP
    BEGIN
      UPDATE content_projects SET editor_state_json = (project.editor_state_json::jsonb - 'chat')::text WHERE id = project.id;
    EXCEPTION WHEN invalid_text_representation THEN
      NULL;
    END;
  END LOOP;
END $$;
