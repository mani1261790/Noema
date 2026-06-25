# Noema アーキテクチャ評価（2026-06）

> 5領域（フロント / インフラ・コスト / コンテンツパイプライン / 認証・セキュリティ / CI・健全性）を
> コードベース精査により評価したもの。理論部門の参画・チーム拡大を前に、現状の強み・弱み・優先対応を整理する。

## 総評

学生ソロ開発（実質 Mani 1人、348中345コミット）としては明らかに水準が高い。
一方で **「インフラは過剰設計・プロセスは未整備・本体は保守不能」という歪んだ三重構造**を抱え、
さらに **今すぐ悪用可能なセキュリティ穴が2件**ある。複雑さの方向が、教材プロダクトの実需
（数十人に教材＋Q&A）と噛み合っていない。4人チームへ引き継ぐ前に、下記の順で手当てが要る。

## スコアカード

| 領域 | 評価 | 一言 |
|---|---|---|
| コスト設計 | ◎ | 全サーバーレス、アイドル≈$0、月$5–15。LLMにレート/日次上限あり |
| 認証の設計境界 | ○ | プラットフォームJWT検証＋PKCE＋サーバー側admin。土台は正しい |
| セキュリティ実装 | 🔴 | 精査時点で未認証の答え漏洩・LLM費用青天井が稼働中（本PRで封鎖） |
| インフラ運用性 | △ | 過剰設計、監視デフォルトOFF、バス係数1 |
| アーキ構造 | 🔴 | フロント＆API二重実装、本番デッドコード、8,057行の単一ファイル |
| コード品質(lib) | ○ | `src/lib/*` はリポジトリ随一。型・サニタイズ・fallback良好 |
| 自動テスト | ✗ | ゼロ。churn の温床 |
| CI/CD・供給網 | ○ | OIDC・Dependabot・Clearwing。ただしPR時にコンテンツ検証が走らない |
| コンテンツ運用(チーム適性) | △ | catalog手編集が無防備、破壊的ジェネレータが地雷 |

---

## 🔴 P0: 今すぐ直すべき（実害・低工数）

### 1. 採点APIが未認証で答えを漏洩
- 該当: `infra/lambda/runtime.ts`（notebook-check 採点レスポンス / chapter-final 取得）、`infra/lib/noema-stack.ts`（該当ルートにJWT authorizer 未付与）
- 内容: 精査時点では `POST /api/assessments/notebooks/{id}/attempts` と `GET /api/assessments/chapters/{id}/final` が
  **未認証**で `correctChoiceId`（正解）・`explanation` を返す。ログイン不要で全教材の答えをスクレイプ可能。
- 修正: 該当ルートにJWT必須化、かつ採点レスポンスから正解情報を除去。**本PRで対応**

### 2. chapter-final 採点の LLM 費用が青天井
- 該当: `infra/lambda/runtime.ts`（`createChapterFinalAssessmentAttempt` → 採点ジョブが問題数ぶん `callBedrock`）
- 内容: 精査時点ではレート制限も日次上限もなく、提出1回でBedrockを問題数ぶん呼ぶ。ループ提出で無制限課金。
- 修正: 既存の `assertQuestionRateLimitAvailable` ＋ `acquireBedrockDailySlot` を適用し、問題数ぶんのBedrock枠を提出前に確保。**本PRで対応**

### 3. 本番デッドコードの削除
- 該当: `src/app/api/*`（Next.js API ルート群）
- 内容: 本番は静的SPA＋Lambda API。`src/app/api/*` は **本番未デプロイのデッドコード**で、
  パストラバーサル（`src/lib/assessment-storage.ts` の未サニタイズ `id`）＋答え漏洩を内包。
- 修正: 削除（または明示的に dev 専用と文書化）。`docs/openapi.yaml` の不実記述も解消。**工数 S**

---

## P1: 4人チーム化の前提条件

### 4. 自動テストがゼロ
- 直近60コミット中22件が fix/retry。特に**認証**と**LLM応答パース**で「v2/follow-up」（直したものを再度直す）。
- 修正: Vitest 導入。壊れやすい所（auth token 解決・LLM パース・assessment 整合性）からピン留め。**工数 M**

### 5. コンテンツCIがPRで走っていない
- 本PR前の `ci.yml` は typecheck/lint/build のみ。`check:assessment-integrity` は deploy 後、
  `check:notebook-code` / `isolated-run` はどのワークフローでも自動実行されていなかった。
- 修正: `check:catalog` / `check:assessment-integrity` / `check:notebook-code` を `ci.yml` の `pull_request` に追加（`python3` セットアップ込み）。**本PRで対応**

### 6. 破壊的ジェネレータの凍結
- 該当: `scripts/generate-curriculum-shell.ts` / `scripts/author-curriculum.ts`
- 内容: カリキュラムを TypeScript 側に保持し、**再実行すると手編集した .ipynb を上書き・削除**する。
  Phase 0 監査の編集が消える地雷。
- 修正: 既存ファイルがある場合は拒否するガードを入れ、`.ipynb` が正本であると明記。**工数 S**

### 7. catalog.json バリデータ
- 内容: 175KB の手編集 JSON、スキーマ検証なし。カンマ1つで全サイト崩壊。id↔.ipynb↔セクションが3箇所に重複。
  理論部門（ryo/rui）の最大の貢献障壁。
- 修正: `check:catalog`（JSONスキーマ＋各 id に対応する .ipynb 実在確認＋重複 id/order 検出）を新設し PR CI へ。**工数 M**

---

## P2: 構造的負債と判断

### スプリットブレイン構成（最大の論点）
- 本番の学習体験 = `public/index.html`（**8,057行・JS約4,900行を単一IIFEに直書き**、グローバル可変state、手DOM操作）。事実上保守不能。
- Next.js (`src/app`) = SEO玄関＋**本番デッドな重複API**。最良のコード（`src/lib`）はここにある。
- catalog 正規化・SEOメタが TS/JS 境界で**二重管理**され手動同期（`src/lib/notebooks.ts` vs `public/index.html`）。

### 過剰設計
- Q&A の SQS/worker/DLQ 非同期パイプライン、標準＋torch入りの2種 Python ランナー、3 LLM プロバイダ。
  数十人＋片手間1人には重い。`noemaInlineQa` で同期化、heavy ランナー廃止を検討すると運用が軽くなる。

### Python ランナーのサンドボックス不在
- ユーザーコードを `exec()` 実行、**実行時 `pip install` 任意パッケージ＋IAM認証情報が環境変数で露出＋ネットワーク全開放**。
  信頼できる学生中心なら実害は出にくいが、悪意あるユーザーには無防備。中期で `AWS_*` 環境変数除去＋runtime pip 無効化を。

### その他（中リスク）
- GitHub OIDC デプロイロールが `*:*` on `*`（`noema-stack.ts`）。push 権限者＝口座広域権限。スコープ縮小を。
- 監視（`enableOperationalMonitoring`）がデフォルトOFFなのに runbook は監視前提 → 障害が無通知。prod で ON に。
- Service Worker が認証付き `/api/*` GET をキャッシュ（`public/sw.js`）。共有端末でのプライバシーリスク。`/api/` を除外。
- Next 14 / React 18 / ESLint 8 と一世代古い。Dependabot が major を ignore し負債が累積。計画的に上げる。

---

## 推奨ロードマップ

**フロント全面書き換えは今やらない。** 教材プロダクトの本体は「中身」であり、プラットフォーム刷新に
4人の限られた時間を溶かすのは悪手。順序は：

1. **P0**（実害封鎖）— 1〜2日
2. **P1**（プロセス整備：テスト・CI・地雷除去）— チーム監査の安全装置。監査開始の前提
3. **重複API削除＋過剰設計の整理**（工数M、運用が軽くなる）
4. **8,000行シェルを「チャット」「Playground」から少しずつ Next.js へ抽出**（工数L、一度にやらない）

> チーム開発計画への跳ね返り: **監査（Phase 0）を始める前に、P0＋6＋7 を先に通す**。
> でないと「監査でノート手編集 → 誰かがジェネレータ再実行 → 編集消滅」「catalog 構文崩壊で全サイト停止」が起こり得る。

---

> 評価実施: 2026-06-24。コードベース精査（5領域並列）による。行番号は精査時点のもの。
