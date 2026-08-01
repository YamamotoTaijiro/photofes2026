ALTER TABLE views ADD COLUMN client_id TEXT;
CREATE INDEX IF NOT EXISTS idx_views_client_id ON views (client_id);
