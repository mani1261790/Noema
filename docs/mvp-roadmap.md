# Noema MVP ロードマップ

## Phase 0: リポジトリ初期整備（1-2日）

- 基本ドキュメント整備
- API 契約の固定（OpenAPI）
- 主要データモデル定義

## Phase 1: 静的な学習体験（1週間）

- `ipynb -> HTML` ビルドパイプライン作成
- 教材メタデータ管理（章、順序、タグ）
- サイドバーアコーディオン UI + HTML 表示
- Colab リンク表示
- 動画プレイヤー（HTML5 + PiP）

完了条件:

- 3本以上の教材を階層表示
- 教材ページ p95 < 200ms（CDN ヒット時）

## Phase 2: 認証 + Q&A コア（1週間）

- Cognito 認証統合（OAuth2 + email/password）
- 質問投稿 API / 回答取得 API
- 非同期ジョブ（SQS + Worker Lambda）
- OpenAI/Bedrock 最小 RAG 実装（top-k retrieval + answer generation）

完了条件:

- ログイン済みユーザーのみ質問可能
- 平均回答時間 < 1.5s（キャッシュヒット含む）

## Phase 3: 管理画面と可観測性（1週間）

- 管理者画面（教材登録、質問ログ閲覧、回答修正）
- CloudWatch ダッシュボード
- KPI 計測（キャッシュヒット率、成功率）

完了条件:

- 教材アップロード成功率 99%
- 過去 Q&A の検索・修正が可能

## Phase 4: コストと品質の調整（継続）

- モデルルータ導入（small/mid/large fallback）
- プロンプト最適化・出力制限
- Retrieval chunking / re-ranking 調整
- FAQ 自動生成バッチ

## 将来: Notebook 自動改善エージェント

- Q&A ログから改善候補を抽出
- ipynb パッチ生成 -> PR 自動作成
- 管理者承認後にマージ
