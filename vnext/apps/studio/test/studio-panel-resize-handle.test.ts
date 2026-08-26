import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  clampStudioPanelWidth,
  defaultStudioPanelWidth,
  getStudioPanelWidthBounds,
  StudioPanelResizeHandle
} from "../src/StudioPanelResizeHandle";

describe("StudioPanelResizeHandle", () => {
  it("keeps a desktop panel within a readable shared range", () => {
    expect(getStudioPanelWidthBounds(1440)).toEqual({ min: 320, max: 720 });
    expect(clampStudioPanelWidth(200, 1440)).toBe(320);
    expect(clampStudioPanelWidth(900, 1440)).toBe(720);
    expect(clampStudioPanelWidth(defaultStudioPanelWidth, 1440)).toBe(544);
  });

  it("leaves room for the writing canvas on a narrow viewport", () => {
    expect(getStudioPanelWidthBounds(800)).toEqual({ min: 320, max: 480 });
    expect(clampStudioPanelWidth(defaultStudioPanelWidth, 800)).toBe(480);
  });

  it("exposes the drag handle as a keyboard-adjustable separator", () => {
    const html = renderToStaticMarkup(createElement(StudioPanelResizeHandle, {
      onResize: () => undefined,
      width: defaultStudioPanelWidth
    }));

    expect(html).toContain('role="separator"');
    expect(html).toContain('aria-orientation="vertical"');
    expect(html).toContain('aria-valuemin="320"');
    expect(html).toContain('aria-valuemax="720"');
    expect(html).toContain('aria-valuenow="544"');
    expect(html).toContain('tabindex="0"');
  });
});
