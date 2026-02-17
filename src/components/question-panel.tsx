"use client";

import { FormEvent, useEffect, useState } from "react";

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

type Props = {
  notebookId: string;
  sectionIds: string[];
};

type HistoryItem = {
  questionId: string;
  sectionId: string;
  questionText: string;
  answerText: string;
  createdAt: string;
};

export function QuestionPanel({ notebookId, sectionIds }: Props) {
  const [sectionId, setSectionId] = useState(sectionIds[0] ?? "intro");
  const [questionText, setQuestionText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<AnswerPayload | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  useEffect(() => {
    setSectionId(sectionIds[0] ?? "intro");
  }, [sectionIds, notebookId]);

  useEffect(() => {
    const run = async () => {
      const response = await fetch(`/api/questions/history?notebookId=${encodeURIComponent(notebookId)}`);
      if (!response.ok) return;
      const payload = (await response.json()) as { items: HistoryItem[] };
      setHistory(payload.items);
    };
    void run();
  }, [notebookId]);

  const poll = async (questionId: string) => {
    for (let i = 0; i < 20; i += 1) {
      const response = await fetch(`/api/questions/${questionId}/answer`);
      if (response.status === 202) {
        await new Promise((resolve) => setTimeout(resolve, 1200));
        continue;
      }

      if (response.status === 409) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "回答生成に失敗しました");
      }

      if (!response.ok) {
        throw new Error("回答取得に失敗しました");
      }

      const data = (await response.json()) as AnswerPayload;
      return data;
    }

    throw new Error("回答生成がタイムアウトしました");
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setAnswer(null);

    try {
      const createResponse = await fetch("/api/questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notebookId,
          sectionId,
          questionText
        })
      });

      if (!createResponse.ok) {
        throw new Error("質問の送信に失敗しました");
      }

      const createData = (await createResponse.json()) as { questionId: string };
      const answerPayload = await poll(createData.questionId);
      setAnswer(answerPayload);

      const historyResponse = await fetch(`/api/questions/history?notebookId=${encodeURIComponent(notebookId)}`);
      if (historyResponse.ok) {
        const historyPayload = (await historyResponse.json()) as { items: HistoryItem[] };
        setHistory(historyPayload.items);
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "エラーが発生しました");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="glass-panel rounded-2xl p-4">
      <h2 className="font-display text-lg font-semibold">質問フォーム（RAG + LLM）</h2>
      <p className="text-muted mt-1 text-sm">教材の疑問点を入力すると、ノート文脈を参照して回答します。</p>

      <form className="mt-4 space-y-3" onSubmit={submit}>
        <div>
          <label className="text-sm font-medium">Section ID</label>
          <select
            className="glass-input mt-1 w-full rounded-lg px-3 py-2"
            onChange={(event) => setSectionId(event.target.value)}
            value={sectionId}
          >
            {sectionIds.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
            {sectionIds.length === 0 ? <option value="intro">intro</option> : null}
          </select>
        </div>

        <div>
          <label className="text-sm font-medium">質問内容</label>
          <textarea
            className="glass-input mt-1 min-h-28 w-full rounded-lg px-3 py-2"
            onChange={(event) => setQuestionText(event.target.value)}
            required
            value={questionText}
          />
        </div>

        <button
          className="glass-button rounded-lg px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
          disabled={busy}
          type="submit"
        >
          {busy ? "回答生成中..." : "質問する"}
        </button>
      </form>

      {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}

      {answer ? (
        <div className="glass-subpanel mt-4 space-y-3 rounded-lg p-3">
          <p className="whitespace-pre-wrap text-sm leading-6">{answer.answerText}</p>
          <div className="text-muted text-xs">
            <p>Tokens: {answer.tokensUsed}</p>
            <p>Timestamp: {new Date(answer.timestamp).toLocaleString()}</p>
          </div>
          <ul className="text-muted space-y-1 text-xs">
            {answer.sourceReferences.map((source, index) => (
              <li key={`${source.location}-${index}`}>
                source: {source.notebookId}
                {source.location}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-4">
        <h3 className="text-sm font-semibold">保存済みQ&A（直近）</h3>
        <ul className="mt-2 space-y-2">
          {history.length === 0 ? <li className="text-muted text-sm">まだ保存済みQ&Aはありません。</li> : null}
          {history.map((item) => (
            <li key={item.questionId} className="glass-subpanel rounded-md p-2 text-sm">
              <p className="font-medium">Q: {item.questionText}</p>
              <p className="text-muted mt-1 whitespace-pre-wrap">A: {item.answerText}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
