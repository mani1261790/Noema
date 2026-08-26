import type { FormEvent } from "react";
import { cmsRoleLabels, type CmsMember, type CmsRole } from "@noema/cms";
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
  onProfileNameChange: (name: string) => void;
  onProfileSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onRetry: () => void;
  onRoleChange: (role: CmsRole) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  profileBusy: boolean;
  profileError: string | null;
  profileName: string;
  role: CmsRole;
}

const roleDescriptions: Record<CmsRole, string> = {
  admin: "記事の編集・レビュー・公開と、メンバーのアクセス管理ができます。",
  editor: "記事を編集し、レビューを依頼できます。承認や公開はできません。",
  reviewer: "記事を確認し、承認や修正依頼ができます。本文は編集できません。"
};

export function CmsTeamSettings({
  active, busy, connection, email, error, members, onActiveChange, onEdit,
  onEmailChange, onProfileNameChange, onProfileSubmit, onRetry, onRoleChange,
  onSubmit, profileBusy, profileError, profileName, role
}: CmsTeamSettingsProps) {
  if (connection.kind === "checking") {
    return <main className="studio-library studio-team"><div className="studio-library__inner studio-library-state" role="status"><h1 id="studio-team-heading" tabIndex={-1}>プロフィールを確認しています</h1><p>公開名とアクセス権限を読み込んでいます。</p></div></main>;
  }
  if (connection.kind === "unavailable") {
    return <main className="studio-library studio-team"><div className="studio-library__inner studio-library-state is-error" role="alert"><h1 id="studio-team-heading" tabIndex={-1}>プロフィールを表示できません</h1><p>{connection.message}</p><button className="dads-button" data-size="md" data-type="outline" onClick={onRetry} type="button">もう一度確認</button></div></main>;
  }

  const canManageMembers = connection.role === "admin";
  return (
    <main className="studio-library studio-team">
      <div className="studio-library__inner">
        <header className="studio-library__heading studio-team__heading">
          <div><h1 id="studio-team-heading" tabIndex={-1}>プロフィールとチーム</h1><p>記事に表示する自分の名前と、Studioへのアクセスを管理します。</p></div>
          <p className="studio-team__identity"><strong>{connection.displayName ?? "公開名未設定"}</strong><span>{connection.email}</span></p>
        </header>

        <section className="studio-team__profile" aria-labelledby="studio-team-profile-heading">
          <div><h2 id="studio-team-profile-heading">自分の公開名</h2><p>公開された記事には、公開revisionを保存した編集者としてこの名前が表示されます。名前から編集者ページへ移動できます。</p></div>
          <form onSubmit={onProfileSubmit}>
            <label htmlFor="cms-profile-name">表示名</label>
            <input autoComplete="name" disabled={profileBusy} id="cms-profile-name" maxLength={80} onChange={(event) => onProfileNameChange(event.target.value)} placeholder="公開する名前" required type="text" value={profileName} />
            <p className="studio-team__help">メールアドレスは公開されません。他のメンバーがこの名前を変更することもできません。</p>
            <button className="dads-button" data-size="md" data-type="solid-fill" disabled={profileBusy || profileName.trim() === (connection.displayName ?? "")} type="submit">{profileBusy ? "保存中…" : "公開名を保存"}</button>
          </form>
          {profileError ? <p className="studio-team__error" role="alert">{profileError}</p> : null}
          <div className="studio-team__role"><strong>現在の役割: {cmsRoleLabels[connection.role]}</strong><p>{roleDescriptions[connection.role]}</p></div>
        </section>

        {canManageMembers ? (
          <section className="studio-team__admin" aria-labelledby="studio-team-admin-heading">
            <div className="studio-team__section-heading"><h2 id="studio-team-admin-heading">メンバーのアクセス管理</h2><p>管理者は招待、役割、利用停止を変更できます。公開名は各メンバー本人だけが設定します。</p></div>
            <div className="studio-team__layout">
              <section className="studio-team__invite" aria-labelledby="studio-team-invite-heading">
                <div><h3 id="studio-team-invite-heading">メンバーを追加・変更</h3><p>登録したメールアドレスで本人確認すると、設定した役割でStudioを利用できます。</p></div>
                <form onSubmit={onSubmit}>
                  <label htmlFor="cms-member-email">メールアドレス</label>
                  <input disabled={busy} id="cms-member-email" onChange={(event) => onEmailChange(event.target.value)} placeholder="editor@example.com" required type="email" value={email} />
                  <label htmlFor="cms-member-role">役割</label>
                  <select disabled={busy} id="cms-member-role" onChange={(event) => onRoleChange(event.target.value as CmsRole)} value={role}>{(Object.keys(cmsRoleLabels) as CmsRole[]).map((choice) => <option key={choice} value={choice}>{cmsRoleLabels[choice]}</option>)}</select>
                  <p className="studio-team__help">{roleDescriptions[role]}</p>
                  <label className="studio-team__active"><input checked={active} disabled={busy} onChange={(event) => onActiveChange(event.target.checked)} type="checkbox" /><span>このメンバーを有効にする</span></label>
                  <button className="dads-button" data-size="md" data-type="solid-fill" disabled={busy} type="submit">{busy ? "更新中…" : "アクセスを保存"}</button>
                </form>
                {error ? <p className="studio-team__error" role="alert">{error}</p> : null}
              </section>

              <section className="studio-team__members" aria-labelledby="studio-team-members-heading">
                <div className="studio-team__members-heading"><h3 id="studio-team-members-heading">メンバー</h3><strong>{members.length}人</strong></div>
                {members.length === 0 && !busy ? <p className="studio-team__empty">登録済みのメンバーはいません。</p> : <ul className="studio-team__list">{members.map((member) => {
                  const isSelf = member.email.toLowerCase() === connection.email.toLowerCase();
                  return <li key={member.email}><div><strong>{member.displayName ?? "公開名未設定"}</strong><span>{member.email}</span><small>{cmsRoleLabels[member.role]}・{member.active ? "有効" : "停止"}・{member.provisioned ? "利用開始済み" : "招待待ち"}・{member.passwordLoginReadyAt ? "パスワード設定済み" : "パスワード未設定"}</small></div>{isSelf ? <span className="studio-team__self">自分</span> : <button className="dads-button" data-size="sm" data-type="outline" disabled={busy} onClick={() => onEdit(member)} type="button">アクセスを編集</button>}</li>;
                })}</ul>}
              </section>
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
