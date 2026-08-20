import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CmsPasswordLoginMigration } from "../src/CmsPasswordLoginMigration";
import { buildPasswordLoginInstructions } from "../src/password-login-migration";

const session: ComponentProps<typeof CmsPasswordLoginMigration>["session"] = {
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
  },
  passwordLoginReadyAt: null
};

describe("CmsPasswordLoginMigration", () => {
  it("shows the exact CMS email and requires explicit confirmation", () => {
    const html = renderToStaticMarkup(createElement(CmsPasswordLoginMigration, {
      busy: false,
      error: null,
      onReady: async () => undefined,
      session
    }));

    expect(html).toContain("editor@example.com");
    expect(html).toContain("別のメールアドレスでは現在のCMS権限を引き継げません");
    expect(html).toContain('href="https://dash.cloudflare.com/sign-up"');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('disabled=""');
  });

  it("shows a non-blocking recorded state after preparation", () => {
    const html = renderToStaticMarkup(createElement(CmsPasswordLoginMigration, {
      busy: false,
      error: null,
      onReady: async () => undefined,
      session: { ...session, passwordLoginReadyAt: "2026-08-20T00:00:00.000Z" }
    }));

    expect(html).toContain("パスワードの準備済みとして記録しました");
    expect(html).toContain("管理者から切替確認の案内が届いたら");
    expect(html).toContain("Cloudflareを選んでログインしてください");
    expect(html).toContain("メールコードも引き続き利用できます");
    expect(html).not.toContain('type="checkbox"');
  });
});

describe("buildPasswordLoginInstructions", () => {
  it("keeps the member email and safe migration warning in copied instructions", () => {
    const instructions = buildPasswordLoginInstructions("reviewer@example.com");

    expect(instructions).toContain("reviewer@example.com");
    expect(instructions).toContain("https://dash.cloudflare.com/sign-up");
    expect(instructions).toContain("別のメールアドレスを使うと、現在のCMS権限を引き継げません");
    expect(instructions).toContain("管理者から切替確認の案内が届いたら");
    expect(instructions).toContain("Cloudflareを選んでログインしてください");
    expect(instructions).toContain("OTPは移行確認が終わるまで利用できます");
  });
});
