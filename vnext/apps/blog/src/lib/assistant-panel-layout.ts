export const defaultAssistantPanelWidth = 448;
export const minimumAssistantPanelWidth = 320;
export const assistantPanelCloseThreshold = minimumAssistantPanelWidth;

const maximumAssistantPanelWidth = 640;
const maximumViewportShare = 0.45;

export function getAssistantPanelWidthBounds(viewportWidth: number): { max: number; min: number } {
  return {
    min: minimumAssistantPanelWidth,
    max: Math.max(
      minimumAssistantPanelWidth,
      Math.min(maximumAssistantPanelWidth, Math.round(viewportWidth * maximumViewportShare))
    )
  };
}

export function resolveAssistantPanelResize(
  requestedWidth: number,
  viewportWidth: number
): { shouldClose: boolean; width: number } {
  const bounds = getAssistantPanelWidthBounds(viewportWidth);
  if (requestedWidth < assistantPanelCloseThreshold) {
    return { shouldClose: true, width: bounds.min };
  }
  return {
    shouldClose: false,
    width: Math.min(bounds.max, Math.max(bounds.min, requestedWidth))
  };
}
