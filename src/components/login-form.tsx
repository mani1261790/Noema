"use client";

import { FormEvent, useMemo, useState } from "react";
import { signIn } from "next-auth/react";
import Link from "next/link";

type ProviderId = "google" | "facebook" | "twitter";

type Props = {
  providers: ProviderId[];
};

const providerLabel: Record<ProviderId, string> = {
  google: "Googleでログイン",
  facebook: "Facebookでログイン",
  twitter: "Twitterでログイン"
};

export function LoginForm({ providers }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const oauthProviders = useMemo(
    () => providers.filter((provider): provider is ProviderId => Boolean(providerLabel[provider])),
    [providers]
  );
  const hasOAuth = oauthProviders.length > 0;

  const submitCredentials = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
      callbackUrl: "/learn"
    });

    if (result?.error) {
      setError("ログインに失敗しました。メールアドレスまたはパスワードを確認してください。");
      setBusy(false);
      return;
    }

    window.location.href = result?.url ?? "/learn";
  };

  return (
    <div className="mx-auto w-full max-w-lg glass-panel-strong rounded-2xl p-8">
      <h1 className="font-display text-2xl font-semibold">Noema にログイン</h1>
      <p className="mt-2 text-sm text-muted">教材閲覧と質問機能はログインユーザーのみ利用できます。</p>

      <form className="mt-6 space-y-4" onSubmit={submitCredentials}>
        <div>
          <label className="text-sm font-medium">メールアドレス</label>
          <input
            className="mt-1 w-full glass-input rounded-lg px-3 py-2"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            type="email"
          />
        </div>

        <div>
          <label className="text-sm font-medium">パスワード</label>
          <input
            className="mt-1 w-full glass-input rounded-lg px-3 py-2"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            minLength={8}
            type="password"
          />
        </div>

        {error ? (
          <div
            className="rounded-xl border border-[rgba(245,122,138,.58)] bg-[rgba(88,18,36,.28)] px-3 py-2 text-sm text-[rgba(255,227,233,.98)]"
            role="alert"
          >
            <p className="mb-0.5 text-[11px] tracking-wide text-[rgba(255,209,219,.85)]">Error</p>
            <p>{error}</p>
          </div>
        ) : null}

        <button
          className="w-full glass-button rounded-lg px-4 py-2 text-white disabled:cursor-not-allowed disabled:opacity-60"
          disabled={busy}
          type="submit"
        >
          {busy ? "ログイン中..." : "メールアドレスでログイン"}
        </button>
      </form>

      {hasOAuth ? (
        <div className="mt-6 border-t border-[var(--border)] pt-5">
          <p className="mb-3 text-sm text-muted">OAuthログイン</p>
          <div className="space-y-2">
            {oauthProviders.map((provider) => (
              <button
                key={provider}
                className="w-full glass-button-ghost rounded-lg px-4 py-2 text-sm font-medium"
                onClick={() => void signIn(provider, { callbackUrl: "/learn" })}
                type="button"
              >
                {providerLabel[provider]}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <Link className="mt-4 inline-block text-sm text-[var(--accent)]" href="/signup">
        新規登録はこちら
      </Link>
    </div>
  );
}
