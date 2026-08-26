import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StudioNotification } from "../src/StudioNotification";

describe("StudioNotification", () => {
  it("announces actionable errors and gives them a clear default title", () => {
    const html = renderToStaticMarkup(createElement(StudioNotification, {
      message: { text: "通信状態を確認してください。", tone: "error" },
      onDismiss: () => undefined
    }));

    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-live="assertive"');
    expect(html).toContain("操作を完了できませんでした");
    expect(html).toContain("通信状態を確認してください。");
    expect(html).toContain("閉じる");
    expect(html).toContain('aria-label="通知を閉じる"');
  });

  it("uses a supplied recovery title for contextual information", () => {
    const html = renderToStaticMarkup(createElement(StudioNotification, {
      message: { text: "内容を確認してください。", title: "保存前の確認が必要です", tone: "info" },
      onDismiss: () => undefined
    }));

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("保存前の確認が必要です");
  });
});
