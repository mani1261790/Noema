import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
test("MCP guide, UI, and Codex configuration preserve the same connection contract", () => {
  const config = read("../../../../.codex/config.toml");
  const guide = read("../../../../docs/studio-mcp.md");
  const ui = read("../src/mcp-connection.ts");
  const endpoint = 'https://mcp.noema-learn.uk/mcp';
  for (const source of [config, guide, ui]) assert.ok(source.includes(endpoint));
  assert.match(config, /scopes = \["openid"\]/u);
  assert.match(config, /default_tools_approval_mode = "writes"/u);
  assert.ok(guide.includes('"visibility": "internal"'));
  assert.ok(guide.includes("callback"));
  assert.ok(guide.includes("OAuth discovery"));
  assert.ok(guide.includes("実機OAuthは未検証"));
});
