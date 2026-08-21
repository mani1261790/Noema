import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CmsSession } from "@noema/cms";
import { CmsLogin } from "../src/CmsLogin";
import { CmsPasswordLoginMigration } from "../src/CmsPasswordLoginMigration";

const session: CmsSession = {
  capabilities: {
    canApprove: true,
    canComment: true,
    canEdit: true,
    canManageMembers: true,
    canPublish: true
  },
  identity: {
    email: "owner@example.com",
    role: "admin",
    subject: "owner-subject"
  },
  passwordLoginReadyAt: null
};

describe("Studio authentication UI", () => {
  it("uses password-manager-compatible fields for sign-in", () => {
    const html = renderToStaticMarkup(createElement(CmsLogin, {
      busy: false,
      error: null,
      onSubmit: async () => undefined
    }));

    expect(html).toContain('autoComplete="username"');
    expect(html).toContain('autoComplete="current-password"');
    expect(html).toContain('type="email"');
    expect(html).toContain('type="password"');
  });

  it("binds initial password setup to the current CMS email", () => {
    const html = renderToStaticMarkup(createElement(CmsPasswordLoginMigration, {
      busy: false,
      error: null,
      onSubmit: async () => undefined,
      session
    }));

    expect(html).toContain("owner@example.com");
    expect(html.match(/autoComplete="new-password"/g)).toHaveLength(2);
    expect(html).toContain('minLength="12"');
  });

  it("removes the migration prompt after password setup", () => {
    const html = renderToStaticMarkup(createElement(CmsPasswordLoginMigration, {
      busy: false,
      error: null,
      onSubmit: async () => undefined,
      session: { ...session, passwordLoginReadyAt: "2026-08-20T00:00:00.000Z" }
    }));

    expect(html).toBe("");
  });
});
