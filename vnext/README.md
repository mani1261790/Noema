# Noema vNext

Markdown技術ブログへ移行する新実装です。現行のNext.js/AWSアプリを動かしたまま検証できるよう、ルートアプリとは分離しています。

Node.js 22.18以降が必要です。

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
```

デプロイworkflow、Cloudflareリソース作成、DNS切替、AWS撤去はこの実装単位には含めません。

## デザイン資料

- `design/concepts`: 実装前に作成した画面コンセプト
- `design/qa`: 実ブラウザで確認した画面キャプチャ
- `DESIGN_CONFORMANCE.md`: デジタル庁デザインシステムとの対応表
