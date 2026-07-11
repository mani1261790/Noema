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

Studioは既存のMarkdownを読み込み、すべてのfrontmatter項目を再編集できます。入力内容はブラウザ内へ自動保存され、Markdownを書き出すまでサーバーへ送信しません。

## 記事アシスタント

読者自身のOpenAI API keyをrequest中だけ使います。

- API keyと会話を永続化しない
- OpenAI Responses APIへ`store: false`を指定する
- 表示中の記事だけをcontextにする
- StudioはMarkdownをlocal fileへ書き出し、直接公開しない

## 検証

```bash
cd vnext
npm run check
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
