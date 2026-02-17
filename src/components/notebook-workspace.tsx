"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChapterSummary, NotebookSummary } from "@/lib/notebooks";

type SourceReference = {
  notebookId: string;
  location: string;
};

type AnswerPayload = {
  answerText: string;
  sourceReferences: SourceReference[];
  tokensUsed: number;
  timestamp: string;
};

type NotebookApiPayload = {
  notebook: NotebookSummary;
  html: string;
  sectionIds: string[];
};

type SelectionContext = {
  text: string;
  sectionId?: string;
};

type Message = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  meta?: {
    sourceReferences?: SourceReference[];
    tokensUsed?: number;
    timestamp?: string;
  };
};

type SessionUser = {
  id?: string;
  name?: string | null;
  role?: "ADMIN" | "MEMBER";
};

type Props = {
  chapters: ChapterSummary[];
  initialNotebook: NotebookSummary;
  initialHtml: string;
  initialSectionIds: string[];
  user: SessionUser | null;
};

function sortChapters(chapters: ChapterSummary[]) {
  return chapters
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((chapter) => ({
      ...chapter,
      notebooks: chapter.notebooks.slice().sort((a, b) => a.order - b.order)
    }));
}

function createMessage(role: Message["role"], text: string, meta?: Message["meta"]): Message {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    role,
    text,
    meta
  };
}

function includesQuery(notebook: NotebookSummary, query: string) {
  if (!query) return true;
  const hay = `${notebook.title} ${notebook.id} ${notebook.tags.join(" ")}`.toLowerCase();
  return hay.includes(query);
}

export function NotebookWorkspace({ chapters, initialNotebook, initialHtml, initialSectionIds, user }: Props) {
  const sortedChapters = useMemo(() => sortChapters(chapters), [chapters]);
  const notebookRef = useRef<HTMLDivElement | null>(null);

  const [activeNotebook, setActiveNotebook] = useState<NotebookSummary>(initialNotebook);
  const [notebookHtml, setNotebookHtml] = useState(initialHtml);
  const [sectionIds, setSectionIds] = useState(initialSectionIds);
  const [activeSectionId, setActiveSectionId] = useState(initialSectionIds[0] ?? "intro");
  const [openChapterIds, setOpenChapterIds] = useState<Record<string, boolean>>(() => {
    const chapter = sortedChapters.find((item) => item.notebooks.some((notebook) => notebook.id === initialNotebook.id));
    const defaultId = chapter?.id ?? sortedChapters[0]?.id ?? "";
    return defaultId ? { [defaultId]: true } : {};
  });
  const [sidebarQuery, setSidebarQuery] = useState("");
  const [loadingNotebook, setLoadingNotebook] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectionContext, setSelectionContext] = useState<SelectionContext | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const filteredChapters = useMemo(() => {
    const query = sidebarQuery.trim().toLowerCase();
    if (!query) return sortedChapters;

    return sortedChapters
      .map((chapter) => ({
        ...chapter,
        notebooks: chapter.notebooks.filter((notebook) => includesQuery(notebook, query))
      }))
      .filter((chapter) => chapter.notebooks.length > 0);
  }, [sortedChapters, sidebarQuery]);

  useEffect(() => {
    setActiveSectionId(sectionIds[0] ?? "intro");
  }, [sectionIds, activeNotebook.id]);

  useEffect(() => {
    const chapter = sortedChapters.find((item) => item.notebooks.some((notebook) => notebook.id === activeNotebook.id));
    if (chapter) {
      setOpenChapterIds((prev) => ({ ...prev, [chapter.id]: true }));
    }
  }, [activeNotebook.id, sortedChapters]);

  const findSelectionInNotebook = (): SelectionContext | null => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return null;
    }

    const selected = selection.toString().trim();
    if (!selected) {
      return null;
    }

    const range = selection.getRangeAt(0);
    const container = notebookRef.current;
    if (!container) {
      return null;
    }

    if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) {
      return null;
    }

    let element: HTMLElement | null =
      range.startContainer.nodeType === Node.ELEMENT_NODE
        ? (range.startContainer as HTMLElement)
        : range.startContainer.parentElement;

    while (element && element !== container) {
      if (element.id) {
        return { text: selected, sectionId: element.id };
      }
      element = element.parentElement;
    }

    return { text: selected };
  };

  const loadNotebook = async (notebookId: string) => {
    if (loadingNotebook || notebookId === activeNotebook.id) {
      return;
    }

    setLoadingNotebook(true);
    setSelectionContext(null);
    setSidebarOpen(false);

    try {
      const response = await fetch(`/api/notebooks/${encodeURIComponent(notebookId)}`);
      if (!response.ok) {
        throw new Error("ノートの読み込みに失敗しました");
      }

      const payload = (await response.json()) as NotebookApiPayload;
      setActiveNotebook(payload.notebook);
      setNotebookHtml(payload.html);
      setSectionIds(payload.sectionIds);
      setMessages([]);

      const url = new URL(window.location.href);
      url.searchParams.set("notebookId", payload.notebook.id);
      window.history.replaceState(null, "", url.toString());
    } catch (error) {
      const message = error instanceof Error ? error.message : "ノートの読み込みに失敗しました";
      setMessages((prev) => [...prev, createMessage("system", message)]);
    } finally {
      setLoadingNotebook(false);
    }
  };

  const pollAnswer = async (questionId: string) => {
    for (let i = 0; i < 25; i += 1) {
      const response = await fetch(`/api/questions/${questionId}/answer`);

      if (response.status === 202) {
        await new Promise((resolve) => setTimeout(resolve, 1200));
        continue;
      }

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "回答の取得に失敗しました");
      }

      return (await response.json()) as AnswerPayload;
    }

    throw new Error("回答待機がタイムアウトしました");
  };

  const submitQuestion = async () => {
    const trimmed = chatInput.trim();
    if (!trimmed || chatBusy) {
      return;
    }

    const snapshot = findSelectionInNotebook();
    if (snapshot) {
      setSelectionContext(snapshot);
    }

    const effectiveSectionId =
      snapshot?.sectionId && sectionIds.includes(snapshot.sectionId) ? snapshot.sectionId : activeSectionId;
    const mergedQuestion = snapshot ? `${trimmed}\n\n[Selection]\n${snapshot.text}` : trimmed;

    setMessages((prev) => [...prev, createMessage("user", trimmed)]);
    setChatInput("");
    setChatBusy(true);

    try {
      const response = await fetch("/api/questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notebookId: activeNotebook.id,
          sectionId: effectiveSectionId || "intro",
          questionText: mergedQuestion
        })
      });

      if (response.status === 401) {
        throw new Error("質問にはログインが必要です。左下のログインボタンから認証してください。");
      }

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "質問の送信に失敗しました");
      }

      const payload = (await response.json()) as { questionId: string };
      const answer = await pollAnswer(payload.questionId);
      setMessages((prev) => [
        ...prev,
        createMessage("assistant", answer.answerText, {
          sourceReferences: answer.sourceReferences,
          timestamp: answer.timestamp,
          tokensUsed: answer.tokensUsed
        })
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "質問処理に失敗しました";
      setMessages((prev) => [...prev, createMessage("system", message)]);
    } finally {
      setChatBusy(false);
    }
  };

  const sidebarContent = (
    <>
      <div className="mb-3 px-2 pt-2">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-[var(--accent)]">Noema</p>
        <h2 className="mt-1 font-display text-2xl font-semibold">機械学習ノート</h2>
      </div>

      <div className="px-2 pb-3">
        <label className="glass-input flex items-center gap-2 rounded-xl px-3 py-2 text-sm">
          <span className="text-muted">⌕</span>
          <input
            className="w-full bg-transparent text-sm outline-none"
            onChange={(event) => setSidebarQuery(event.target.value)}
            placeholder="教材を検索"
            value={sidebarQuery}
          />
        </label>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {filteredChapters.length === 0 ? <p className="text-muted px-3 text-sm">一致する教材がありません。</p> : null}
        {filteredChapters.map((chapter) => {
          const expanded = Boolean(openChapterIds[chapter.id]);
          return (
            <section key={chapter.id} className="glass-subpanel rounded-xl">
              <button
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-semibold"
                onClick={() => setOpenChapterIds((prev) => ({ ...prev, [chapter.id]: !prev[chapter.id] }))}
                type="button"
              >
                <span>{chapter.title}</span>
                <span className="text-lg leading-none">{expanded ? "−" : "+"}</span>
              </button>

              {expanded ? (
                <ul className="space-y-1 border-t border-[var(--border)] p-2 text-sm">
                  {chapter.notebooks.map((notebook) => {
                    const active = notebook.id === activeNotebook.id;
                    return (
                      <li key={notebook.id}>
                        <button
                          className={`w-full rounded-lg px-3 py-2 text-left transition ${
                            active
                              ? "glass-button text-white"
                              : "text-[var(--muted)] hover:bg-[var(--panel-strong)] hover:text-[var(--text)]"
                          }`}
                          onClick={() => void loadNotebook(notebook.id)}
                          type="button"
                        >
                          <p className="truncate">{notebook.title}</p>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </section>
          );
        })}
      </div>

      <div className="mt-3 border-t border-[var(--border)] px-2 pt-3">
        <p className="text-muted mb-2 text-xs">{user?.id ? `ログイン済み: ${user.name ?? "ユーザー"}` : "未ログイン"}</p>
        <Link className="glass-button block rounded-xl px-4 py-2 text-center text-sm font-semibold text-white" href="/login">
          {user?.id ? "アカウント" : "ログイン"}
        </Link>
      </div>
    </>
  );

  const assistantPane = (
    <aside className="glass-panel-strong flex h-full w-full max-w-[420px] flex-col rounded-3xl p-3">
      <div className="mb-2 border-b border-[var(--border)] pb-2">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold">Assistant</h2>
          <div className="flex items-center gap-2 text-xs">
            <span className="glass-chip rounded-full px-2 py-1">RAG</span>
            <button className="glass-button-ghost rounded-lg px-2 py-1" onClick={() => setMessages([])} type="button">
              New
            </button>
            <button className="glass-button-ghost rounded-lg px-2 py-1 md:hidden" onClick={() => setChatOpen(false)} type="button">
              Close
            </button>
          </div>
        </div>

        {messages.length === 0 ? (
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="glass-subpanel rounded-xl p-3">
              <p className="font-semibold">Highlight & Ask</p>
              <p className="text-muted mt-1 text-xs">ノート本文を選択して質問すると、選択範囲を優先して解説します。</p>
            </div>
            <div className="glass-subpanel rounded-xl p-3">
              <p className="font-semibold">Add Context</p>
              <p className="text-muted mt-1 text-xs">章・セクションID指定で関連チャンクを絞り込みます。</p>
            </div>
          </div>
        ) : null}
      </div>

      <div className="glass-subpanel min-h-0 flex-1 space-y-2 overflow-y-auto rounded-2xl p-3">
        {messages.length === 0 ? (
          <p className="text-muted text-sm">右下ボタンまたはここから質問を始めてください。</p>
        ) : null}

        {messages.map((message) => (
          <article
            key={message.id}
            className={`rounded-xl px-3 py-2 text-sm ${
              message.role === "user"
                ? "ml-6 bg-[color:var(--accent)]/25"
                : message.role === "assistant"
                  ? "mr-6 bg-[color:var(--panel-strong)]"
                  : "border border-[var(--border)] bg-[color:var(--panel-soft)]"
            }`}
          >
            <p className="whitespace-pre-wrap leading-6">{message.text}</p>
            {message.meta?.sourceReferences?.length ? (
              <p className="text-muted mt-2 text-xs">
                参照: {message.meta.sourceReferences.map((source) => `${source.notebookId}${source.location}`).join(", ")}
              </p>
            ) : null}
          </article>
        ))}
      </div>

      <div className="mt-3 space-y-2">
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <select
            className="glass-input rounded-lg px-3 py-2 text-sm"
            onChange={(event) => setActiveSectionId(event.target.value)}
            value={activeSectionId}
          >
            {sectionIds.length > 0 ? (
              sectionIds.map((sectionId) => (
                <option key={sectionId} value={sectionId}>
                  {sectionId}
                </option>
              ))
            ) : (
              <option value="intro">intro</option>
            )}
          </select>
          <button
            className="glass-button-ghost rounded-lg px-3 py-2 text-sm"
            onClick={() => setSelectionContext(findSelectionInNotebook())}
            type="button"
          >
            selection
          </button>
        </div>

        <textarea
          className="glass-input min-h-24 w-full rounded-xl px-3 py-2 text-sm"
          onChange={(event) => setChatInput(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              void submitQuestion();
            }
          }}
          placeholder="ノート内容について質問する..."
          value={chatInput}
        />

        <button
          className="glass-button w-full rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
          disabled={chatBusy}
          onClick={() => void submitQuestion()}
          type="button"
        >
          {chatBusy ? "回答生成中..." : "送信"}
        </button>
      </div>
    </aside>
  );

  return (
    <main className="mx-auto h-[100dvh] w-full max-w-[1900px] p-2 md:p-3">
      <div className="glass-panel h-full rounded-[28px] p-2 md:p-3">
        <div className="flex h-full gap-2 md:gap-3">
          <aside className="glass-panel-strong hidden h-full w-[300px] rounded-3xl p-3 md:flex md:flex-col">{sidebarContent}</aside>

          <section className="min-w-0 flex-1">
            <div className="flex h-full min-w-0 gap-2 md:gap-3">
              <div className="glass-panel-strong relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-3xl">
                <div className="border-b border-[var(--border)] px-3 py-2 md:hidden">
                  <button
                    className="glass-button-ghost rounded-lg px-3 py-1.5 text-sm"
                    onClick={() => setSidebarOpen(true)}
                    type="button"
                  >
                    教材メニュー
                  </button>
                </div>

                <header className="sticky top-0 z-20 border-b border-[var(--border)] bg-[color:var(--panel-strong)]/95 px-3 py-2 backdrop-blur-xl md:px-5 md:py-3">
                  <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                    <div className="flex items-center gap-2 text-xs md:text-sm">
                      <button className="glass-button-ghost rounded-md px-2 py-1" onClick={() => setChatOpen((v) => !v)} type="button">
                        ☰
                      </button>
                      <span className="text-muted truncate">{loadingNotebook ? "読み込み中..." : `ID: ${activeNotebook.id}`}</span>
                    </div>

                    <h1 className="truncate px-2 text-center font-display text-base font-semibold md:text-2xl">{activeNotebook.title}</h1>

                    <div className="flex items-center justify-end gap-2">
                      <a
                        className="glass-button-ghost rounded-lg px-3 py-1.5 text-xs font-medium md:text-sm"
                        href={`/api/notebooks/${encodeURIComponent(activeNotebook.id)}/download`}
                      >
                        Download
                      </a>
                      <a
                        className="glass-button rounded-lg px-3 py-1.5 text-xs font-semibold text-white md:text-sm"
                        href={activeNotebook.colabUrl}
                        rel="noreferrer"
                        target="_blank"
                      >
                        Open in Colab
                      </a>
                    </div>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {activeNotebook.tags.map((tag) => (
                      <span key={tag} className="glass-chip rounded-full px-2.5 py-1 text-xs">
                        {tag}
                      </span>
                    ))}
                    {sectionIds.slice(0, 5).map((sectionId) => (
                      <button
                        key={sectionId}
                        className={`rounded-full px-2.5 py-1 text-xs transition ${
                          activeSectionId === sectionId
                            ? "glass-button text-white"
                            : "glass-button-ghost"
                        }`}
                        onClick={() => setActiveSectionId(sectionId)}
                        type="button"
                      >
                        {sectionId}
                      </button>
                    ))}
                  </div>
                </header>

                <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6 pt-3 md:px-6 md:pt-4">
                  {selectionContext ? (
                    <div className="glass-subpanel mb-3 flex items-start justify-between gap-3 rounded-xl p-3 text-xs md:text-sm">
                      <div>
                        <p className="font-semibold">選択中のテキストを質問に添付します</p>
                        <p className="text-muted mt-1 max-h-12 overflow-hidden whitespace-pre-wrap">{selectionContext.text}</p>
                      </div>
                      <button
                        className="glass-button-ghost shrink-0 rounded-md px-2 py-1 text-xs"
                        onClick={() => setSelectionContext(null)}
                        type="button"
                      >
                        解除
                      </button>
                    </div>
                  ) : null}

                  <div className="mx-auto max-w-[980px]">
                    <div ref={notebookRef} className="prose-noema glass-subpanel max-w-none rounded-2xl px-4 py-4 md:px-6 md:py-5" dangerouslySetInnerHTML={{ __html: notebookHtml }} />
                  </div>
                </div>

                {!chatOpen ? (
                  <button
                    aria-label="LLMに質問する"
                    className="glass-button fixed bottom-5 right-5 z-30 rounded-full px-5 py-3 text-sm font-semibold text-white shadow-2xl"
                    onClick={() => setChatOpen(true)}
                    type="button"
                  >
                    LLMに質問
                  </button>
                ) : null}
              </div>

              <div className="hidden md:block">{chatOpen ? assistantPane : null}</div>
            </div>
          </section>
        </div>
      </div>

      {sidebarOpen ? (
        <div className="fixed inset-0 z-50 bg-black/35 p-3 md:hidden">
          <aside className="glass-panel-strong flex h-full w-[88%] max-w-[340px] flex-col rounded-3xl p-3">
            <div className="mb-2 flex items-center justify-end">
              <button className="glass-button-ghost rounded-lg px-3 py-1.5 text-sm" onClick={() => setSidebarOpen(false)} type="button">
                閉じる
              </button>
            </div>
            {sidebarContent}
          </aside>
        </div>
      ) : null}

      {chatOpen ? (
        <div className="fixed inset-0 z-50 bg-black/35 p-3 md:hidden">
          <div className="h-full">{assistantPane}</div>
        </div>
      ) : null}
    </main>
  );
}
