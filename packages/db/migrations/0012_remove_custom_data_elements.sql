-- Infographics are removed (`remove-infographics` D3). A custom element of kind
-- `data` was a saved infographic, and nothing reads one any more; the clip
-- template schema no longer parses that kind, so a remaining row would fail the
-- whole library list. The `data` category goes with it: an element of another
-- kind filed under it moves to `text`.
DELETE FROM content_clip_templates WHERE kind = 'data';
UPDATE content_clip_templates SET category = 'text' WHERE category = 'data';
