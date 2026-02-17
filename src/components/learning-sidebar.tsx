"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { ChapterSummary } from "@/lib/notebooks";

type Props = {
  chapters: ChapterSummary[];
  activeNotebookId?: string;
};

export function LearningSidebar({ chapters, activeNotebookId }: Props) {
  const sortedChapters = useMemo(
    () => chapters.slice().sort((a, b) => a.order - b.order),
    [chapters]
  );

  const defaultOpen = useMemo(() => {
    if (activeNotebookId) {
      const activeChapter = sortedChapters.find((chapter) =>
        chapter.notebooks.some((notebook) => notebook.id === activeNotebookId)
      );
      if (activeChapter) {
        return activeChapter.id;
      }
    }

    return sortedChapters[0]?.id ?? "";
  }, [activeNotebookId, sortedChapters]);

  const [openMap, setOpenMap] = useState<Record<string, boolean>>(defaultOpen ? { [defaultOpen]: true } : {});

  useEffect(() => {
    setOpenMap((prev) => (defaultOpen ? { ...prev, [defaultOpen]: true } : prev));
  }, [defaultOpen]);

  return (
    <aside className="glass-panel h-full rounded-2xl p-3">
      <p className="px-2 pb-2 pt-1 font-display text-lg font-semibold">教材一覧</p>
      <div className="space-y-2">
        {sortedChapters.map((chapter) => {
          const expanded = Boolean(openMap[chapter.id]);
          const panelId = `chapter-panel-${chapter.id}`;

          return (
            <div key={chapter.id} className="glass-subpanel rounded-xl">
              <button
                aria-controls={panelId}
                aria-expanded={expanded}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-semibold text-[var(--text)]"
                onClick={() => setOpenMap((prev) => ({ ...prev, [chapter.id]: !prev[chapter.id] }))}
                type="button"
              >
                <span>{chapter.title}</span>
                <span>{expanded ? "−" : "+"}</span>
              </button>
              {expanded ? (
                <ul className="space-y-1 border-t border-[var(--border)] p-2 text-sm" id={panelId}>
                  {chapter.notebooks
                    .slice()
                    .sort((a, b) => a.order - b.order)
                    .map((notebook) => {
                      const active = notebook.id === activeNotebookId;
                      return (
                        <li key={notebook.id}>
                          <Link
                            className={`block rounded-md px-2 py-2 transition ${
                              active
                                ? "glass-button text-white"
                                : "text-[var(--muted)] hover:bg-[var(--panel-strong)] hover:text-[var(--text)]"
                            }`}
                            href={`/learn/${notebook.id}`}
                          >
                            {notebook.title}
                          </Link>
                        </li>
                      );
                    })}
                </ul>
              ) : null}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
