-- A durable command-feed boundary: older clients receive a clean snapshot and reload.
ALTER TABLE content_projects ADD COLUMN visual_cleanup_seq bigint NOT NULL DEFAULT 0;
