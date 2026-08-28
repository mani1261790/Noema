import { describe, expect, it } from "vitest";
import {
  assistantPanelCloseThreshold,
  defaultAssistantPanelWidth,
  getAssistantPanelWidthBounds,
  minimumAssistantPanelWidth,
  resolveAssistantPanelResize
} from "./assistant-panel-layout";

describe("assistant panel layout", () => {
  it("keeps the panel within a useful desktop range", () => {
    expect(defaultAssistantPanelWidth).toBe(448);
    expect(getAssistantPanelWidthBounds(1440)).toEqual({ min: 320, max: 640 });
    expect(getAssistantPanelWidthBounds(1024)).toEqual({ min: 320, max: 461 });
    expect(resolveAssistantPanelResize(520, 1440)).toEqual({ shouldClose: false, width: 520 });
    expect(resolveAssistantPanelResize(900, 1440)).toEqual({ shouldClose: false, width: 640 });
  });

  it("closes when the reader tries to drag narrower than the minimum", () => {
    expect(minimumAssistantPanelWidth).toBe(320);
    expect(assistantPanelCloseThreshold).toBe(320);
    expect(resolveAssistantPanelResize(320, 1440)).toEqual({ shouldClose: false, width: 320 });
    expect(resolveAssistantPanelResize(319, 1440)).toEqual({ shouldClose: true, width: 320 });
  });
});
