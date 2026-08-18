import { env } from "cloudflare:workers";
import {
  applyD1Migrations,
  createExecutionContext,
  type D1Migration
} from "cloudflare:test";
import {
  Client,
  StreamableHTTPClientTransport,
  type FetchLike
} from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { CmsSession } from "@noema/cms";
import { AccessTokenRejectedError } from "../../studio/worker/access";
import {
  createStudioMcpServer,
  handleStudioMcpRequest
} from "../src/index";

const testEnv = env as Env & { CMS_TEST_MIGRATIONS: D1Migration[] };
const SESSION: CmsSession = {
  capabilities: {
    canApprove: false,
    canEdit: true,
    canManageMembers: false,
    canPublish: false
  },
  identity: {
    email: "editor@example.com",
    role: "editor",
    subject: "editor-subject"
  }
};

beforeAll(async () => {
  await applyD1Migrations(testEnv.CMS_DB, testEnv.CMS_TEST_MIGRATIONS);
});

beforeEach(async () => {
  await testEnv.CMS_DB.batch([
    testEnv.CMS_DB.prepare("DELETE FROM cms_article_audiences"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_asset_references"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_mcp_idempotency"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_audit_events"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_article_revisions"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_articles"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_assets"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_asset_imports"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_members"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_member_invitations")
  ]);
  await testEnv.CMS_DB.prepare(
    `INSERT INTO cms_members
      (subject, email, role, active, created_at, updated_at)
     VALUES (?1, ?2, 'editor', 1, ?3, ?3)`
  ).bind(
    SESSION.identity.subject,
    SESSION.identity.email,
    "2026-08-19T00:00:00.000Z"
  ).run();
});

describe("Studio MCP tools", () => {
  it("exposes only draft-safe tools and returns the current CMS identity", async () => {
    const connection = await connectClient();
    const tools = await connection.client.listTools();

    expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
      "studio_create_draft",
      "studio_get_article",
      "studio_list_articles",
      "studio_update_draft",
      "studio_validate_draft",
      "studio_whoami"
    ]);

    const result = await connection.client.callTool({
      name: "studio_whoami",
      arguments: {}
    });
    expect(result.structuredContent).toEqual({
      capabilities: SESSION.capabilities,
      identity: SESSION.identity
    });

    await connection.close();
  });

  it("validates without mutating and creates or updates once across retries", async () => {
    const connection = await connectClient();
    const input = validArticle("mcp-draft");
    const validation = await connection.client.callTool({
      name: "studio_validate_draft",
      arguments: input
    });
    expect(validation.structuredContent).toMatchObject({ valid: true });

    const createArguments = {
      ...input,
      requestId: "00000000-0000-4000-8000-000000000001"
    };
    const [created, replayedCreate] = await Promise.all([
      connection.client.callTool({
        name: "studio_create_draft",
        arguments: createArguments
      }),
      connection.client.callTool({
        name: "studio_create_draft",
        arguments: createArguments
      })
    ]);
    const createdArticle = articleFrom(created.structuredContent);
    expect(articleFrom(replayedCreate.structuredContent).id).toBe(createdArticle.id);

    const updateArguments = {
      ...validArticle("mcp-draft-updated"),
      articleId: createdArticle.id,
      expectedVersion: createdArticle.lockVersion,
      requestId: "00000000-0000-4000-8000-000000000002"
    };
    const updated = await connection.client.callTool({
      name: "studio_update_draft",
      arguments: updateArguments
    });
    const replayedUpdate = await connection.client.callTool({
      name: "studio_update_draft",
      arguments: updateArguments
    });
    expect(articleFrom(updated.structuredContent)).toMatchObject({
      id: createdArticle.id,
      lockVersion: 2,
      revisionNumber: 2,
      slug: "mcp-draft-updated"
    });
    expect(articleFrom(replayedUpdate.structuredContent).revisionNumber).toBe(2);

    const staleUpdate = await connection.client.callTool({
      name: "studio_update_draft",
      arguments: {
        ...validArticle("stale-update"),
        articleId: createdArticle.id,
        expectedVersion: createdArticle.lockVersion,
        requestId: "00000000-0000-4000-8000-000000000004"
      }
    });
    expect(staleUpdate.isError).toBe(true);
    expect(JSON.parse(
      staleUpdate.content[0]?.type === "text" ? staleUpdate.content[0].text : "{}"
    )).toMatchObject({ error: { code: "revision_conflict" } });

    const counts = await testEnv.CMS_DB.prepare(
      `SELECT
        (SELECT COUNT(*) FROM cms_articles) AS articles,
        (SELECT COUNT(*) FROM cms_article_revisions) AS revisions,
        (SELECT COUNT(*) FROM cms_mcp_idempotency) AS idempotency_keys`
    ).first<{ articles: number; idempotency_keys: number; revisions: number }>();
    expect(counts).toEqual({ articles: 1, idempotency_keys: 2, revisions: 2 });

    const audit = await testEnv.CMS_DB.prepare(
      "SELECT metadata_json FROM cms_audit_events WHERE action = 'article.revised'"
    ).first<{ metadata_json: string }>();
    expect(JSON.parse(audit?.metadata_json ?? "{}")).toMatchObject({
      channel: "mcp",
      client: "Noema MCP test",
      requestId: updateArguments.requestId,
      tool: "studio_update_draft"
    });

    await connection.close();
  });

  it("rejects reuse of an idempotency key with different input", async () => {
    const connection = await connectClient();
    const requestId = "00000000-0000-4000-8000-000000000003";
    await connection.client.callTool({
      name: "studio_create_draft",
      arguments: { ...validArticle("first-draft"), requestId }
    });
    const conflict = await connection.client.callTool({
      name: "studio_create_draft",
      arguments: { ...validArticle("different-draft"), requestId }
    });

    expect(conflict.isError).toBe(true);
    expect(JSON.parse(conflict.content[0]?.type === "text" ? conflict.content[0].text : "{}"))
      .toMatchObject({ error: { code: "idempotency_conflict" } });
    await connection.close();
  });
});

describe("Studio MCP HTTP boundary", () => {
  it("keeps non-MCP paths closed and requires an Access assertion", async () => {
    const ctx = createExecutionContext();
    const notFound = await handleStudioMcpRequest(
      new Request("https://mcp.noema-learn.uk/"),
      testEnv,
      ctx
    );
    const unauthorized = await handleStudioMcpRequest(
      new Request("https://mcp.noema-learn.uk/mcp"),
      testEnv,
      ctx
    );
    expect(notFound.status).toBe(404);
    expect(unauthorized.status).toBe(401);
  });

  it("rejects an invalid Access assertion before MCP dispatch", async () => {
    const result = await handleStudioMcpRequest(
      new Request("https://mcp.noema-learn.uk/mcp", {
        headers: { "cf-access-jwt-assertion": "invalid-token" },
        method: "POST"
      }),
      testEnv,
      createExecutionContext(),
      {
        verifyAccessToken: async () => {
          throw new AccessTokenRejectedError();
        }
      }
    );
    expect(result.status).toBe(401);
    await expect(result.json()).resolves.toMatchObject({
      error: { code: "unauthorized" }
    });
  });

  it("serves tool discovery over authenticated Streamable HTTP", async () => {
    const fetch: FetchLike = async (input, init) => {
      const request = new Request(input, init);
      request.headers.set("cf-access-jwt-assertion", "test-token");
      request.headers.set("host", "mcp.noema-learn.uk");
      return handleStudioMcpRequest(
        request,
        testEnv,
        createExecutionContext(),
        { verifyAccessToken: async () => SESSION.identity }
      );
    };
    const transport = new StreamableHTTPClientTransport(
      new URL("https://mcp.noema-learn.uk/mcp"),
      { fetch }
    );
    const client = new Client({ name: "http-test", version: "0.1.0" });
    await client.connect(transport);
    const tools = await client.listTools();

    expect(tools.tools).toHaveLength(6);
    expect(tools.tools.some((tool) => tool.name === "studio_create_draft")).toBe(true);
    await client.close();
  });
});

async function connectClient() {
  const server = createStudioMcpServer(testEnv.CMS_DB, SESSION, "Noema MCP test");
  const client = new Client({ name: "noema-test", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport)
  ]);
  return {
    client,
    async close() {
      await Promise.all([client.close(), server.close()]);
    }
  };
}

function articleFrom(value: unknown): {
  id: string;
  lockVersion: number;
  revisionNumber: number;
  slug: string;
} {
  const article = (value as { article?: unknown } | undefined)?.article;
  if (!article || typeof article !== "object") throw new Error("Missing article result.");
  return article as {
    id: string;
    lockVersion: number;
    revisionNumber: number;
    slug: string;
  };
}

function validArticle(slug: string) {
  return {
    frontmatter: {
      title: "MCP記事",
      description: "Studio MCPで管理する記事の説明です。",
      slug,
      status: "draft" as const,
      updatedAt: "2026-08-19",
      authors: ["Noema編集部"],
      topics: ["development-environment" as const],
      tags: ["MCP"],
      approach: "development" as const,
      outcome: "MCPから安全に下書きを保存できる",
      prerequisites: [],
      estimatedMinutes: 10,
      heroImage: null,
      sources: []
    },
    markdown: "## MCPで管理する\n\n記事本文をD1のrevisionとして保存します。",
    visibility: "internal" as const
  };
}
