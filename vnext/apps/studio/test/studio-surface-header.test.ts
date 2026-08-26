import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StudioSurfaceHeader } from "../src/StudioSurfaceHeader";

describe("StudioSurfaceHeader", () => {
  it("uses one accessible close action across panels and dialogs", () => {
    const html = renderToStaticMarkup(createElement(StudioSurfaceHeader, {
      description: "必要な項目だけ確認できます。",
      eyebrow: "Assets",
      onClose: () => undefined,
      title: "記事情報",
      titleId: "surface-heading"
    }));

    expect(html).toContain('class="studio-surface-header"');
    expect(html).toContain('id="surface-heading"');
    expect(html).toContain('aria-label="記事情報を閉じる"');
    expect(html).toContain('class="dads-button studio-surface-header__close"');
    expect(html).toContain('data-size="sm"');
    expect(html).toContain('data-type="outline"');
  });
});
