import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createCmsArticle, resolveCmsSession } from "../worker/cms-repository";
import {
  createCmsSeries,
  deleteCmsSeries,
  listCmsSeries,
  listCmsSeriesVersions,
  mergeCmsSeries,
  updateCmsSeries
} from "../worker/cms-series-repository";

const testEnv = env as Env & { CMS_TEST_MIGRATIONS: D1Migration[] };
const NOW = new Date("2026-08-21T00:00:00.000Z");

beforeAll(async () => {
  await applyD1Migrations(testEnv.CMS_DB, testEnv.CMS_TEST_MIGRATIONS);
});

beforeEach(async () => {
  await testEnv.CMS_DB.batch([
    testEnv.CMS_DB.prepare("DELETE FROM cms_article_series"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_series_revision_items"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_series_revisions"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_series"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_audit_events"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_article_revisions"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_articles"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_members"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_member_invitations")
  ]);
});

describe("CMS article series", () => {
  it("versions ordering independently from article revisions and restores an old order", async () => {
    const identity = await adminIdentity();
    const first = await createCmsArticle(testEnv.CMS_DB, identity, article("first"), NOW);
    const second = await createCmsArticle(testEnv.CMS_DB, identity, article("second"), NOW);
    const created = await createCmsSeries(testEnv.CMS_DB, identity, {
      articleIds: [first.id, second.id],
      description: "順番に読むためのシリーズです。",
      slug: "getting-started",
      title: "はじめてのシリーズ"
    });

    expect(created).toMatchObject({
      articleIds: [first.id, second.id],
      lockVersion: 1,
      revisionNumber: 1
    });
    const reordered = await updateCmsSeries(testEnv.CMS_DB, identity, created.id, 1, {
      articleIds: [second.id, first.id],
      description: created.description,
      slug: created.slug,
      title: created.title
    });
    expect(reordered).toMatchObject({
      articleIds: [second.id, first.id],
      lockVersion: 2,
      revisionNumber: 2
    });

    const versions = await listCmsSeriesVersions(testEnv.CMS_DB, identity, created.id);
    expect(versions.map((version) => version.articleIds)).toEqual([
      [second.id, first.id],
      [first.id, second.id]
    ]);
    const restored = await updateCmsSeries(
      testEnv.CMS_DB,
      identity,
      created.id,
      reordered.lockVersion,
      {
        articleIds: versions[1]!.articleIds,
        description: versions[1]!.description,
        slug: versions[1]!.slug,
        title: versions[1]!.title
      },
      versions[1]!.id
    );
    expect(restored).toMatchObject({
      articleIds: [first.id, second.id],
      lockVersion: 3,
      revisionNumber: 3
    });
    expect((await listCmsSeriesVersions(testEnv.CMS_DB, identity, created.id))[0])
      .toMatchObject({ restoredFromRevisionId: versions[1]!.id });
    expect(first.revisionNumber).toBe(1);
    expect(second.revisionNumber).toBe(1);
  });

  it("keeps an article in at most one current series", async () => {
    const identity = await adminIdentity();
    const first = await createCmsArticle(testEnv.CMS_DB, identity, article("shared"), NOW);
    await createCmsSeries(testEnv.CMS_DB, identity, {
      articleIds: [first.id],
      description: "最初のシリーズです。",
      slug: "first-series",
      title: "最初のシリーズ"
    });
    await expect(createCmsSeries(testEnv.CMS_DB, identity, {
      articleIds: [first.id],
      description: "重複するシリーズです。",
      slug: "second-series",
      title: "別のシリーズ"
    })).rejects.toMatchObject({ code: "series_article_conflict" });
    expect(await listCmsSeries(testEnv.CMS_DB, identity)).toHaveLength(1);
  });

  it("rejects stale series writes without changing the published order", async () => {
    const identity = await adminIdentity();
    const first = await createCmsArticle(testEnv.CMS_DB, identity, article("one"), NOW);
    const second = await createCmsArticle(testEnv.CMS_DB, identity, article("two"), NOW);
    const created = await createCmsSeries(testEnv.CMS_DB, identity, {
      articleIds: [first.id, second.id],
      description: "競合を検証するシリーズです。",
      slug: "conflict-series",
      title: "競合シリーズ"
    });
    await updateCmsSeries(testEnv.CMS_DB, identity, created.id, created.lockVersion, {
      articleIds: [second.id, first.id],
      description: created.description,
      slug: created.slug,
      title: created.title
    });
    await expect(updateCmsSeries(testEnv.CMS_DB, identity, created.id, created.lockVersion, {
      articleIds: [first.id, second.id],
      description: created.description,
      slug: created.slug,
      title: created.title
    })).rejects.toMatchObject({ code: "series_conflict" });
    expect((await listCmsSeries(testEnv.CMS_DB, identity))[0]?.articleIds).toEqual([second.id, first.id]);
  });

  it("allows an existing series to become empty and deletes only an empty series", async () => {
    const identity = await adminIdentity();
    const first = await createCmsArticle(testEnv.CMS_DB, identity, article("empty-source"), NOW);
    const created = await createCmsSeries(testEnv.CMS_DB, identity, {
      articleIds: [first.id],
      description: "移行後に削除するシリーズです。",
      slug: "empty-source-series",
      title: "空にするシリーズ"
    });

    await expect(deleteCmsSeries(
      testEnv.CMS_DB,
      identity,
      created.id,
      created.lockVersion
    )).rejects.toMatchObject({ code: "series_not_empty" });

    const emptied = await updateCmsSeries(testEnv.CMS_DB, identity, created.id, created.lockVersion, {
      articleIds: [],
      description: created.description,
      slug: created.slug,
      title: created.title
    });
    expect(emptied).toMatchObject({ articleIds: [], lockVersion: 2, revisionNumber: 2 });
    expect((await listCmsSeriesVersions(testEnv.CMS_DB, identity, created.id))[0])
      .toMatchObject({ articleIds: [], isCurrent: true, number: 2 });

    await deleteCmsSeries(testEnv.CMS_DB, identity, created.id, emptied.lockVersion);
    expect(await listCmsSeries(testEnv.CMS_DB, identity)).toEqual([]);
    expect(await testEnv.CMS_DB.prepare(
      "SELECT action FROM cms_audit_events WHERE action = 'series.deleted'"
    ).first("action")).toBe("series.deleted");
  });

  it("merges two series in the requested order and removes the source", async () => {
    const identity = await adminIdentity();
    const first = await createCmsArticle(testEnv.CMS_DB, identity, article("merge-first"), NOW);
    const second = await createCmsArticle(testEnv.CMS_DB, identity, article("merge-second"), NOW);
    const third = await createCmsArticle(testEnv.CMS_DB, identity, article("merge-third"), NOW);
    const source = await createCmsSeries(testEnv.CMS_DB, identity, {
      articleIds: [first.id, second.id],
      description: "統合元です。",
      slug: "merge-source",
      title: "統合元"
    });
    const target = await createCmsSeries(testEnv.CMS_DB, identity, {
      articleIds: [third.id],
      description: "統合先です。",
      slug: "merge-target",
      title: "統合先"
    });

    await expect(mergeCmsSeries(testEnv.CMS_DB, identity, {
      articleIds: [third.id, first.id],
      sourceExpectedVersion: source.lockVersion,
      sourceSeriesId: source.id,
      targetExpectedVersion: target.lockVersion,
      targetSeriesId: target.id
    })).rejects.toMatchObject({ code: "invalid_series" });

    const merged = await mergeCmsSeries(testEnv.CMS_DB, identity, {
      articleIds: [third.id, second.id, first.id],
      sourceExpectedVersion: source.lockVersion,
      sourceSeriesId: source.id,
      targetExpectedVersion: target.lockVersion,
      targetSeriesId: target.id
    });
    expect(merged).toMatchObject({
      articleIds: [third.id, second.id, first.id],
      id: target.id,
      lockVersion: 2,
      revisionNumber: 2
    });
    await expect(listCmsSeriesVersions(testEnv.CMS_DB, identity, source.id))
      .rejects.toMatchObject({ code: "series_not_found" });
    expect(await testEnv.CMS_DB.prepare(
      "SELECT action FROM cms_audit_events WHERE action = 'series.merged'"
    ).first("action")).toBe("series.merged");
  });
});

async function adminIdentity() {
  const session = await resolveCmsSession(
    testEnv.CMS_DB,
    { email: "owner@example.com", subject: "owner-subject" },
    "owner@example.com",
    NOW
  );
  return session.identity;
}

function article(slug: string) {
  return {
    frontmatter: {
      approach: "development" as const,
      authors: ["Noema編集部"],
      description: `${slug}の記事説明です。`,
      estimatedMinutes: 5,
      heroImage: null,
      outcome: `${slug}を理解できる`,
      prerequisites: [],
      slug,
      sources: [],
      status: "draft" as const,
      tags: [],
      title: `${slug}の記事`,
      topics: ["development-environment" as const],
      updatedAt: "2026-08-21"
    },
    markdown: `## ${slug}\n\nシリーズの記事です。`,
    visibility: "public" as const
  };
}
