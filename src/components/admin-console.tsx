"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type QuestionItem = {
  id: string;
  user: { email: string | null; name: string | null };
  notebookId: string;
  sectionId: string;
  questionText: string;
  status: string;
  createdAt: string;
  answerText: string | null;
};

type NotebookNode = {
  id: string;
  title: string;
  order: number;
  tags: string[];
  colabUrl: string;
  videoUrl?: string;
  htmlPath: string;
};

type ChapterNode = {
  id: string;
  title: string;
  order: number;
  notebooks: NotebookNode[];
};

type DragPayload =
  | {
      kind: "chapter";
      chapterId: string;
    }
  | {
      kind: "notebook";
      notebookId: string;
      fromChapterId: string;
    };

type Props = {
  initialQuestions: QuestionItem[];
  initialChapters: ChapterNode[];
};

function sortChapters(chapters: ChapterNode[]) {
  return chapters
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((chapter) => ({
      ...chapter,
      notebooks: chapter.notebooks.slice().sort((a, b) => a.order - b.order)
    }));
}

function reindexChapters(chapters: ChapterNode[]) {
  return chapters.map((chapter, chapterIndex) => ({
    ...chapter,
    order: chapterIndex + 1,
    notebooks: chapter.notebooks.map((notebook, notebookIndex) => ({
      ...notebook,
      order: notebookIndex + 1
    }))
  }));
}

function getStructurePayload(chapters: ChapterNode[]) {
  return chapters.map((chapter, chapterIndex) => ({
    id: chapter.id,
    title: chapter.title,
    order: chapterIndex + 1,
    notebooks: chapter.notebooks.map((notebook, notebookIndex) => ({
      id: notebook.id,
      title: notebook.title,
      order: notebookIndex + 1
    }))
  }));
}

function findNotebook(chapters: ChapterNode[], notebookId: string | null) {
  if (!notebookId) return null;
  for (const chapter of chapters) {
    const notebook = chapter.notebooks.find((item) => item.id === notebookId);
    if (notebook) {
      return { chapter, notebook };
    }
  }
  return null;
}

function moveChapter(chapters: ChapterNode[], sourceChapterId: string, targetChapterId: string) {
  if (sourceChapterId === targetChapterId) {
    return chapters;
  }

  const next = chapters.slice();
  const sourceIndex = next.findIndex((chapter) => chapter.id === sourceChapterId);
  const targetIndex = next.findIndex((chapter) => chapter.id === targetChapterId);
  if (sourceIndex < 0 || targetIndex < 0) {
    return chapters;
  }

  const [source] = next.splice(sourceIndex, 1);
  next.splice(targetIndex, 0, source);
  return reindexChapters(next);
}

function moveNotebook(
  chapters: ChapterNode[],
  fromChapterId: string,
  notebookId: string,
  toChapterId: string,
  beforeNotebookId?: string
) {
  const next = chapters.map((chapter) => ({
    ...chapter,
    notebooks: chapter.notebooks.slice()
  }));

  const fromChapter = next.find((chapter) => chapter.id === fromChapterId);
  const toChapter = next.find((chapter) => chapter.id === toChapterId);
  if (!fromChapter || !toChapter) {
    return chapters;
  }

  const sourceIndex = fromChapter.notebooks.findIndex((notebook) => notebook.id === notebookId);
  if (sourceIndex < 0) {
    return chapters;
  }

  const [item] = fromChapter.notebooks.splice(sourceIndex, 1);

  if (!beforeNotebookId) {
    toChapter.notebooks.push(item);
    return reindexChapters(next);
  }

  const targetIndex = toChapter.notebooks.findIndex((notebook) => notebook.id === beforeNotebookId);
  if (targetIndex < 0) {
    toChapter.notebooks.push(item);
  } else {
    toChapter.notebooks.splice(targetIndex, 0, item);
  }

  return reindexChapters(next);
}

function createSectionId() {
  return `chapter-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function AdminConsole({ initialQuestions, initialChapters }: Props) {
  const [questions, setQuestions] = useState<QuestionItem[]>(initialQuestions);
  const [chapters, setChapters] = useState<ChapterNode[]>(() => reindexChapters(sortChapters(initialChapters)));
  const [openMap, setOpenMap] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(initialChapters.map((chapter) => [chapter.id, true]))
  );

  const [activeNotebookId, setActiveNotebookId] = useState<string | null>(() => {
    const first = sortChapters(initialChapters).flatMap((chapter) => chapter.notebooks)[0];
    return first?.id ?? null;
  });

  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingCatalog, setLoadingCatalog] = useState(false);

  const [busyUpload, setBusyUpload] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);

  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [structureSaveMessage, setStructureSaveMessage] = useState<string>("未保存");
  const [structureSaving, setStructureSaving] = useState(false);
  const [dragPayload, setDragPayload] = useState<DragPayload | null>(null);

  const [ipynbRaw, setIpynbRaw] = useState("");
  const [loadingIpynb, setLoadingIpynb] = useState(false);
  const [ipynbMessage, setIpynbMessage] = useState<string>("ノートを選択してください");
  const [ipynbSaving, setIpynbSaving] = useState(false);

  const structureSkipFirstRef = useRef(true);
  const contentSkipFirstRef = useRef(true);
  const activeNotebookRef = useRef<string | null>(activeNotebookId);
  const notebookLoadSeqRef = useRef(0);

  activeNotebookRef.current = activeNotebookId;

  const sortedQuestions = useMemo(
    () => questions.slice().sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)),
    [questions]
  );

  const activeSelection = useMemo(() => findNotebook(chapters, activeNotebookId), [chapters, activeNotebookId]);
  const activeNotebook = activeSelection?.notebook ?? null;

  const structureFingerprint = useMemo(() => JSON.stringify(getStructurePayload(chapters)), [chapters]);

  const ipynbJsonValid = useMemo(() => {
    if (!ipynbRaw.trim()) return false;
    try {
      JSON.parse(ipynbRaw);
      return true;
    } catch {
      return false;
    }
  }, [ipynbRaw]);

  const refreshQuestions = useCallback(async () => {
    const response = await fetch("/api/admin/questions");
    if (!response.ok) return;
    const data = (await response.json()) as { items: QuestionItem[] };
    setQuestions(data.items);
  }, []);

  const reloadCatalog = useCallback(async () => {
    setLoadingCatalog(true);
    setLoadError(null);
    try {
      const response = await fetch("/api/admin/notebooks", { cache: "no-store" });
      if (!response.ok) {
        throw new Error("教材一覧の取得に失敗しました。");
      }

      const data = (await response.json()) as { chapters: ChapterNode[] };
      const nextChapters = reindexChapters(sortChapters(data.chapters ?? []));
      structureSkipFirstRef.current = true;
      setChapters(nextChapters);
      setOpenMap((prev) => {
        const next = { ...prev };
        nextChapters.forEach((chapter) => {
          if (!(chapter.id in next)) {
            next[chapter.id] = true;
          }
        });
        return next;
      });

      if (!nextChapters.some((chapter) => chapter.notebooks.some((notebook) => notebook.id === activeNotebookRef.current))) {
        const first = nextChapters.flatMap((chapter) => chapter.notebooks)[0];
        setActiveNotebookId(first?.id ?? null);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "教材一覧の取得に失敗しました。";
      setLoadError(message);
    } finally {
      setLoadingCatalog(false);
    }
  }, []);

  const loadNotebookRaw = useCallback(async (notebookId: string) => {
    const loadSeq = notebookLoadSeqRef.current + 1;
    notebookLoadSeqRef.current = loadSeq;
    setLoadingIpynb(true);
    setIpynbMessage("読み込み中...");

    try {
      const response = await fetch(`/api/admin/notebooks/${encodeURIComponent(notebookId)}`, {
        cache: "no-store"
      });
      if (!response.ok) {
        throw new Error("ipynbの取得に失敗しました。");
      }

      const data = (await response.json()) as { ipynbRaw?: string };
      if (notebookLoadSeqRef.current !== loadSeq || activeNotebookRef.current !== notebookId) {
        return;
      }
      contentSkipFirstRef.current = true;
      setIpynbRaw(String(data.ipynbRaw ?? ""));
      setIpynbMessage("ipynbを読み込みました");
    } catch (error) {
      const message = error instanceof Error ? error.message : "ipynbの取得に失敗しました。";
      setIpynbMessage(message);
      setIpynbRaw("");
    } finally {
      setLoadingIpynb(false);
    }
  }, []);

  const saveStructure = useCallback(async (payload: ReturnType<typeof getStructurePayload>) => {
    setStructureSaving(true);
    setStructureSaveMessage("保存中...");

    try {
      const response = await fetch("/api/admin/notebooks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chapters: payload })
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "構成の保存に失敗しました");
      }

      setStructureSaveMessage(`自動保存済み ${new Date().toLocaleTimeString()}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "構成の保存に失敗しました";
      setStructureSaveMessage(message);
    } finally {
      setStructureSaving(false);
    }
  }, []);

  const saveNotebookRaw = useCallback(async (notebookId: string, raw: string) => {
    if (!notebookId) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      setIpynbMessage("JSON形式が不正です。修正後に自動保存されます。");
      return;
    }
    if (!parsed) return;

    setIpynbSaving(true);
    setIpynbMessage("ipynb保存中...");

    try {
      const response = await fetch(`/api/admin/notebooks/${encodeURIComponent(notebookId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ipynbRaw: raw })
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "ipynb保存に失敗しました");
      }

      setIpynbMessage(`ipynb自動保存済み ${new Date().toLocaleTimeString()}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "ipynb保存に失敗しました";
      setIpynbMessage(message);
    } finally {
      setIpynbSaving(false);
    }
  }, []);

  useEffect(() => {
    void reloadCatalog();
  }, [reloadCatalog]);

  useEffect(() => {
    if (!activeNotebookId) {
      setIpynbRaw("");
      setIpynbMessage("ノートを選択してください");
      return;
    }
    void loadNotebookRaw(activeNotebookId);
  }, [activeNotebookId, loadNotebookRaw]);

  useEffect(() => {
    if (structureSkipFirstRef.current) {
      structureSkipFirstRef.current = false;
      return;
    }

    const payload = getStructurePayload(chapters);
    const timer = window.setTimeout(() => {
      void saveStructure(payload);
    }, 900);

    return () => window.clearTimeout(timer);
  }, [chapters, structureFingerprint, saveStructure]);

  useEffect(() => {
    if (contentSkipFirstRef.current) {
      contentSkipFirstRef.current = false;
      return;
    }
    if (!activeNotebookId) {
      return;
    }

    const notebookId = activeNotebookId;
    const rawSnapshot = ipynbRaw;
    const timer = window.setTimeout(() => {
      void saveNotebookRaw(notebookId, rawSnapshot);
    }, 1400);

    return () => window.clearTimeout(timer);
  }, [activeNotebookId, ipynbRaw, saveNotebookRaw]);

  useEffect(() => {
    if (activeNotebookId) return;
    const first = chapters.flatMap((chapter) => chapter.notebooks)[0];
    if (first) {
      setActiveNotebookId(first.id);
    }
  }, [activeNotebookId, chapters]);

  const submitUpload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusyUpload(true);
    setUploadMessage(null);

    const form = event.currentTarget;
    const data = new FormData(form);

    const response = await fetch("/api/admin/notebooks", {
      method: "POST",
      body: data
    });

    if (!response.ok) {
      setUploadMessage("教材アップロードに失敗しました");
      setBusyUpload(false);
      return;
    }

    setUploadMessage("教材を登録しました。ipynb/HTML/索引を更新しました。");
    setBusyUpload(false);
    form.reset();
    await reloadCatalog();
  };

  const saveAnswer = async (questionId: string, answerText: string) => {
    setSaveMessage(null);

    const response = await fetch("/api/admin/questions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ questionId, answerText })
    });

    if (!response.ok) {
      setSaveMessage("回答更新に失敗しました");
      return;
    }

    setSaveMessage("回答を更新しました");
    await refreshQuestions();
  };

  const renameChapter = (chapterId: string, title: string) => {
    setChapters((prev) =>
      reindexChapters(
        prev.map((chapter) => (chapter.id === chapterId ? { ...chapter, title } : chapter))
      )
    );
  };

  const deleteChapter = (chapterId: string) => {
    setChapters((prev) => {
      const target = prev.find((chapter) => chapter.id === chapterId);
      if (!target) return prev;
      if (target.notebooks.length > 0) {
        return prev;
      }
      return reindexChapters(prev.filter((chapter) => chapter.id !== chapterId));
    });
  };

  const renameNotebook = (notebookId: string, title: string) => {
    setChapters((prev) =>
      reindexChapters(
        prev.map((chapter) => ({
          ...chapter,
          notebooks: chapter.notebooks.map((notebook) =>
            notebook.id === notebookId ? { ...notebook, title } : notebook
          )
        }))
      )
    );
  };

  const addSection = () => {
    const newId = createSectionId();
    setChapters((prev) =>
      reindexChapters([
        ...prev,
        {
          id: newId,
          title: "新しいセクション",
          order: prev.length + 1,
          notebooks: []
        }
      ])
    );
    setOpenMap((prev) => ({ ...prev, [newId]: true }));
  };

  const toggleChapter = (chapterId: string) => {
    setOpenMap((prev) => ({
      ...prev,
      [chapterId]: !prev[chapterId]
    }));
  };

  const onDropChapter = (chapterId: string) => {
    if (!dragPayload) return;

    if (dragPayload.kind === "chapter") {
      setChapters((prev) => moveChapter(prev, dragPayload.chapterId, chapterId));
      return;
    }

    setChapters((prev) => moveNotebook(prev, dragPayload.fromChapterId, dragPayload.notebookId, chapterId));
  };

  const onDropNotebook = (chapterId: string, notebookId: string) => {
    if (!dragPayload || dragPayload.kind !== "notebook") return;
    setChapters((prev) =>
      moveNotebook(prev, dragPayload.fromChapterId, dragPayload.notebookId, chapterId, notebookId)
    );
  };

  return (
    <main className="mx-auto h-[100dvh] w-full max-w-[1900px] p-2 md:p-3">
      <div className="flex h-full gap-2 md:gap-3">
        <aside className="glass-panel-strong flex h-full w-[340px] flex-col rounded-3xl p-3">
          <div className="mb-3 border-b border-[var(--border)] pb-3">
            <Link className="font-display text-2xl font-semibold tracking-tight" href="/">
              Noema
            </Link>
            <p className="text-muted mt-1 text-xs">Admin Notebook Editor</p>
            <div className="mt-3 flex gap-2">
              <button className="glass-button rounded-lg px-3 py-1.5 text-xs font-semibold text-white" onClick={addSection} type="button">
                + セクション
              </button>
              <button
                className="glass-button-ghost rounded-lg px-3 py-1.5 text-xs"
                disabled={loadingCatalog}
                onClick={() => void reloadCatalog()}
                type="button"
              >
                再読込
              </button>
            </div>
            <p className="text-muted mt-2 text-xs">{structureSaveMessage}</p>
          </div>

          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
            {loadError ? (
              <div className="glass-subpanel rounded-xl p-3 text-sm">
                <p className="font-semibold">Load failed</p>
                <p className="text-muted mt-1">{loadError}</p>
              </div>
            ) : null}

            {chapters.map((chapter) => {
              const opened = Boolean(openMap[chapter.id]);
              return (
                <section key={chapter.id} className="glass-subpanel rounded-xl p-2">
                  <div
                    className="flex items-center gap-2"
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      onDropChapter(chapter.id);
                    }}
                  >
                    <button
                      aria-label="drag chapter"
                      className="cursor-grab rounded-md px-2 py-1 text-sm text-[var(--muted)] active:cursor-grabbing"
                      draggable
                      onDragEnd={() => setDragPayload(null)}
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = "move";
                        setDragPayload({ kind: "chapter", chapterId: chapter.id });
                      }}
                      type="button"
                    >
                      ≡
                    </button>

                    <button
                      className="glass-button-ghost rounded-md px-1.5 py-1 text-xs"
                      onClick={() => toggleChapter(chapter.id)}
                      type="button"
                    >
                      {opened ? "▾" : "▸"}
                    </button>

                    <input
                      className="glass-input min-w-0 flex-1 rounded-md px-2 py-1 text-sm"
                      onChange={(event) => renameChapter(chapter.id, event.target.value)}
                      value={chapter.title}
                    />

                    <button
                      className="glass-button-ghost rounded-md px-2 py-1 text-xs"
                      onClick={() => deleteChapter(chapter.id)}
                      title={chapter.notebooks.length > 0 ? "ノートを移動してから削除" : "セクション削除"}
                      type="button"
                    >
                      ✕
                    </button>
                  </div>

                  {opened ? (
                    <ul className="mt-2 space-y-1 border-t border-[var(--border)] pt-2">
                      {chapter.notebooks.map((notebook) => {
                        const active = notebook.id === activeNotebookId;
                        return (
                          <li
                            key={notebook.id}
                            className={`rounded-lg border px-2 py-1 ${
                              active ? "border-[var(--accent)] bg-[color:var(--panel-strong)]" : "border-transparent"
                            }`}
                            onDragOver={(event) => event.preventDefault()}
                            onDrop={(event) => {
                              event.preventDefault();
                              onDropNotebook(chapter.id, notebook.id);
                            }}
                          >
                            <div className="flex items-center gap-2">
                              <button
                                aria-label="drag notebook"
                                className="cursor-grab rounded-md px-2 py-1 text-sm text-[var(--muted)] active:cursor-grabbing"
                                draggable
                                onDragEnd={() => setDragPayload(null)}
                                onDragStart={(event) => {
                                  event.dataTransfer.effectAllowed = "move";
                                  setDragPayload({
                                    kind: "notebook",
                                    notebookId: notebook.id,
                                    fromChapterId: chapter.id
                                  });
                                }}
                                type="button"
                              >
                                ⋮⋮
                              </button>

                              <input
                                className="glass-input min-w-0 flex-1 rounded-md px-2 py-1 text-sm"
                                onChange={(event) => renameNotebook(notebook.id, event.target.value)}
                                onFocus={() => setActiveNotebookId(notebook.id)}
                                value={notebook.title}
                              />

                              <button
                                className="glass-button-ghost rounded-md px-2 py-1 text-xs"
                                onClick={() => setActiveNotebookId(notebook.id)}
                                type="button"
                              >
                                Edit
                              </button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                </section>
              );
            })}
          </div>

          <div className="mt-3 border-t border-[var(--border)] pt-3">
            <Link className="glass-button block rounded-lg px-3 py-2 text-center text-sm font-semibold text-white" href="/login">
              ログインページ
            </Link>
          </div>
        </aside>

        <section className="glass-panel-strong flex min-w-0 flex-1 flex-col overflow-hidden rounded-3xl">
          <header className="border-b border-[var(--border)] bg-[color:var(--panel-strong)]/90 px-4 py-3 backdrop-blur-xl md:px-5">
            <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
              <div className="text-muted text-xs">{structureSaving ? "構成保存中..." : "構成は自動保存"}</div>
              <h1 className="truncate text-center font-display text-xl font-semibold md:text-2xl">
                {activeNotebook?.title ?? "ノート未選択"}
              </h1>
              <div className="flex justify-end gap-2">
                {activeNotebook ? (
                  <a
                    className="glass-button-ghost rounded-lg px-3 py-1.5 text-xs md:text-sm"
                    href={`/api/notebooks/${encodeURIComponent(activeNotebook.id)}/download`}
                  >
                    Download
                  </a>
                ) : null}
                <Link className="glass-button rounded-lg px-3 py-1.5 text-xs font-semibold text-white md:text-sm" href="/">
                  学習トップへ
                </Link>
              </div>
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-5">
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
              <section className="glass-subpanel rounded-2xl p-4">
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="font-display text-lg font-semibold">ipynb編集</h2>
                  <p className="text-muted text-xs">
                    {loadingIpynb
                      ? "読み込み中..."
                      : ipynbSaving
                        ? "保存中..."
                        : ipynbJsonValid
                          ? ipynbMessage
                          : "JSONが不正です"}
                  </p>
                </div>

                <textarea
                  className="glass-input min-h-[58dvh] w-full rounded-xl px-3 py-3 font-mono text-xs leading-6"
                  onChange={(event) => setIpynbRaw(event.target.value)}
                  placeholder="ipynb JSON"
                  spellCheck={false}
                  value={ipynbRaw}
                />
              </section>

              <div className="space-y-4">
                <section className="glass-subpanel rounded-2xl p-4">
                  <h2 className="font-display text-lg font-semibold">教材アップロード</h2>
                  <form className="mt-3 grid gap-2" onSubmit={submitUpload}>
                    <input className="glass-input rounded-lg px-3 py-2 text-sm" name="title" placeholder="タイトル" required />
                    <input className="glass-input rounded-lg px-3 py-2 text-sm" name="chapter" placeholder="セクション" required />
                    <input
                      className="glass-input rounded-lg px-3 py-2 text-sm"
                      min={1}
                      name="order"
                      placeholder="順序"
                      required
                      type="number"
                    />
                    <input className="glass-input rounded-lg px-3 py-2 text-sm" name="tags" placeholder="タグ (comma separated)" />
                    <input className="glass-input rounded-lg px-3 py-2 text-sm" name="colabUrl" placeholder="Colab URL" required />
                    <input className="glass-input rounded-lg px-3 py-2 text-sm" name="videoUrl" placeholder="Video URL" />
                    <input
                      accept=".ipynb,application/json"
                      className="glass-input rounded-lg px-3 py-2 text-sm"
                      name="file"
                      required
                      type="file"
                    />
                    <button
                      className="glass-button rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={busyUpload}
                      type="submit"
                    >
                      {busyUpload ? "登録中..." : "ipynbを登録"}
                    </button>
                  </form>
                  {uploadMessage ? <p className="text-muted mt-2 text-xs">{uploadMessage}</p> : null}
                </section>

                <section className="glass-subpanel rounded-2xl p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <h2 className="font-display text-lg font-semibold">質問ログ</h2>
                    <button className="glass-button-ghost rounded-md px-2 py-1 text-xs" onClick={() => void refreshQuestions()} type="button">
                      更新
                    </button>
                  </div>
                  {saveMessage ? <p className="text-muted mb-2 text-xs">{saveMessage}</p> : null}

                  <div className="max-h-[36dvh] space-y-2 overflow-y-auto pr-1">
                    {sortedQuestions.length === 0 ? <p className="text-muted text-sm">まだ質問ログがありません。</p> : null}
                    {sortedQuestions.map((item) => (
                      <QuestionEditor key={item.id} item={item} onSave={saveAnswer} />
                    ))}
                  </div>
                </section>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function QuestionEditor({ item, onSave }: { item: QuestionItem; onSave: (questionId: string, answerText: string) => Promise<void> }) {
  const [answerText, setAnswerText] = useState(item.answerText ?? "");

  return (
    <article className="rounded-lg border border-[var(--border)] bg-[color:var(--panel)] px-3 py-2">
      <p className="text-muted text-[11px]">
        {item.user.email ?? "unknown"} | {new Date(item.createdAt).toLocaleString()} | {item.notebookId}#{item.sectionId}
      </p>
      <p className="mt-1 text-xs">Q: {item.questionText}</p>
      <textarea
        className="glass-input mt-2 min-h-20 w-full rounded-lg px-2 py-2 text-xs"
        onChange={(event) => setAnswerText(event.target.value)}
        value={answerText}
      />
      <button
        className="glass-button-ghost mt-2 rounded-md px-2 py-1 text-xs"
        onClick={() => void onSave(item.id, answerText)}
        type="button"
      >
        回答を保存
      </button>
    </article>
  );
}
