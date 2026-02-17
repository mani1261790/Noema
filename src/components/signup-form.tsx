"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

export function SignupForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);

    const response = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password })
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      setMessage(payload.error ?? "登録に失敗しました");
      setBusy(false);
      return;
    }

    setMessage("登録が完了しました。ログインしてください。");
    setBusy(false);
    setName("");
    setEmail("");
    setPassword("");
  };

  return (
    <div className="mx-auto w-full max-w-lg glass-panel-strong rounded-2xl p-8">
      <h1 className="font-display text-2xl font-semibold">アカウント作成</h1>
      <p className="mt-2 text-sm text-muted">メールアドレスとパスワードで学習アカウントを作成します。</p>

      <form className="mt-6 space-y-4" onSubmit={submit}>
        <input
          className="glass-input w-full rounded-lg px-3 py-2"
          onChange={(event) => setName(event.target.value)}
          placeholder="表示名"
          required
          value={name}
        />
        <input
          className="glass-input w-full rounded-lg px-3 py-2"
          onChange={(event) => setEmail(event.target.value)}
          placeholder="メールアドレス"
          required
          type="email"
          value={email}
        />
        <input
          className="glass-input w-full rounded-lg px-3 py-2"
          minLength={8}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="パスワード"
          required
          type="password"
          value={password}
        />

        <button
          className="w-full glass-button rounded-lg px-4 py-2 text-white disabled:cursor-not-allowed disabled:opacity-60"
          disabled={busy}
          type="submit"
        >
          {busy ? "作成中..." : "作成する"}
        </button>
      </form>

      {message ? <p className="mt-3 text-sm text-muted">{message}</p> : null}

      <Link className="mt-4 inline-block text-sm text-[var(--accent)]" href="/login">
        ログイン画面へ
      </Link>
    </div>
  );
}
