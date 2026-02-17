# Noema MVP Roadmap

## Phase 0: Repository Bootstrap (1-2 days)

- 基本ドキュメント整備
- API 契約の固定（OpenAPI）
- 主要データモデル定義

## Phase 1: Static Learning Experience (1 week)

- `ipynb -> HTML` ビルドパイプライン作成
- 教材メタデータ管理（章、順序、タグ）
- サイドバーアコーディオンUI + HTML表示
- Colabリンク表示
- 動画プレイヤー（HTML5 + PiP）

Done criteria:

- 3本以上の教材を階層表示
- 教材ページ p95 < 200ms（CDNヒット時）

## Phase 2: Auth + Q&A Core (1 week)

- Cognito 認証統合（OAuth2 + email/password）
- 質問投稿 API / 回答取得 API
- 非同期ジョブ（SQS + Worker Lambda）
- OpenAI/Bedrock 最小RAG実装（top-k retrieval + answer generation）

Done criteria:

- ログイン済みユーザーのみ質問可能
- 平均回答時間 < 1.5s（キャッシュヒット含む）

## Phase 3: Admin & Observability (1 week)

- 管理者画面（教材登録、質問ログ閲覧、回答修正）
- CloudWatch ダッシュボード
- KPI 計測（キャッシュヒット率、成功率）

Done criteria:

- 教材アップロード成功率 99%
- 過去Q&Aの検索・修正が可能

## Phase 4: Cost & Quality Tuning (ongoing)

- モデルルータ導入（small/mid/large fallback）
- プロンプト最適化・出力制限
- Retrieval chunking / re-ranking 調整
- FAQ自動生成バッチ

## Future: Notebook Auto-Improvement Agent

- Q&Aログから改善候補を抽出
- ipynbパッチ生成 -> PR自動作成
- 管理者承認後にマージ
