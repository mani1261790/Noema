import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StudioMcpConnection } from "../src/StudioMcpConnection";
import { mcpDiagnostics } from "../src/mcp-connection";
import { readStudioView, studioViewHref } from "../src/studio-navigation";

describe("MCP connection guidance", () => {
  it("is reachable by a stable URL including history and trailing slash", () => {
    expect(studioViewHref("connection")).toBe("/connection");
    expect(readStudioView("/connection/")).toBe("connection");
  });

  it("offers a selectable endpoint and safe verification without claiming connection", () => {
    const html = renderToStaticMarkup(createElement(StudioMcpConnection));
    expect(html).toContain('id="studio-mcp-endpoint"');
    expect(html).toContain('readOnly=""');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain("外部クライアントの接続状態はこの画面では確認できません");
    expect(html.indexOf("studio_whoami")).toBeLessThan(html.indexOf("studio_list_articles"));
    expect(html.indexOf("studio_list_articles")).toBeLessThan(html.indexOf("studio_validate_draft"));
    expect(html).toContain("capabilities.canEdit");
    expect(html).toContain("保存を明示的に選んだときだけ");
    expect(html).toContain("internal");
    expect(html).toContain("選択内容は送信・保存しません");
    expect(html).not.toContain("textarea");
  });

  it("separates client registration from server identity and permissions", () => {
    const byId = Object.fromEntries(mcpDiagnostics.map((item) => [item.id, item.next]));
    expect(byId.client).toContain("Noemaの認証障害とは判断できません");
    expect(byId.unauthorized).toContain("再認証");
    expect(byId.member).toContain("初回登録");
    expect(byId.scope).toContain("--scopes openid");
    expect(byId.forbidden).toContain("capabilities.canEdit");
    expect(byId.network).toContain("同じrequestId");
  });
});
