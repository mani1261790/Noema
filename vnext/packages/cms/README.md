# Noema CMS contract

`@noema/cms`は、Noema StudioとブログWorkerが共有するCMS domain contractです。Cloudflare D1に保存する記事、revision、role、review状態、publication状態、公開範囲と、HTTP APIの入力を定義します。

このpackage自身はD1やnetworkへ接続しません。D1 repositoryとStudio認証は`apps/studio`、公開記事のread modelは`apps/blog`が実装します。

## Source of truth

- 記事、revision、role、review、公開範囲、監査event: Cloudflare D1 `noema-cms`
- schema migration: `apps/studio/migrations`
- binary asset: private Cloudflare R2を予定。現在はaccount未有効
- code、migration、docs、必要に応じてD1から書き出したbackup: GitHub
- ブラウザ`localStorage`: 通信障害や競合時の復旧コピーだけ

Git repository内のMarkdownや旧GitHub Draft Pull Request flowを、現行記事のsource of truthとして使用しません。

## Role

| role | 権限 |
| --- | --- |
| `admin` | 編集、承認、メンバー管理、公開、保管 |
| `editor` | 編集、保存、レビュー依頼 |
| `reviewer` | 編集、保存、レビュー依頼、承認、修正依頼 |

レビュー担当は、自分が保存したcurrent revisionを自己承認できません。管理者は初期運用と障害対応のため全操作を実行できます。

Noema Studioのユーザー、credential、sessionはBetter Authを介してD1に保存します。認証ユーザーIDは`cms_auth_identities`を介して既存のCMS memberへ結び付け、roleは引き続き`cms_members`だけが決定します。認証ユーザーを作っただけではCMS権限を取得できません。

既存メンバーの移行期間中は、Cloudflare Accessのメールコードを初回設定・復旧用の本人確認として残します。本人確認済みの有効なCMS memberだけが、登録済みメールアドレスへNoemaのパスワードを設定できます。全員の設定と復旧手段を確認する前にAccess境界を撤去しません。

## Reviewとpublication

Review状態:

- `draft`: 編集中
- `in_review`: レビュー待ち
- `changes_requested`: 要修正
- `approved`: current revisionが承認済み

Publication状態:

- `unpublished`: ブログへ配信しない
- `published`: published revisionを公開範囲に従って配信
- `archived`: ブログから外して保管

Reviewとpublicationは別の状態です。公開中の記事に新しいrevisionを保存しても、published revisionは変更しません。Current revisionをレビュー、承認し、管理者が公開したときだけpublished revision pointerを更新します。

レビュー中と承認済みのrevisionは本文・設定とも固定し、`PUT`でも更新を拒否します。編集者または管理者がレビューを取り下げるか、レビュー担当が修正を依頼してから次のrevisionを保存します。管理者はcurrent revisionとapproved revisionが一致するときだけ公開できます。

## 状態遷移

| action | 実行できるrole | 前提 | 結果 |
| --- | --- | --- | --- |
| `request_review` | `admin`、`editor` | reviewが`draft`または`changes_requested`で、記事検証に成功 | reviewを`in_review`へ変更し、以前の承認pointerを外す |
| `withdraw_review` | `admin`、`editor` | reviewが`in_review` | reviewを`draft`へ戻し、編集を再開する |
| `approve` | `admin`、`reviewer` | reviewが`in_review` | reviewを`approved`へ変更し、current revisionをapproved revisionへ固定 |
| `revoke_approval` | `admin`、`reviewer` | reviewが`approved` | reviewを`in_review`へ戻し、承認pointerを外す。公開済みrevisionは変更しない |
| `request_changes` | `admin`、`reviewer` | reviewが`in_review`または`approved`で、修正理由が入力済み | reviewを`changes_requested`へ変更し、理由をrevisionに紐づくコメントとして残して承認pointerを外す |
| `publish` | `admin` | reviewが`approved`で、current revisionとapproved revisionが一致 | current revision、slug、公開範囲をpublished pointerへ固定 |
| `archive` | `admin` | publicationが`published` | publicationを`archived`へ変更し、公開面から外す |
| `restore` | `admin` | publicationが`archived` | publicationを`unpublished`へ戻す。自動では再公開しない |

`reviewer`は記事本文・記事設定を編集できず、レビュー対象の閲覧、コメント、承認、修正依頼だけを行えます。コメントは対象revision、投稿者、日時、対象箇所とともに追記保存します。`admin`は初期運用と障害対応のため自己承認制限をoverrideできます。`restricted`と`internal`は原稿の保存・レビューまでは可能ですが、現状の`publish`は拒否します。

## 公開範囲

| 値 | 公開面 |
| --- | --- |
| `public` | 一覧、検索、テーマ、RSS、sitemap、直接URL |
| `unlisted` | 直接URLだけ。`noindex`。認証ではない |
| `restricted` | 指定メンバー向け。読者認証未接続のため現在は公開不可 |
| `internal` | Studio内だけ。公開ブログから取得不可 |

Blogのlist queryは`public`だけを返し、detail queryは`public`と`unlisted`だけを返します。記事アシスタントも同じdetail queryを通過した記事だけをcontextにします。

## Revisionと競合

記事本文とfrontmatterはimmutableなrevisionとして保存します。Article rowは少なくとも次のpointerを持ちます。

- `current_revision_id`: Studioが現在編集する最新版
- `approved_revision_id`: reviewerが承認したrevision
- `published_revision_id`: Blogが読者へ配信するrevision

更新と状態遷移はarticleの`lock_version`を`ETag`へ変換し、requestの`If-Match`と照合します。古いversionからの操作は`412 revision_conflict`で停止し、後勝ち上書きを行いません。競合したupdateで孤立revisionを作らないことをD1 repository testで保証します。

## Draftと公開validation

Draft保存では入力途中のfrontmatterを許容します。レビュー依頼時に`@noema/content`のstrict schemaとMarkdown validatorを適用します。公開操作は、その検証済みrevisionがcurrentかつapprovedである場合だけ成功します。Blog readerもpublished revisionのfrontmatterをstrict schemaで検証してから配信します。

- raw HTMLを許可しない
- 危険なURL schemeを許可しない
- 記事本文にH1を置かない
- 見出し階層、画像alt、内部リンク形式を検証する
- slugはD1で全記事一意にする

Blog rendererもraw HTMLをescapeし、危険なlink・image URLを無効化します。Validatorだけをsecurity境界にしません。

## API

Studio Workerは次のCMS endpointを提供します。

- `GET /api/cms/session`
- `GET /api/cms/articles`
- `POST /api/cms/articles`
- `GET /api/cms/articles/{id}`
- `PUT /api/cms/articles/{id}`
- `POST /api/cms/articles/{id}/actions`
- `GET /api/cms/articles/{id}/comments`
- `POST /api/cms/articles/{id}/comments`
- `PATCH /api/cms/articles/{id}/comments/{commentId}`
- `GET /api/cms/members`
- `PUT /api/cms/members`
- `POST /api/studio-auth/password`（既存メンバーの初回設定）
- `POST /api/auth/sign-in/email`
- `POST /api/auth/sign-out`
- `GET /api/auth/get-session`

Mutationは固定Studio origin、Noema sessionまたは移行中のAccess JWT、CMS role、`application/json`、streaming request上限、strict schemaを検証します。公開signup endpointは提供しません。Article updateとactionには`If-Match`が必須です。CMS responseは`private, no-store`とし、API errorをStudio SPAのHTMLへフォールバックさせません。

## R2 asset plan

R2はaccountで未有効のため、現在のStudioには画像upload機能がありません。導入時は次を満たします。

- bucketをprivateのままにし、`r2.dev`を有効化しない
- Studio WorkerだけがAccess認証とCMS roleを通過したuploadを受ける
- asset ID、object key、content type、size、digest、参照関係をD1で管理する
- Blog Workerはpublished revisionとasset metadataを確認してから配信する
- object keyをimmutableにし、既存revisionが参照するobjectを上書きしない
- 削除前に全revisionからの参照を確認し、即時のhard deleteを避ける

R2のaccount有効化、billing、bucket作成は通常deployへ組み込まず、明示承認後の一度だけのprovisioningとして行います。

## 関連文書

- [Studio・CMS・ブログ接続ガイド](../../../docs/studio-blog-connectivity.md)
- [開発環境デプロイ](../../../docs/development-deployment.md)
- [コンテンツ・掲載方針](../../../docs/content-strategy.md)
