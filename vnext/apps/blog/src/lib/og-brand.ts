import type { ReactElement } from "react";
import appIcon from "./apple-touch-icon.txt?raw";

/** Reuse the installed app's icon without a remote image request during rendering. */
export function createOgBrand(): ReactElement {
  return {
    type: "div",
    props: {
      style: { display: "flex", alignItems: "center", gap: 18 },
      children: [
        { type: "img", props: { src: appIcon.trim(), width: 64, height: 64, style: { borderRadius: 14 } } },
        { type: "div", props: { style: { display: "flex", fontSize: 38, color: "#00645f" }, children: "Noema" } },
      ],
    },
  } as ReactElement;
}
