import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CmsMember } from "@noema/cms";
import { CmsTeamSettings } from "../src/CmsTeamSettings";

const members: CmsMember[] = [
  {
    active: true,
    email: "owner@example.com",
    passwordLoginReadyAt: "2026-08-20T00:00:00.000Z",
    provisioned: true,
    role: "admin",
    updatedAt: "2026-08-12T00:00:00.000Z"
  },
  {
    active: true,
    email: "editor@example.com",
    passwordLoginReadyAt: null,
    provisioned: false,
    role: "editor",
    updatedAt: "2026-08-12T00:00:00.000Z"
  }
];

const baseProps: ComponentProps<typeof CmsTeamSettings> = {
  active: true,
  busy: false,
  connection: { email: "owner@example.com", kind: "ready", role: "admin" },
  email: "",
  error: null,
  members,
  onActiveChange: () => undefined,
  onEdit: () => undefined,
  onEmailChange: () => undefined,
  onCopyInstructions: () => undefined,
  onRetry: () => undefined,
  onRoleChange: () => undefined,
  onSubmit: () => undefined,
  role: "editor"
};

function renderTeam(overrides: Partial<ComponentProps<typeof CmsTeamSettings>> = {}): string {
  return renderToStaticMarkup(createElement(CmsTeamSettings, { ...baseProps, ...overrides }));
}

describe("CmsTeamSettings", () => {
  it("keeps invitation fields and current access in separate sections", () => {
    const html = renderTeam();

    expect(html).toContain('id="studio-team-heading"');
    expect(html).toContain('id="studio-team-invite-heading"');
    expect(html).toContain('id="studio-team-members-heading"');
    expect(html).toContain('type="email"');
    expect(html).toContain("2人");
    expect(html).toContain("招待待ち");
    expect(html).toContain("1/1人準備済み");
    expect(html).toContain("パスワード準備済み");
    expect(html).toContain("利用開始後にパスワードを案内");
  });

  it("protects the signed-in member and offers editing for other members", () => {
    const html = renderTeam();

    expect(html.match(/設定を編集/g)).toHaveLength(1);
    expect(html.match(/>自分</g)).toHaveLength(1);
    expect(html.match(/案内をコピー/g)).toHaveLength(2);
  });

  it("shows connection failures without rendering the invitation form", () => {
    const html = renderTeam({ connection: { kind: "unavailable", message: "接続できません" } });

    expect(html).toContain("チームを表示できません");
    expect(html).toContain("接続できません");
    expect(html).not.toContain('type="email"');
  });
});
