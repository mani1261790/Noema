CREATE TABLE cms_discord_deliveries (
  stream TEXT PRIMARY KEY CHECK (stream IN ('instant', 'daily')),
  last_created_at TEXT NOT NULL,
  last_event_id TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX cms_audit_events_created_idx
  ON cms_audit_events (created_at, id);
