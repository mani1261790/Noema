# Noema CMS contract

`@noema/cms`は、Noema StudioとブログWorkerが共有するCMS domain contractです。Cloudflare D1に保存する記事、revision、role、review状態、publication状態、公開範囲と、HTTP APIの入力を定義します。

このpackage自身はD1やnetworkへ接続しません。D1 repositoryとAccess認証は`apps/studio`、公開記事のread modelは`apps/blog`が実装します。

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

Cloudflare Access identityは入口の認証であり、それだけではCMS権限になりません。Accessで検証したemailとsubjectを、管理者が登録した招待またはbootstrap admin設定と照合してCMS memberへ結び付けます。

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

承認後に新しいrevisionを保存した場合、そのrevisionは再レビューが必要です。管理者はcurrent revisionとapproved revisionが一致するときだけ公開できます。

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
- `GET /api/cms/members`
- `PUT /api/cms/members`

Mutationは固定Studio origin、Access JWT、CMS role、`application/json`、streaming request上限、strict schemaを検証します。Article updateとactionには`If-Match`が必須です。CMS responseは`private, no-store`とし、API errorをStudio SPAのHTMLへフォールバックさせません。

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
