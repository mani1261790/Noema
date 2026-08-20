import { useState, type FormEvent } from "react";

interface CmsLoginProps {
  busy: boolean;
  error: string | null;
  onSubmit: (email: string, password: string) => Promise<void>;
}

export function CmsLogin({ busy, error, onSubmit }: CmsLoginProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!busy) void onSubmit(email.trim().toLowerCase(), password);
  };

  return (
    <main className="studio-login">
      <section aria-labelledby="studio-login-heading" className="studio-login__panel">
        <div>
          <p className="studio-library__eyebrow">Noema Studio</p>
          <h1 id="studio-login-heading">ログイン</h1>
          <p>CMSに登録されているメールアドレスと、Noemaで設定したパスワードを入力してください。</p>
        </div>
        <form onSubmit={submit}>
          <label htmlFor="studio-login-email">メールアドレス</label>
          <input
            autoComplete="username"
            disabled={busy}
            id="studio-login-email"
            onChange={(event) => setEmail(event.target.value)}
            required
            type="email"
            value={email}
          />
          <label htmlFor="studio-login-password">パスワード</label>
          <input
            autoComplete="current-password"
            disabled={busy}
            id="studio-login-password"
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
          <button className="dads-button" data-size="md" data-type="solid-fill" disabled={busy} type="submit">
            {busy ? "確認中…" : "ログイン"}
          </button>
          {error ? <p className="studio-login__error" role="alert">{error}</p> : null}
        </form>
        <p className="studio-login__recovery">
          パスワード未設定・紛失時は、移行期間中のメールコードで本人確認してから再設定できます。
        </p>
      </section>
    </main>
  );
}
