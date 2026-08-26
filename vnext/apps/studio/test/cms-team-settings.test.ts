import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CmsMember } from "@noema/cms";
import { CmsTeamSettings } from "../src/CmsTeamSettings";

const members: CmsMember[] = [
  {
    active: true,
    displayName: "Noema管理者",
    email: "owner@example.com",
    passwordLoginReadyAt: null,
    provisioned: true,
    role: "admin",
    updatedAt: "2026-08-12T00:00:00.000Z"
  },
  {
    active: true,
    displayName: null,
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
  connection: { displayName: "Noema管理者", email: "owner@example.com", kind: "ready", publicId: "0123456789abcdef0123456789abcdef", role: "admin" },
  email: "",
  error: null,
  members,
  onActiveChange: () => undefined,
  onEdit: () => undefined,
  onEmailChange: () => undefined,
  onProfileNameChange: () => undefined,
  onProfileSubmit: () => undefined,
  onRetry: () => undefined,
  onRoleChange: () => undefined,
  onSubmit: () => undefined,
  profileBusy: false,
  profileError: null,
  profileName: "Noema管理者",
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
  });

  it("protects the signed-in member and offers editing for other members", () => {
    const html = renderTeam();

    expect(html.match(/アクセスを編集/g)).toHaveLength(1);
    expect(html.match(/>自分</g)).toHaveLength(1);
  });

  it("shows connection failures without rendering the invitation form", () => {
    const html = renderTeam({ connection: { kind: "unavailable", message: "接続できません" } });

    expect(html).toContain("プロフィールを表示できません");
    expect(html).toContain("接続できません");
    expect(html).not.toContain('type="email"');
  });

  it("lets non-admin members edit only their own public name", () => {
    const html = renderTeam({
      connection: { displayName: "レビュー担当", email: "reviewer@example.com", kind: "ready", publicId: "fedcba9876543210fedcba9876543210", role: "reviewer" },
      profileName: "レビュー担当"
    });

    expect(html).toContain("自分の公開名");
    expect(html).toContain("本文は編集できません");
    expect(html).not.toContain("メンバーのアクセス管理");
  });
});
