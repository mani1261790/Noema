# Noema vNext

Markdown技術ブログへ移行する新実装です。現行のNext.js/AWSアプリを動かしたまま検証できるよう、ルートアプリとは分離しています。

Node.js 22.18以降が必要です。GitHub ActionsではNode.js 24を使用します。

## 構成

- `apps/blog`: Astroで構築する公開ブログと記事アシスタントAPI
- `apps/studio`: React/Viteで構築するMarkdown執筆エディター
- `packages/content`: 記事スキーマ、Markdown出力、UI確認用fixture
- `packages/ui`: Noema共通スタイルとデジタル庁公式コードスニペット由来CSS
- `design/concepts`: 実装照合に使用する画面コンセプト

## ローカル開発

```bash
cd vnext
npm install
npm run dev:blog
npm run dev:studio
```

ブログは既定で `http://localhost:4321`、Studioは `http://localhost:4322` で起動します。

公開記事は `apps/blog/src/content/articles` にMarkdownとして配置します。現在のコンテンツは空で、開発時に表示される記事はすべて `packages/content` のUI確認用fixtureです。`/preview/article` は `noindex` です。

記事アシスタントは読者自身のOpenAI APIキーをリクエスト中だけ使用します。APIキーと会話は永続化せず、OpenAI Responses APIへ転送するリクエストにも `store: false` を指定しています。Studioは生成したMarkdownをローカルへ書き出すだけで、公開処理は行いません。

## 検証

```bash
cd vnext
npm run check
npm run build
npm run deploy:dry-run
```

`deploy:dry-run` はCloudflareへの認証やアップロードを行わず、ブログとStudioのWorker成果物を検証します。

## Cloudflareへのデプロイ

公開ブログはCloudflare Workers上のAstro SSRアプリ、Studioは静的アセットを配信する別Workerとしてデプロイします。

- ブログWorker: `noema-learn`
- 本番URL: `https://noema-learn.uk`
- 本番ルート: `noema-learn.uk/*`
- Studio Worker: `noema-studio`（MVPでは`workers.dev` URLのみ）
- CloudflareアカウントID: `2ea670c2a6ff28e248ef084adf095e8b`

既存DNSレコードは変更しません。CloudflareのWorker Routeがリクエストを先に受ける構成なので、切り戻し時にはRouteを外すだけで現在のCloudFrontオリジンへ戻せます。

### ローカルから手動デプロイ

最初に対象のCloudflareアカウントへログインし、dry-runを通します。

```bash
cd vnext
npx wrangler login
npx wrangler whoami
npm ci
npm run check
npm run deploy:dry-run
```

本番へ反映する場合だけ、次を実行します。

```bash
cd vnext
VITE_PUBLIC_SITE_URL=https://noema-learn.uk npm run deploy:blog
VITE_PUBLIC_SITE_URL=https://noema-learn.uk npm run deploy:studio
```

ブログのデプロイは`noema-learn.uk/*`を新しいWorkerへ切り替えます。通常はGitHub Actionsを使用し、手動デプロイは障害対応または初期確認に限定します。

### GitHub Actionsの初期設定

`.github/workflows/deploy-vnext.yml` は`main`へのvNext変更時、または手動実行時に両Workerをデプロイします。GitHubの`production` environmentへ `CLOUDFLARE_API_TOKEN` を一度だけ登録してください。

1. Cloudflare Dashboardでプロフィールメニューから **My Profile** → **API Tokens** を開く。
2. **Create Token** を選び、**Edit Cloudflare Workers** テンプレートを使用する。
3. Account Resourcesを `Mani1261790@gmail.com's Account`、Zone Resourcesを `noema-learn.uk` に限定する。
4. Tokenを作成し、その場で表示される値をコピーする。Tokenはチャットやリポジトリへ貼り付けない。
5. リポジトリ直下で次を実行し、非表示の入力欄へTokenを貼り付けてEnterを押す。

```bash
gh secret set CLOUDFLARE_API_TOKEN --env production
gh secret list --env production
```

最後のコマンドで名前だけが表示されれば設定完了です。GitHub Web UIを使う場合は、**Settings** → **Environments** → **production** → **Environment secrets** → **Add environment secret** から同じ名前で登録します。

### ロールバック

Workerコードだけを一つ前へ戻す場合は、Cloudflare DashboardのWorkerデプロイ履歴からロールバックします。Cloudflare Workerから既存AWS配信へ完全に戻す場合は、**Workers & Pages** → `noema-learn` → **Settings** → **Domains & Routes** で `noema-learn.uk/*` のRouteだけを削除します。DNSレコードとAWS側のリソースは、移行完了を確認するまで削除しません。

Studioへ独自ドメインを付ける場合は、後続作業で `studio.noema-learn.uk` とCloudflare Accessを設定します。

## デザイン資料

- `design/concepts`: 実装前に作成した画面コンセプト
- `design/qa`: 実ブラウザで確認した画面キャプチャ
- `DESIGN_CONFORMANCE.md`: デジタル庁デザインシステムとの対応表
