# Noema System Architecture (Current)

最終更新: 2026-04-27  
このドキュメントは、現行リポジトリ実装（`src/`, `public/`, `scripts/`, `infra/`）に合わせた構成を示します。

## 1. 全体構成

```text
[Learner Browser]
  ├─ Next.js app (src/app)
  │    ├─ /               : ランディング
  │    ├─ /learn          : 教材一覧
  │    ├─ /learn/{id}     : 教材詳細（SEO向け）
  │    └─ /api/*          : catalog / notebook content / download / assessments
  │
  └─ Static app (public/index.html)
       └─ ノートブック閲覧 + 学習UI + 認証導線

[Content]
  ├─ content/notebooks/**/*.ipynb
  ├─ content/assessments/notebook-checks/*.json
  ├─ content/assessments/chapter-finals/*.json
  └─ content/catalog.json

[Build scripts]
  ├─ scripts/build-notebooks.ts
  └─ scripts/sync-notebooks-aws.ts

[AWS (infra)]
  ├─ CloudFront + S3 (site / notebooks)
  ├─ API Gateway + Lambda (Q&A / Admin / runtime)
  ├─ DynamoDB / SQS
  └─ Cognito
```

## 2. アプリケーション層

### 2.1 Next.js (`src/app`)

- `/`:
  `notebookId` クエリがあれば `/index.html?notebookId=...` へリダイレクト。通常時は学習サービスのトップページを表示。
- `/learn`:
  `content/catalog.json` から章・教材一覧を表示。
- `/learn/[notebookId]`:
  ノート本文を描画し、JSON-LD / Open Graph / canonical を付与。
- `/login`, `/signup`, `/admin`:
  static HTML 側（`/login.html`, `/admin.html`）へリダイレクト。
- `src/app/api/*`:
  catalog / notebook content / assessment 配信 API を提供（詳細は `docs/openapi.yaml`）。

### 2.2 Static app (`public/index.html`)

- メインの学習 UI（サイドバー、教材表示、認証状態による導線）を提供。
- `public/notebooks/*.html` や `/api/notebooks/{id}/content` を利用して教材を表示。
- notebook 確認問題と chapter final を `/api/assessments/*` 経由で取得・提出する。
- chapter final の記述回答下書きは `localStorage` に章単位で保存し、ページ移動後も復元する。
- PWA 関連のマニフェスト・Service Worker は `public/manifest.webmanifest`, `public/sw.js`。

## 3. コンテンツパイプライン

### 3.1 ソース管理

- 教材の source of truth は `content/notebooks/**/*.ipynb`。
- 教材メタデータは `content/catalog.json`。
- assessment の source of truth は `content/assessments/**/*.json`。

### 3.2 ビルド

- `npm run build:notebooks`:
  `.ipynb` を HTML へ変換し、`public/notebooks/*.html` を生成。
- ビルド時に highlight.js / KaTeX アセットを `public/highlight`, `public/katex` に配置。

### 3.3 配信

- Next.js 側では `src/lib/storage.ts` が `htmlPath` に応じてローカル or S3 を読み分ける。
- S3 構成時は `S3_BUCKET_NAME`, `S3_REGION` などの環境変数で切り替え可能。

## 4. インフラ層（AWS CDK）

`infra/lib/noema-stack.ts` が以下を定義:

- Cognito User Pool / Client
- CloudFront + S3（site bucket, notebook bucket）
- API Gateway + Lambda（API / worker / python runner）
- DynamoDB（questions, answers, cache, notebooks, user-progress など）
- SQS（Q&A ジョブ）

注意:
- Next.js の `src/app/api/*` と、AWS Lambda 側 API（`infra/lambda/api.ts`）は別実装。
- 前者は SEO/配信補助用途、後者は認証付き Q&A/運用機能用途。

## 5. 主要フロー

### 5.1 教材表示（SEOページ）

1. ユーザーが `/learn/{notebookId}` にアクセス
2. `getCatalog()` と `getNotebookById()` でメタを取得
3. `getNotebookHtml()` で本文を取得してサニタイズ
4. ページ描画 + 構造化データ出力

### 5.2 ノートブックダウンロード

1. ユーザーが `/api/notebooks/{notebookId}/download` を呼ぶ
2. `loadNotebookIpynb()` が source をローカル/S3 から取得
3. canonicalize 済み JSON を添付ファイルとして返却

### 5.3 Assessment

1. 学習 UI が `/api/assessments/notebooks/{id}` または `/api/assessments/chapters/{id}/final` を取得
2. notebook check は即時採点、chapter final は rubric ベース採点を実行
3. chapter final の記述回答下書きはブラウザ `localStorage` に保存
4. 合否・試行結果は learning progress と統合して UI へ反映

## 6. ドキュメント対応

- API 契約: `docs/openapi.yaml`
- データモデル: `docs/data-model.md`, `docs/data-model-v2.md`
- 運用手順: `docs/operations/*`
