import { useState, type FormEvent } from "react";
import type { CmsSession } from "@noema/cms";

interface CmsPasswordLoginMigrationProps {
  busy: boolean;
  error: string | null;
  onSubmit: (password: string) => Promise<void>;
  session: CmsSession;
}

export function CmsPasswordLoginMigration({
  busy,
  error,
  onSubmit,
  session
}: CmsPasswordLoginMigrationProps) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const mismatch = confirmation.length > 0 && password !== confirmation;

  if (session.passwordLoginReadyAt) return null;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!busy && password.length >= 12 && !mismatch) void onSubmit(password);
  };

  return (
    <section aria-labelledby="studio-password-login-heading" className="studio-password-migration">
      <div className="studio-password-migration__content">
        <p className="studio-password-migration__eyebrow">ログイン方法の移行</p>
        <h2 id="studio-password-login-heading">Noemaのパスワードを設定</h2>
        <p>
          現在のCMS権限を<strong>{session.identity.email}</strong>へ引き継ぎます。
          設定後はNoemaがユーザーとセッションを管理します。移行が終わるまでメールコードも利用できます。
        </p>
      </div>
      <form className="studio-password-migration__form" onSubmit={submit}>
        <label htmlFor="studio-new-password">新しいパスワード</label>
        <input
          autoComplete="new-password"
          disabled={busy}
          id="studio-new-password"
          maxLength={128}
          minLength={12}
          onChange={(event) => setPassword(event.target.value)}
          required
          type="password"
          value={password}
        />
        <small>12文字以上で設定してください。</small>
        <label htmlFor="studio-new-password-confirmation">新しいパスワード（確認）</label>
        <input
          aria-describedby={mismatch ? "studio-password-mismatch" : undefined}
          aria-invalid={mismatch || undefined}
          autoComplete="new-password"
          disabled={busy}
          id="studio-new-password-confirmation"
          maxLength={128}
          minLength={12}
          onChange={(event) => setConfirmation(event.target.value)}
          required
          type="password"
          value={confirmation}
        />
        {mismatch ? <p id="studio-password-mismatch" role="alert">確認用のパスワードが一致しません。</p> : null}
        <button
          className="dads-button"
          data-size="md"
          data-type="solid-fill"
          disabled={busy || password.length < 12 || mismatch}
          type="submit"
        >
          {busy ? "設定中…" : "パスワードを設定"}
        </button>
        {error ? <p className="studio-password-migration__error" role="alert">{error}</p> : null}
      </form>
    </section>
  );
}
