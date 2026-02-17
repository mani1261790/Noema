# Noema System Architecture (MVP)

## 1. 全体構成

```text
[Browser]
  ├─ CloudFront ── S3 (Static site + HTML教材)
  └─ API Gateway ── Lambda (AuthZ / Q&A / Admin)
                      ├─ DynamoDB (Q&A, cache, metadata)
                      ├─ OpenSearch or pgvector (retrieval index)
                      └─ Amazon Bedrock (LLM inference)

[Cognito]
  └─ JWT発行（OAuth2, Email/Password）

[CI/CD]
  ├─ Notebook build (Jupyter Book / nbconvert)
  └─ Deploy static + backend
```

## 2. コンポーネント責務

- Frontend (Next.js)
- ログイン状態の維持
- サイドバー（章/節のアコーディオン表示）
- 教材HTML表示、動画プレイヤー（PiP対応）
- 質問投稿・回答表示UI

- Static Builder
- `ipynb` から HTML を生成
- ノートごとのメタデータ（title, tags, order, section）を出力
- Colabリンクをノート単位で埋め込み

- API Backend (Lambda)
- `/api/questions`: 質問受付、重複質問キャッシュ確認、非同期ジョブ投入
- `/api/questions/{id}/answer`: 回答状態・本文・出典を返却
- `/api/admin/*`: 管理者専用（教材登録、ログ閲覧）

- RAG Pipeline
- クエリ正規化
- インデックスから関連チャンク抽出
- コンテキスト圧縮後に Bedrock へ推論依頼
- 根拠リンク付きで回答を保存

## 3. 主要シーケンス

## 3.1 教材閲覧

1. ユーザーがログイン
2. フロントが教材メタ一覧を取得
3. サイドバーでノート選択
4. CDN経由で静的HTMLを表示

## 3.2 質問応答

1. ユーザーが質問投稿
2. APIが質問ハッシュを作成しキャッシュ照会
3. ヒット時は既存回答を返却
4. ミス時はジョブ登録（SQS想定）
5. ワーカーLambdaがRAG + Bedrock実行
6. 回答と出典を保存
7. フロントがポーリングして回答表示

## 4. セキュリティ設計

- APIは Cognito JWT 検証必須
- 管理APIは `role=admin` のみ許可
- Bedrock 呼び出しは IAM role を最小権限化
- すべて HTTPS
- 入力バリデーション（長さ、禁止タグ、レート制限）
- XSS/CSRF対策（CSP, SameSite, CSRF token）

## 5. コスト最適化

- 静的ページは CloudFront キャッシュを最大活用
- LLM はモデルルータで small -> mid -> large fallback
- 質問ハッシュキャッシュで同一質問再計算を抑制
- Retrieval チャンクサイズと top-k を制限してトークン節約
- ログ・メトリクスは保存期間を段階設定

## 6. 拡張方針

- ノート追加はメタデータ登録だけで反映
- LLMモデル追加は router 設定ファイルで切り替え
- 将来の自動補正エージェントは「PR生成のみ」を初期導入
