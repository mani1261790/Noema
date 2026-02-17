"use client";

import { useRef, useState } from "react";

type Props = {
  src: string;
  title: string;
};

export function VideoPlayer({ src, title }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [pipBusy, setPipBusy] = useState(false);

  const enterPip = async () => {
    if (!document.pictureInPictureEnabled || !videoRef.current) return;
    try {
      setPipBusy(true);
      await videoRef.current.requestPictureInPicture();
    } finally {
      setPipBusy(false);
    }
  };

  return (
    <section className="glass-panel rounded-2xl p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold">解説動画</h2>
        <button
          className="glass-button-ghost rounded-md px-3 py-1 text-sm"
          disabled={pipBusy}
          onClick={() => void enterPip()}
          type="button"
        >
          {pipBusy ? "処理中..." : "PiPで表示"}
        </button>
      </div>
      <video ref={videoRef} className="w-full rounded-lg" controls preload="metadata" src={src}>
        <track kind="captions" />
        {title}
      </video>
    </section>
  );
}
