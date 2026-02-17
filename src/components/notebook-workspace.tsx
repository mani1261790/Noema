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

export function NotebookWorkspace({ chapters, initialNotebook, initialHtml, initialSectionIds, user }: Props) {
  const sortedChapters = useMemo(() => sortChapters(chapters), [chapters]);
  const notebookRef = useRef<HTMLDivElement | null>(null);

  const [activeNotebook, setActiveNotebook] = useState<NotebookSummary>(initialNotebook);
  const [notebookHtml, setNotebookHtml] = useState(initialHtml);
  const [sectionIds, setSectionIds] = useState(initialSectionIds);
  const [activeSectionId, setActiveSectionId] = useState(initialSectionIds[0] ?? "intro");
  const [openChapterId, setOpenChapterId] = useState(() => {
    const chapter = sortedChapters.find((item) => item.notebooks.some((notebook) => notebook.id === initialNotebook.id));
    return chapter?.id ?? sortedChapters[0]?.id ?? "";
  });
  const [loadingNotebook, setLoadingNotebook] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectionContext, setSelectionContext] = useState<SelectionContext | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    setActiveSectionId(sectionIds[0] ?? "intro");
  }, [sectionIds, activeNotebook.id]);

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

      const answer = (await response.json()) as AnswerPayload;
      return answer;
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
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-[var(--accent)]">Noema Learn</p>
        <h2 className="mt-1 font-display text-xl font-semibold">教材一覧</h2>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {sortedChapters.map((chapter) => {
          const expanded = openChapterId === chapter.id;
          return (
            <section key={chapter.id} className="glass-subpanel rounded-xl">
              <button
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-semibold"
                onClick={() => setOpenChapterId(expanded ? "" : chapter.id)}
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
                          {notebook.title}
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

  return (
    <main className="mx-auto h-[100dvh] w-full max-w-[1700px] p-3 md:p-4">
      <div className="flex h-full gap-3">
        <aside className="glass-panel-strong hidden h-full w-[320px] rounded-3xl p-3 md:flex md:flex-col">{sidebarContent}</aside>

        <section className="min-w-0 flex-1">
          <div className="flex h-full min-w-0 gap-3">
            <div className="glass-panel-strong relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-3xl">
              <div className="border-b border-[var(--border)] px-3 py-2 md:hidden">
                <button className="glass-button-ghost rounded-lg px-3 py-1.5 text-sm" onClick={() => setSidebarOpen(true)} type="button">
                  教材メニュー
                </button>
              </div>

              <header className="sticky top-0 z-20 border-b border-[var(--border)] bg-[color:var(--panel-strong)]/95 px-4 py-3 backdrop-blur-xl">
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                  <p className="text-muted truncate text-xs font-medium md:text-sm">
                    {loadingNotebook ? "読み込み中..." : `Notebook ID: ${activeNotebook.id}`}
                  </p>
                  <h1 className="truncate px-2 text-center font-display text-base font-semibold md:text-xl">{activeNotebook.title}</h1>
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
                      Colab
                    </a>
                  </div>
                </div>
              </header>

              <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-5 pt-4 md:px-6">
                {selectionContext ? (
                  <div className="glass-subpanel mb-3 flex items-start justify-between gap-3 rounded-xl p-3 text-xs md:text-sm">
                    <div>
                      <p className="font-semibold">選択中のテキストを質問に添付します</p>
                      <p className="text-muted mt-1 line-clamp-2 whitespace-pre-wrap">{selectionContext.text}</p>
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

                <div
                  ref={notebookRef}
                  className="prose-noema max-w-none"
                  dangerouslySetInnerHTML={{ __html: notebookHtml }}
                />
              </div>

              <button
                aria-label={chatOpen ? "LLMチャットを閉じる" : "LLMに質問する"}
                className="glass-button fixed bottom-5 right-5 z-30 rounded-full px-5 py-3 text-sm font-semibold text-white shadow-2xl"
                onClick={() => setChatOpen((prev) => !prev)}
                type="button"
              >
                {chatOpen ? "チャットを閉じる" : "LLMに質問"}
              </button>
            </div>

            {chatOpen ? (
              <aside className="glass-panel-strong flex h-full w-full max-w-[420px] flex-col rounded-3xl p-3">
                <div className="mb-2 flex items-center justify-between px-1">
                  <h2 className="font-display text-lg font-semibold">Notebook Assistant</h2>
                  <span className="glass-chip rounded-full px-2 py-1 text-xs">RAG</span>
                </div>

                <div className="glass-subpanel min-h-0 flex-1 space-y-2 overflow-y-auto rounded-2xl p-3">
                  {messages.length === 0 ? (
                    <p className="text-muted text-sm">
                      ノート本文を選択してから質問すると、その選択内容を優先して回答します。
                    </p>
                  ) : null}
                  {messages.map((message) => (
                    <article
                      key={message.id}
                      className={`rounded-xl px-3 py-2 text-sm ${
                        message.role === "user"
                          ? "ml-6 bg-[color:var(--accent)]/20"
                          : message.role === "assistant"
                            ? "mr-6 bg-[color:var(--panel-strong)]"
                            : "border border-amber-300/50 bg-amber-100/25 text-amber-900 dark:text-amber-100"
                      }`}
                    >
                      <p className="whitespace-pre-wrap leading-6">{message.text}</p>
                      {message.meta?.sourceReferences?.length ? (
                        <p className="text-muted mt-2 text-xs">
                          参照:{" "}
                          {message.meta.sourceReferences.map((source) => `${source.notebookId}${source.location}`).join(", ")}
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
            ) : null}
          </div>
        </section>
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
    </main>
  );
}
