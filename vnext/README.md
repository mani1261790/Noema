# Noemaアプリケーション

Markdown技術ブログとしての現行実装です。directory名の`vnext`は旧AWS版と並行開発していた時期の名残ですが、現在はこちらが唯一のNoema applicationです。

退役したNext.js/AWS版は [Noema AWS Archive](https://github.com/mani1261790/Noema-AWS-Archive) に保存しています。

## 必要環境

- Node.js 22.18以上
- npm
- Cloudflareへ手動deployする場合だけWrangler login

GitHub ActionsではNode.js 24とWrangler 4.110.0を使います。

## Workspace

- `apps/blog`: Astroで構築するブログと記事アシスタントAPI
- `apps/studio`: React/Viteで構築するMarkdown執筆Studio
- `apps/public-gate`: `noema-learn.uk`を非公開に保つWorker
- `packages/content`: 記事schema、Markdown出力、UI確認用fixture
- `packages/ui`: Noema共通styleとデジタル庁公式snippet由来CSS
- `design/concepts`: 実装照合用の画面concept
- `design/qa`: browser確認時のcapture

## ローカル開発

```bash
cd vnext
npm ci
npm run dev:blog
```

別terminalでStudioを起動します。

```bash
cd vnext
npm run dev:studio
```

- ブログ: `http://localhost:4321`
- Studio: `http://localhost:4322`

`dev:studio`はUI編集用のViteだけを起動し、Worker APIや`.dev.vars`は読みません。公開APIを含む統合確認では、Studioをproduction buildしてWranglerで配信します。

```bash
cd vnext
npm run dev:studio:worker
```

既定URLは`http://localhost:8787`です。ローカルのmutation境界を確認する場合は、`.dev.vars`の`STUDIO_ALLOWED_ORIGIN`もこのoriginへ合わせます。

記事は`apps/blog/src/content/articles`へMarkdownで配置します。現在の公開記事は空で、開発画面は`packages/content`のfixtureを使います。`/preview/article`は`noindex`です。

記事のfrontmatterでは、話題を表す`topics`と、技術への触れ方を表す`approach`を独立して設定します。`approach`は`experience`、`practice`、`development`、`theory`の4種類で、開発と理論は並列です。加えて`outcome`、`prerequisites`を設定します。正は[コンテンツ・掲載方針](../docs/content-strategy.md)を参照してください。

公開記事はホーム、記事一覧、テーマページへ自動配置されます。記事一覧ではタイトル・概要・タグのキーワード検索、テーマ・タグの絞り込み、12件単位のページ送りが使え、検索条件はURLで共有できます。

ヘッダーの検索ボタンはページ内で検索ボックスを展開し、キーワードを記事一覧へ引き継ぎます。記事一覧ではキーワード検索を常に表示し、テーマ・タグは詳細条件として折りたたみます。

ブログのbuild前に`generate:og`が実行され、公開記事ごとの1200×630 PNGを`public/og`へ生成します。生成物はGit管理せず、Cloudflareへdeployする成果物だけに含めます。

Studioは既存のMarkdownを読み込み、すべてのfrontmatter項目を再編集できます。入力内容はブラウザ内へ自動保存され、Markdownを書き出すまでサーバーへ送信しません。本文のraw HTML、危険なURL scheme、H1、見出しレベルの飛び、画像alt、内部リンク形式は公開buildと共通のvalidatorで検査し、blocking errorから本文の該当行へ移動できます。リンク先記事の存在確認には全記事が必要なため、Studioでは確認待ちとして表示し、公開buildで確定します。

ブログのdev・check・build開始前には、記事全体のslug重複、公開状態を含む記事リンク、記事内fragmentも検証します。raw HTMLはvalidatorで拒否してrendererでもテキストとしてescapeし、危険なリンク・画像URLは両層で拒否または無効化します。HTMLのコード例はインラインコードまたはコードフェンスへ記述してください。

Studioのプレビューでは、`/`から始まる記事画像、本文画像、リンクを公開ブログのURLに対して解決します。記事ファイル相対の参照と本文内の見出しリンクは書き換えません。公開ブログのURLはbuild時の`VITE_PUBLIC_SITE_URL`で指定し、未指定のローカル開発では`http://localhost:4321`を使います。手動でStudioをdeployする場合は、localhostを埋め込まないようにこの環境変数を必須とします。

## Studio公開API境界

Studio Workerは`/api/*`だけを静的SPAより先に処理します。現段階では、Cloudflare Access認証を検証する境界だけを提供し、GitHubやR2への書き込みは行いません。

- `GET /api/publication-capabilities`: Access設定がなければidentityを返さず503、認証できれば最小identityと`state: disabled`、`code: github_app_not_configured`、`submissionMode: create_only`を返す
- `POST /api/article-submissions`: 固定allowed originと認証を確認した後も`503 github_app_not_configured`を返す
- その他の`/api/*`: JSONの404を返し、StudioのHTMLへフォールバックしない

capabilitiesのidentityは検証済みJWTからserver側で導出します。将来のsubmission requestにemailやsubjectを含めず、`requestedBy`も必ずJWTから決定します。`subject`はCloudflare Accessのopaqueな識別子であり、GitHub user、記事の`authors`、画面表示名には流用しません。

`wrangler.jsonc`の`ACCESS_TEAM_DOMAIN`、`ACCESS_POLICY_AUD`、`STUDIO_ALLOWED_ORIGIN`は意図的に空で、deploy直後のAPIはfail-closedです。この3値のdeploy時source of truthは現在の`wrangler.jsonc`であり、Dashboardの手動変更やローカル専用の`.dev.vars`では有効化できません。実環境を有効にする変更では、review可能なrepository設定として3値の注入方法を追加し、先に`studio.noema-learn.uk`を保護するCloudflare Access applicationと許可policyを作成します。team domainは`<team>.cloudflareaccess.com`または同じHTTPS URLを受け付けます。コード上のJWT検証が存在しても、Accessの外部設定が完了したことにはなりません。

Wrangler統合確認用の実値はGit管理しない`.dev.vars`へ置きます。`Cf-Access-Jwt-Assertion`だけを認証入力として使い、`CF_Authorization` cookie単体、JWT、将来のGitHub秘密鍵をログやリポジトリへ残しません。実際のGitHub書き込みを有効にする前に、custom hostnameのAccess policyを実環境で受入確認し、`workers.dev`とpreview URLを無効化または同等に保護します。現在は新規記事のDraft PRだけを次の対象とし、既存記事はStudioで編集・Markdown出力できてもAPI送信対象にはしません。

## 記事アシスタント

読者自身のOpenAI API keyをrequest中だけ使います。

- API keyと会話を永続化しない
- OpenAI Responses APIへ`store: false`を指定する
- 表示中の記事だけをcontextにする
- 回答をStructured Outputsで検証し、根拠にした記事内見出しへのリンクを表示する
- StudioはMarkdownをlocal fileへ書き出し、直接公開しない

## 検証

```bash
cd vnext
npm test
npm run check
npm test
npm run build
npm run deploy:dry-run
```

`deploy:dry-run`はCloudflareへ認証・uploadせず、公開ゲート、ブログ、StudioのWorker成果物を検証します。

## Cloudflare開発環境

| 対象 | Worker | URL |
| --- | --- | --- |
| ブログ | `noema-learn` | <https://noema-learn.mani1261790.workers.dev> |
| Studio | `noema-studio` | <https://noema-studio.mani1261790.workers.dev> |
| 公開ゲート | `noema-public-gate` | <https://noema-learn.uk>（404） |

ブログとStudioは`workers.dev`で確認します。ブログWorkerは本番routeを持たず、`noema-learn.uk/*`は公開ゲートだけが受けます。

## 自動デプロイ

`.github/workflows/deploy-development.yml`が`develop`の最新versionを3 Workerへdeployします。

- `develop`へのpushだけがtrigger
- `main`、feature branch、Pull Requestはdeployしない
- 手動実行も`develop` refだけを許可
- GitHub Deployments / Environmentsは使わない
- repository secret `CLOUDFLARE_API_TOKEN`を使用
- 公開ゲート、ブログ、Studioの順にdeploy

設定、確認、手動実行、rollbackの正は [開発環境デプロイ](../docs/development-deployment.md) を参照してください。

## デザイン資料

- `design/concepts`: 実装前の画面concept
- `design/qa`: 実browserで確認したcapture
- `DESIGN_CONFORMANCE.md`: デジタル庁デザインシステムとの対応表
