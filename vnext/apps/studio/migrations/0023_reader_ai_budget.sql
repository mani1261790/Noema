-- Shared by reader discovery and article questions. No prompts or reader identifiers.
CREATE TABLE IF NOT EXISTS cms_reader_ai_budget (
  scope TEXT PRIMARY KEY,
  day TEXT NOT NULL,
  requests INTEGER NOT NULL CHECK (requests >= 0)
);
