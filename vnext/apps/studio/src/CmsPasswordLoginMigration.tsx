import { useState, type FormEvent } from "react";
import type { CmsSession } from "@noema/cms";
import { CLOUDFLARE_SIGN_UP_URL } from "./password-login-migration";

interface CmsPasswordLoginMigrationProps {
  busy: boolean;
  error: string | null;
  onReady: () => Promise<void>;
  session: CmsSession;
}

export function CmsPasswordLoginMigration({
  busy,
  error,
  onReady,
  session
}: CmsPasswordLoginMigrationProps) {
  const [confirmed, setConfirmed] = useState(false);
  const email = session.identity.email;

  if (session.passwordLoginReadyAt) {
    return (
      <section aria-labelledby="studio-password-login-heading" className="studio-password-migration is-ready">
        <div>
          <p className="studio-password-migration__eyebrow">ログイン方法の移行</p>
          <h2 id="studio-password-login-heading">パスワードの準備済みとして記録しました</h2>
          <p>
            管理者から切替確認の案内が届いたら、Studioからログアウトし、Cloudflareを選んでログインしてください。
            管理者がAccessのログイン結果を確認するまで、メールコードも引き続き利用できます。
          </p>
        </div>
      </section>
    );
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (confirmed && !busy) void onReady();
  };

  return (
    <section aria-labelledby="studio-password-login-heading" className="studio-password-migration">
      <div className="studio-password-migration__content">
        <p className="studio-password-migration__eyebrow">ログイン方法の移行</p>
        <h2 id="studio-password-login-heading">パスワードログインを準備してください</h2>
        <p>
          Cloudflareアカウントを<strong>{email}</strong>で作成し、パスワードとメールアドレスの確認を完了してください。
          別のメールアドレスでは現在のCMS権限を引き継げません。
        </p>
        <a
          className="dads-button"
          data-size="md"
          data-type="outline"
          href={CLOUDFLARE_SIGN_UP_URL}
          rel="noreferrer"
          target="_blank"
        >
          Cloudflareアカウントを準備
        </a>
      </div>
      <form className="studio-password-migration__confirmation" onSubmit={submit}>
        <label>
          <input
            checked={confirmed}
            disabled={busy}
            onChange={(event) => setConfirmed(event.target.checked)}
            type="checkbox"
          />
          <span><strong>{email}</strong>でパスワードを設定し、メールアドレスを確認しました</span>
        </label>
        <button
          className="dads-button"
          data-size="md"
          data-type="solid-fill"
          disabled={busy || !confirmed}
          type="submit"
        >
          {busy ? "記録中…" : "パスワードを準備済みとして記録"}
        </button>
        {error ? <p className="studio-password-migration__error" role="alert">{error}</p> : null}
      </form>
    </section>
  );
}
