INSERT INTO cms_analytics_pipeline_state (
  state_key,
  state_value,
  updated_at
) VALUES (
  'raw_coverage_complete_from',
  date('now', '+1 day'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
ON CONFLICT (state_key) DO UPDATE SET
  state_value = excluded.state_value,
  updated_at = excluded.updated_at;

INSERT INTO cms_analytics_pipeline_state (
  state_key,
  state_value,
  updated_at
) VALUES (
  'entry_coverage_complete_from',
  date('now', '+1 day'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
ON CONFLICT (state_key) DO UPDATE SET
  state_value = excluded.state_value,
  updated_at = excluded.updated_at;
