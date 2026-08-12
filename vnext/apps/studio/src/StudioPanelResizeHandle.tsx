import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

export const defaultStudioPanelWidth = 544;
export const minimumStudioPanelWidth = 320;
export const maximumStudioPanelWidth = 720;

const panelWidthStep = 24;

export function getStudioPanelWidthBounds(viewportWidth: number): { max: number; min: number } {
  return {
    max: Math.max(
      minimumStudioPanelWidth,
      Math.min(maximumStudioPanelWidth, viewportWidth - minimumStudioPanelWidth)
    ),
    min: minimumStudioPanelWidth
  };
}

export function clampStudioPanelWidth(width: number, viewportWidth: number): number {
  const bounds = getStudioPanelWidthBounds(viewportWidth);
  return Math.min(bounds.max, Math.max(bounds.min, Math.round(width)));
}

function currentViewportWidth(): number {
  return typeof window === "undefined" ? 1440 : window.innerWidth;
}

export function StudioPanelResizeHandle({
  onResize,
  width
}: {
  onResize: (width: number) => void;
  width: number;
}) {
  const drag = useRef<{ pointerId: number; startWidth: number; startX: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const bounds = getStudioPanelWidthBounds(currentViewportWidth());

  const resizeByKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? panelWidthStep * 2 : panelWidthStep;
    let nextWidth: number | null = null;

    if (event.key === "ArrowLeft") nextWidth = width + step;
    if (event.key === "ArrowRight") nextWidth = width - step;
    if (event.key === "Home") nextWidth = bounds.min;
    if (event.key === "End") nextWidth = bounds.max;
    if (nextWidth === null) return;

    event.preventDefault();
    onResize(clampStudioPanelWidth(nextWidth, currentViewportWidth()));
  };

  const finishDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <div
      aria-label="サイドパネルの幅"
      aria-orientation="vertical"
      aria-valuemax={bounds.max}
      aria-valuemin={bounds.min}
      aria-valuenow={width}
      className={`studio-panel-resize-handle ${dragging ? "is-dragging" : ""}`}
      onKeyDown={resizeByKeyboard}
      onPointerCancel={finishDrag}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        drag.current = {
          pointerId: event.pointerId,
          startWidth: width,
          startX: event.clientX
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
      }}
      onPointerMove={(event) => {
        if (drag.current?.pointerId !== event.pointerId) return;
        const nextWidth = drag.current.startWidth + drag.current.startX - event.clientX;
        onResize(clampStudioPanelWidth(nextWidth, currentViewportWidth()));
      }}
      onPointerUp={finishDrag}
      role="separator"
      tabIndex={0}
      title="左右にドラッグして幅を変更"
    >
      <span aria-hidden="true" />
    </div>
  );
}
