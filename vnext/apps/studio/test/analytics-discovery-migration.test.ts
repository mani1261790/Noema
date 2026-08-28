import { env } from "cloudflare:workers";
import {
  applyD1Migrations,
  type D1Migration
} from "cloudflare:test";
import { describe, expect, it } from "vitest";

const testEnv = env as Env & { CMS_TEST_MIGRATIONS: D1Migration[] };

describe("article discovery analytics migration", () => {
  it("preserves valid legacy rows and safely repairs invalid navigation fields", async () => {
    const discoveryMigrationIndex = testEnv.CMS_TEST_MIGRATIONS.findIndex(
      (migration) => migration.name === "0022_analytics_article_discovery.sql"
    );
    expect(discoveryMigrationIndex).toBeGreaterThan(0);

    await applyD1Migrations(
      testEnv.CMS_DB,
      testEnv.CMS_TEST_MIGRATIONS.slice(0, discoveryMigrationIndex)
    );

    const insert = testEnv.CMS_DB.prepare(
      `INSERT INTO cms_analytics_events (
         event_id, schema_version, event_date, occurred_at, received_at,
         article_id, article_slug, revision_number, event_type,
         source, medium, campaign, content, referrer_host,
         navigation_kind, target_slug, entry_kind
       ) VALUES (?1, 1, '2026-08-28', '2026-08-28T00:00:00.000Z',
         '2026-08-28T00:00:01.000Z', 'article-id', 'article-slug', 1,
         ?2, '', '', '', '', '', ?3, ?4, 'direct')`
    );
    await testEnv.CMS_DB.batch([
      insert.bind("00000000-0000-4000-8000-000000000001", "navigation_click", "related", "target-article"),
      insert.bind("00000000-0000-4000-8000-000000000002", "navigation_click", "related", ""),
      insert.bind("00000000-0000-4000-8000-000000000003", "landing", "series_next", "target-article")
    ]);

    await applyD1Migrations(testEnv.CMS_DB, [
      testEnv.CMS_TEST_MIGRATIONS[discoveryMigrationIndex]
    ]);

    const events = await testEnv.CMS_DB.prepare(
      `SELECT event_id, event_type, navigation_kind, target_slug
       FROM cms_analytics_events
       ORDER BY event_id`
    ).all();
    expect(events.results).toEqual([
      {
        event_id: "00000000-0000-4000-8000-000000000001",
        event_type: "navigation_click",
        navigation_kind: "related",
        target_slug: "target-article"
      },
      {
        event_id: "00000000-0000-4000-8000-000000000003",
        event_type: "landing",
        navigation_kind: "",
        target_slug: ""
      }
    ]);

    const daily = await testEnv.CMS_DB.prepare(
      `SELECT event_type, navigation_kind, target_slug, event_count
       FROM cms_analytics_daily
       ORDER BY event_type`
    ).all();
    expect(daily.results).toEqual([
      {
        event_count: 1,
        event_type: "landing",
        navigation_kind: "",
        target_slug: ""
      },
      {
        event_count: 1,
        event_type: "navigation_click",
        navigation_kind: "related",
        target_slug: "target-article"
      }
    ]);

    const entryDaily = await testEnv.CMS_DB.prepare(
      `SELECT event_type, entry_kind, event_count
       FROM cms_analytics_entry_daily
       ORDER BY event_type`
    ).all();
    expect(entryDaily.results).toEqual([
      { entry_kind: "direct", event_count: 1, event_type: "landing" },
      { entry_kind: "direct", event_count: 1, event_type: "navigation_click" }
    ]);

    const ingestion = await testEnv.CMS_DB.prepare(
      `SELECT accepted_event_count, duplicate_event_count
       FROM cms_analytics_ingestion_daily
       WHERE event_date = '2026-08-28'`
    ).first();
    expect(ingestion).toEqual({
      accepted_event_count: 2,
      duplicate_event_count: 0
    });

    const repairCounts = await testEnv.CMS_DB.prepare(
      `SELECT state_key, state_value
       FROM cms_analytics_pipeline_state
       WHERE state_key LIKE 'article_discovery_legacy_%'
       ORDER BY state_key`
    ).all();
    expect(repairCounts.results).toEqual([
      { state_key: "article_discovery_legacy_invalid_daily_count", state_value: "1" },
      { state_key: "article_discovery_legacy_invalid_event_count", state_value: "1" },
      { state_key: "article_discovery_legacy_normalized_daily_count", state_value: "1" },
      { state_key: "article_discovery_legacy_normalized_event_count", state_value: "1" }
    ]);

    await expect(testEnv.CMS_DB.prepare(
      `INSERT INTO cms_analytics_events (
         event_id, schema_version, event_date, occurred_at, received_at,
         article_id, article_slug, revision_number, event_type,
         navigation_kind, target_slug, entry_kind
       ) VALUES (
         '00000000-0000-4000-8000-000000000004', 1, '2026-08-28',
         '2026-08-28T00:00:00.000Z', '2026-08-28T00:00:01.000Z',
         'article-id', 'article-slug', 1, 'navigation_click', 'related', '', 'direct'
       )`
    ).run()).rejects.toThrow();
  });
});
