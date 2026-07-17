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

記事は`apps/blog/src/content/articles`へMarkdownで配置します。現在の公開記事は空で、開発画面は`packages/content`のfixtureを使います。`/preview/article`は`noindex`です。

記事のfrontmatterでは、話題を表す`topics`と、技術への触れ方を表す`approach`を独立して設定します。`approach`は`experience`、`practice`、`development`、`theory`の4種類で、開発と理論は並列です。加えて`outcome`、`prerequisites`を設定します。正は[コンテンツ・掲載方針](../docs/content-strategy.md)を参照してください。

公開記事はホーム、記事一覧、テーマページへ自動配置されます。記事一覧ではタイトル・概要・タグのキーワード検索、テーマ・タグの絞り込み、12件単位のページ送りが使え、検索条件はURLで共有できます。

ヘッダーの検索ボタンはページ内で検索ボックスを展開し、キーワードを記事一覧へ引き継ぎます。記事一覧ではキーワード検索を常に表示し、テーマ・タグは詳細条件として折りたたみます。

ブログのbuild前に`generate:og`が実行され、公開記事ごとの1200×630 PNGを`public/og`へ生成します。生成物はGit管理せず、Cloudflareへdeployする成果物だけに含めます。

Studioは既存のMarkdownを読み込み、すべてのfrontmatter項目を再編集できます。入力内容はブラウザ内へ自動保存され、Markdownを書き出すまでサーバーへ送信しません。本文のraw HTML、危険なURL scheme、H1、見出しレベルの飛び、画像alt、内部リンク形式は公開buildと共通のvalidatorで検査し、blocking errorから本文の該当行へ移動できます。リンク先記事の存在確認には全記事が必要なため、Studioでは確認待ちとして表示し、公開buildで確定します。

ブログのdev・check・build開始前には、記事全体のslug重複、公開状態を含む記事リンク、記事内fragmentも検証します。raw HTMLはvalidatorで拒否してrendererでもテキストとしてescapeし、危険なリンク・画像URLは両層で拒否または無効化します。HTMLのコード例はインラインコードまたはコードフェンスへ記述してください。

Studioのプレビューでは、`/`から始まる記事画像、本文画像、リンクを公開ブログのURLに対して解決します。記事ファイル相対の参照と本文内の見出しリンクは書き換えません。公開ブログのURLはbuild時の`VITE_PUBLIC_SITE_URL`で指定し、未指定のローカル開発では`http://localhost:4321`を使います。手動でStudioをdeployする場合は、localhostを埋め込まないようにこの環境変数を必須とします。

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
