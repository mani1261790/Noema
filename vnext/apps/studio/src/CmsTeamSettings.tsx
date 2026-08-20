import type { FormEvent } from "react";
import {
  cmsRoleLabels,
  type CmsMember,
  type CmsRole
} from "@noema/cms";
import type { CmsLibraryConnection } from "./CmsArticleLibrary";

interface CmsTeamSettingsProps {
  active: boolean;
  busy: boolean;
  connection: CmsLibraryConnection;
  email: string;
  error: string | null;
  members: CmsMember[];
  onActiveChange: (active: boolean) => void;
  onEdit: (member: CmsMember) => void;
  onEmailChange: (email: string) => void;
  onCopyInstructions: (email: string) => void;
  onRetry: () => void;
  onRoleChange: (role: CmsRole) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  role: CmsRole;
}

export function CmsTeamSettings({
  active,
  busy,
  connection,
  email,
  error,
  members,
  onActiveChange,
  onEdit,
  onEmailChange,
  onCopyInstructions,
  onRetry,
  onRoleChange,
  onSubmit,
  role
}: CmsTeamSettingsProps) {
  if (connection.kind === "checking") {
    return (
      <main className="studio-library studio-team">
        <div className="studio-library__inner studio-library-state" role="status">
          <h1 id="studio-team-heading" tabIndex={-1}>チームを確認しています</h1>
          <p>メンバーと権限を読み込んでいます。</p>
        </div>
      </main>
    );
  }

  const migrationMembers = members.filter((member) => member.active && member.provisioned);
  const readyMembers = migrationMembers.filter((member) => member.passwordLoginReadyAt);

  if (connection.kind === "unavailable") {
    return (
      <main className="studio-library studio-team">
        <div className="studio-library__inner studio-library-state is-error" role="alert">
          <h1 id="studio-team-heading" tabIndex={-1}>チームを表示できません</h1>
          <p>{connection.message}</p>
          <button className="dads-button" data-size="md" data-type="outline" onClick={onRetry} type="button">もう一度確認</button>
        </div>
      </main>
    );
  }

  return (
    <main className="studio-library studio-team">
      <div className="studio-library__inner">
        <header className="studio-library__heading studio-team__heading">
          <div>
            <p className="studio-library__eyebrow">Studio設定</p>
            <h1 id="studio-team-heading" tabIndex={-1}>チーム</h1>
            <p>記事を書く画面から離れて、投稿・レビュー・公開の権限だけを管理します。</p>
          </div>
          <p className="studio-team__identity"><strong>{cmsRoleLabels[connection.role]}</strong><span>{connection.email}</span></p>
        </header>

        <div className="studio-team__layout">
          <section className="studio-team__invite" aria-labelledby="studio-team-invite-heading">
            <div>
              <p className="studio-library__eyebrow">メンバーを追加</p>
              <h2 id="studio-team-invite-heading">メールアドレスと役割を設定</h2>
              <p>登録したメールアドレスでCloudflare Accessへ初めてログインすると、Studioの役割が有効になります。</p>
            </div>
            <form onSubmit={onSubmit}>
              <label htmlFor="cms-member-email">メールアドレス</label>
              <input
                autoComplete="email"
                disabled={busy}
                id="cms-member-email"
                onChange={(event) => onEmailChange(event.target.value)}
                placeholder="editor@example.com"
                required
                type="email"
                value={email}
              />
              <label htmlFor="cms-member-role">役割</label>
              <select
                disabled={busy}
                id="cms-member-role"
                onChange={(event) => onRoleChange(event.target.value as CmsRole)}
                value={role}
              >
                {(Object.keys(cmsRoleLabels) as CmsRole[]).map((choice) => (
                  <option key={choice} value={choice}>{cmsRoleLabels[choice]}</option>
                ))}
              </select>
              <label className="studio-team__active">
                <input
                  checked={active}
                  disabled={busy}
                  onChange={(event) => onActiveChange(event.target.checked)}
                  type="checkbox"
                />
                <span>このメンバーを有効にする</span>
              </label>
              <button className="dads-button" data-size="md" data-type="solid-fill" disabled={busy} type="submit">
                {busy ? "更新中…" : "招待・設定を保存"}
              </button>
            </form>
            {error ? <p className="studio-team__error" role="alert">{error}</p> : null}
          </section>

          <section className="studio-team__members" aria-labelledby="studio-team-members-heading">
            <div className="studio-team__members-heading">
              <div>
                <p className="studio-library__eyebrow">現在のアクセス</p>
                <h2 id="studio-team-members-heading">メンバー</h2>
              </div>
              <strong>{members.length}人・{readyMembers.length}/{migrationMembers.length}人準備済み</strong>
            </div>
            {members.length === 0 && !busy ? (
              <p className="studio-team__empty">登録済みのメンバーはいません。</p>
            ) : (
              <ul className="studio-team__list">
                {members.map((member) => {
                  const isSelf = member.email.toLowerCase() === connection.email.toLowerCase();
                  return (
                    <li key={member.email}>
                      <div>
                        <strong>{member.email}</strong>
                        <span>{cmsRoleLabels[member.role]}</span>
                        <small>{member.active ? "有効" : "停止"}・{member.provisioned ? "利用開始済み" : "招待待ち"}</small>
                        <small>{!member.active
                          ? "パスワード移行の対象外"
                          : !member.provisioned
                            ? "利用開始後にパスワードを案内"
                            : member.passwordLoginReadyAt
                              ? "パスワード準備済み"
                              : "パスワード準備待ち"}</small>
                      </div>
                      <div className="studio-team__member-actions">
                        {isSelf ? <span className="studio-team__self">自分</span> : null}
                        <button className="dads-button" data-size="sm" data-type="outline" disabled={busy} onClick={() => onCopyInstructions(member.email)} type="button">案内をコピー</button>
                        {!isSelf ? (
                          <button className="dads-button" data-size="sm" data-type="outline" disabled={busy} onClick={() => onEdit(member)} type="button">設定を編集</button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
