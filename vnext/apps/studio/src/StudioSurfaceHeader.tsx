import type { ReactNode, RefObject } from "react";

export function StudioSurfaceHeader({
  description,
  eyebrow,
  headingRef,
  onClose,
  title,
  titleId
}: {
  description?: ReactNode;
  eyebrow?: ReactNode;
  headingRef?: RefObject<HTMLHeadingElement | null>;
  onClose: () => void;
  title: ReactNode;
  titleId: string;
}) {
  return (
    <header className="studio-surface-header">
      <div>
        {eyebrow ? <p className="studio-library__eyebrow">{eyebrow}</p> : null}
        <h2 id={titleId} ref={headingRef} tabIndex={headingRef ? -1 : undefined}>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      <button
        aria-label={`${typeof title === "string" ? title : "パネル"}を閉じる`}
        className="dads-button studio-surface-header__close"
        data-size="sm"
        data-type="outline"
        onClick={onClose}
        type="button"
      >
        閉じる
      </button>
    </header>
  );
}
