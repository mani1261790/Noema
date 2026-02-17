"use client";

import { FormEvent, useMemo, useState } from "react";

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

type Props = {
  initialQuestions: QuestionItem[];
};

export function AdminConsole({ initialQuestions }: Props) {
  const [questions, setQuestions] = useState<QuestionItem[]>(initialQuestions);
  const [busyUpload, setBusyUpload] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const sorted = useMemo(
    () => questions.slice().sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)),
    [questions]
  );

  const refresh = async () => {
    const response = await fetch("/api/admin/questions");
    if (!response.ok) return;
    const data = (await response.json()) as { items: QuestionItem[] };
    setQuestions(data.items);
  };

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

    setUploadMessage("教材を登録しました。教材ビルド済みです。");
    setBusyUpload(false);
    form.reset();
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
    await refresh();
  };

  return (
    <div className="mt-4 space-y-4">
      <section className="glass-panel rounded-2xl p-4">
        <h2 className="font-display text-lg font-semibold">教材アップロード</h2>
        <form className="mt-3 grid gap-3 md:grid-cols-2" onSubmit={submitUpload}>
          <input className="glass-input rounded-lg px-3 py-2" name="title" placeholder="タイトル" required />
          <input className="glass-input rounded-lg px-3 py-2" name="chapter" placeholder="章タイトル" required />
          <input
            className="glass-input rounded-lg px-3 py-2"
            min={1}
            name="order"
            placeholder="順序"
            required
            type="number"
          />
          <input
            className="glass-input rounded-lg px-3 py-2"
            name="tags"
            placeholder="タグ (comma separated)"
          />
          <input className="glass-input rounded-lg px-3 py-2" name="colabUrl" placeholder="Colab URL" required />
          <input className="glass-input rounded-lg px-3 py-2" name="videoUrl" placeholder="Video URL" />
          <input
            accept=".ipynb,application/json"
            className="glass-input rounded-lg px-3 py-2 md:col-span-2"
            name="file"
            required
            type="file"
          />
          <button
            className="glass-button rounded-lg px-4 py-2 text-white disabled:cursor-not-allowed disabled:opacity-60 md:col-span-2"
            disabled={busyUpload}
            type="submit"
          >
            {busyUpload ? "登録中..." : "ipynbを登録"}
          </button>
        </form>
        {uploadMessage ? <p className="text-muted mt-2 text-sm">{uploadMessage}</p> : null}
      </section>

      <section className="glass-panel rounded-2xl p-4">
        <h2 className="font-display text-lg font-semibold">質問・回答ログ</h2>
        {saveMessage ? <p className="text-muted mt-2 text-sm">{saveMessage}</p> : null}

        <div className="mt-3 space-y-3">
          {sorted.length === 0 ? <p className="text-muted text-sm">まだ質問ログがありません。</p> : null}
          {sorted.map((item) => (
            <QuestionEditor key={item.id} item={item} onSave={saveAnswer} />
          ))}
        </div>
      </section>
    </div>
  );
}

function QuestionEditor({ item, onSave }: { item: QuestionItem; onSave: (questionId: string, answerText: string) => Promise<void> }) {
  const [answerText, setAnswerText] = useState(item.answerText ?? "");

  return (
    <article className="glass-subpanel rounded-lg p-3">
      <div className="text-muted text-xs">
        <p>
          {item.user.email ?? "unknown"} | {new Date(item.createdAt).toLocaleString()} | {item.notebookId}
          #{item.sectionId}
        </p>
      </div>
      <p className="mt-2 text-sm">Q: {item.questionText}</p>
      <textarea
        className="glass-input mt-2 min-h-24 w-full rounded-lg px-3 py-2 text-sm"
        onChange={(event) => setAnswerText(event.target.value)}
        value={answerText}
      />
      <button
        className="glass-button-ghost mt-2 rounded-md px-3 py-1 text-sm"
        onClick={() => void onSave(item.id, answerText)}
        type="button"
      >
        回答を保存
      </button>
    </article>
  );
}
