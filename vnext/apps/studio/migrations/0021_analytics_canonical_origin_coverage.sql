WITH canonical_coverage AS (
  SELECT
    date('now', '+1 day') AS complete_from,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now') AS updated_at
), coverage_keys AS (
  SELECT 'raw_coverage_complete_from' AS state_key
  UNION ALL
  SELECT 'entry_coverage_complete_from'
)
INSERT INTO cms_analytics_pipeline_state (
  state_key,
  state_value,
  updated_at
) SELECT
  coverage_keys.state_key,
  canonical_coverage.complete_from,
  canonical_coverage.updated_at
FROM canonical_coverage
CROSS JOIN coverage_keys
WHERE true
ON CONFLICT (state_key) DO UPDATE SET
  state_value = excluded.state_value,
  updated_at = excluded.updated_at;
