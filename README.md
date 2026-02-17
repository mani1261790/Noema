# Noema

学習サイト（LLM FAQ + Notebook教材実行連動）構築プロジェクト。

## 目的

学部1年生レベルの初学者が、機械学習・LLM・強化学習・世界モデルを段階的に学べる教材プラットフォームを提供する。

- 静的教材配信: `ipynb` を HTML 化して高速表示
- 学習支援: ノート文脈に紐づいた RAG ベース質問応答
- 運用最適化: S3/CloudFront + サーバレス中心でコストを最小化

## 想定アーキテクチャ（MVP）

- Frontend: Next.js + Tailwind CSS
- Static Contents: Jupyter Book または nbconvert で生成し S3 配信
- Auth: Amazon Cognito（OAuth2 + Email/Password）
- API: API Gateway + AWS Lambda
- LLM: Amazon Bedrock（モデルルータ付き）
- Data: DynamoDB（質問/回答/キャッシュ/メタデータ）
- Retrieval: OpenSearch または pgvector
- CDN: CloudFront

詳細は `docs/system-architecture.md` を参照。

## MVPで先に作るもの

1. 認証付き Web アプリ基盤（ログイン必須）
2. 教材一覧サイドバー + HTML教材表示 + Colabリンク
3. 質問投稿・回答取得 API
4. RAGパイプライン（検索→Bedrock→保存）
5. 管理者画面（質問ログ閲覧、教材メタ管理）

## リポジトリ構成（初期）

- `docs/system-architecture.md`: システム設計
- `docs/openapi.yaml`: API 契約
- `docs/data-model.md`: データモデル
- `docs/mvp-roadmap.md`: 実装ロードマップ

## ローカル起動

```bash
npm install
cp .env.example .env
npm run db:push
npm run build:notebooks
npm run db:seed
npm run sync:notebooks
npm run dev
```

別ターミナルでワーカーを起動（非同期処理確認時）:

```bash
npm run worker
```

本番で永続アップロードを使う場合は `.env` に `S3_BUCKET_NAME` と `S3_REGION` を設定すると、管理画面の教材アップロードは S3 に保存されます。

## AWS インフラ (CDK)

`/Users/mani/Developer/Noema/infra` に本番インフラ定義があります。

```bash
cd /Users/mani/Developer/Noema/infra
npm install

export AWS_PROFILE=noema-prod
export AWS_REGION=ap-northeast-3

# 初回のみ
npx cdk bootstrap aws://437089831576/ap-northeast-3

# 差分確認
npm run diff

# デプロイ
npm run deploy -- --require-approval never
```

運用ドキュメント:

- `docs/operations/aws-setup.md`
- `docs/operations/dev-loop.md`
- `docs/operations/runbook.md`

## KPI

- 教材ページ表示: p95 < 200ms（CDNキャッシュヒット時）
- LLM回答生成: 平均 < 1.5s（キュー処理 + キャッシュ前提）
- キャッシュヒット率: > 30%
- 教材ビルド成功率: 99%
