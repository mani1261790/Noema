# コンテンツ貢献ガイド（理論部門向け）

このドキュメントは **理論部門のメンバー** が NOEMA の教材（ノートブック・確認問題）を
執筆・レビューするための手引きです。Git や AWS の知識は **不要** です。

開発部門の作業ルール（ブランチ運用・CI・インフラ）は `AGENTS.md` と `docs/` を参照してください。
このガイドはそれらに立ち入りません。

---

## 0. メンバーと役割

| 名前 | 役割 | 主な責任 |
|---|---|---|
| **田口**（OIF代表） | 全体統括 | 方針決定・Phase 0 監査に参加・対外公開の最終確認 |
| **Mani**（開発部門リーダー） | 開発リーダー 兼 **窓口担当** | 理論部門の成果物を PR 化・CI 通過・プラットフォーム保証 |
| **ryo / rui**（理論部門） | 教材執筆 | `.ipynb` とブログで新規教材を作成・相互レビュー |

教材の形式は **2つ**: ① ノートブック（`.ipynb`）　② ブログ記事。

## 1. 役割の境界（だれが何のオーナーか）

| 領域 | パス | オーナー |
|---|---|---|
| 教材の中身・数式・演習 | `content/notebooks/` | **理論部門（ryo / rui）** |
| 確認問題・最終問題 | `content/assessments/` | **理論部門（ryo / rui）** |
| 章立て・順序・難易度 | `content/catalog.json`（教育的構造の部分） | **理論部門（ryo / rui）** |
| ブログ記事 | `content/blog/`（正本。§9 参照） | **理論部門（ryo / rui）** |
| プラットフォーム・CI・インフラ | `src/` `infra/` `scripts/` | 開発部門（Mani） |
| `catalog.json` の技術項目（`htmlPath`・`colabUrl` 等） | `content/catalog.json` | 開発部門（Mani） |

**原則: 理論部門は「中身の正しさと教えやすさ」に全責任を持つ。** 動く・配信される部分は開発部門が保証する。
両者の接点は `content/` というフォルダだけ。ここを契約面（インターフェース）として疎結合に保つ。

---

## 2. 貢献の流れ（Git を触らないルート）

理論メンバーは **Colab か Jupyter で書くだけ** でよい。Git 化は窓口担当が引き受ける。

```
1. 担当ノートを Colab で開く（catalog.json の colabUrl から開ける）
2. 中身を編集（執筆 or 監査・修正）
3. 「変更したノート（.ipynb）」と「変更点の要約」を窓口担当へ共有
4. 窓口担当が PR を作成 → CI（機械チェック）を通す
5. 別の理論メンバーが「理論レビュー観点」（§5）でレビュー
6. 承認後、窓口担当がマージ
```

- **窓口担当（Content Liaison）= Mani**。理論部門（ryo / rui）の成果物を PR 化し、CI を通す橋渡し役。
- 慣れてきたメンバーは GitHub の Web UI から直接 `content/` を編集してもよい（git CLI 不要）。

---

## 3. ノートブックの標準構成

1ノート = 1トピック。読者は **初心者**（Python 入門〜）を想定。原則この順で組み立てる：

1. **導入** — 何を・なぜ学ぶか（markdown）
2. **直感** — 数式の前に、言葉と例で「気持ち」を掴ませる（markdown）
3. **理論** — 定義・数式（markdown、§4 の数式ルール）
4. **実装** — 最小の動くコード（code セル）。`import` は最初の code セルにまとめる
5. **演習 / 確認** — 手を動かす小問。詳しい採点は `content/assessments/` の確認問題で行う

技術的制約:
- フォーマットは `nbformat 4`。出力（実行結果）は基本コミットしない（CI が再実行する）。
- code セルは **上から順に単独で実行して通る** こと（CI の `check:notebook-isolated-run` が検証）。
- 危険な操作（ネットワーク・ファイル破壊等）は禁止（`check:python-runtime-safety` が検証）。

---

## 4. 数式ルール

- インライン: `$...$`
- ディスプレイ: `$$...$$`
- `\(...\)` `\[...\]` も動くが、手書き編集では **ドル記号を優先**。
- **確認問題（JSON）の中で数式を使うときも `$...$`**（既存の問題文・選択肢がこの形式）。

---

## 5. 理論レビュー観点チェックリスト

レビュアー（執筆者とは別の理論メンバー）は最低この5点を確認する。1つでも欠けたら差し戻し。

- [ ] **正しさ** — 定義・数式・主張に誤りがないか。記号の定義漏れがないか。
- [ ] **難易度順序** — 前提知識が登場前に説明済みか。章全体の中で順序が妥当か（`catalog.json` の `order`）。
- [ ] **直感→形式の橋渡し** — 数式の前に言葉・例での説明があるか。初心者が置いていかれないか。
- [ ] **演習の妥当性** — 確認問題が本文の学習目標（`learningObjective`）と対応しているか。誤答選択肢が「もっともらしいが誤り」になっているか。
- [ ] **コードと本文の一致** — 本文の説明とコードの挙動がズレていないか。

---

## 6. 確認問題（notebook-check）の書き方

ノート1本につき `content/assessments/notebook-checks/<notebookId>.json`。**4択・誤り選択方式**。

```json
{
  "schemaVersion": 1,
  "notebookId": "numpy-basics",
  "title": "NumPyの使い方 確認問題",
  "passScore": 5,
  "questions": [
    {
      "id": "q1",
      "prompt": "～について、間違っているものを1つ選んでください。",
      "choices": [
        { "id": "a", "text": "正しい記述" },
        { "id": "b", "text": "正しい記述" },
        { "id": "c", "text": "正しい記述（数式は $...$ で）" },
        { "id": "d", "text": "誤った記述（これが答え）" }
      ],
      "correctChoiceId": "d",
      "explanation": "なぜ d が誤りか、何を理解すべきかを1〜2文で。",
      "learningObjective": "shapeとdtype"
    }
  ]
}
```

- `passScore`: 合格に必要な正答数（既存は5問中5）。
- `learningObjective`: §5 のレビューで本文との対応を確認する単位。

---

## 7. 最終問題（chapter-final）の書き方

章1つにつき `content/assessments/chapter-finals/<chapterId>.json`。**記述・コーディングのルーブリック採点**。

```json
{
  "schemaVersion": 1,
  "chapterId": "python",
  "title": "Python 最終問題",
  "passRatio": 0.9,
  "questions": [
    {
      "id": "q1",
      "type": "short_text",
      "prompt": "～を説明してください。",
      "maxPoints": 10,
      "rubricPoints": [
        { "id": "variables", "description": "観点の説明", "points": 2, "keywords": ["変数", "再利用"] }
      ]
    },
    {
      "id": "q2",
      "type": "coding",
      "prompt": "関数 $summarize_scores(scores)$ を書いてください。",
      "maxPoints": 10,
      "rubricPoints": [
        { "id": "definition", "description": "引数を持つ関数として定義", "points": 2, "keywords": ["def", "summarize_scores"] }
      ]
    }
  ]
}
```

- `type`: `short_text`（記述）または `coding`（コード記述）。
- `passRatio`: 合格に必要な得点率（既存は 0.9）。
- `rubricPoints`: 各観点の `points` 合計が `maxPoints` と一致すること。`keywords` は自動採点のヒント。
- 変更後は CI の `check:assessment-integrity` が JSON 整合性を検証する。

---

## 8. 進め方の2フェーズ

### Phase 0: 既存教材の監査（いま・全員）

既存の58本は Mani が1人で執筆しており、**ドメイン専門家のレビューを未通過**。
理論部門が新規教材を作り始める前に、**田口・ryo・rui の全員で既存ノートを章単位で監査**する。
目的は3つ — ①品質の底上げ、②プラットフォームと教材の型を全員が把握、③§5 のレビュー基準を実地で固める。

監査の優先順位:

1. `python/` `machine-learning/`（入門章。学習者が最初に触れる＝影響大）
2. `deep-learning/` `llm/`
3. `reinforcement-learning/`（現状ノートが薄い＝加筆余地大）`deep-generative-models/` `world-models/`

各ノートは §5 のチェックリストで監査し、修正点を Mani 経由で PR 化する。

### Phase 1: 新規教材の作成（理論部門）

監査で型が固まったら、ryo / rui が **`.ipynb` とブログ**で新規教材を作る。
- ノートブック: §3 の構成・§4 の数式ルール・§6/§7 の確認問題とセットで作成。
- ブログ: `content/blog/` に Markdown で執筆（§9）。
- どちらも執筆者とは別の理論メンバーが §5 でレビューしてから Mani が公開。

---

## 9. ブログ運用

**原則: 正本は1つ、残りは配信先。** 同じ記事を複数箇所で別々に手管理しない。

```
正本（Single Source of Truth）
└─ content/blog/*.md   ← 理論部門はここに .md を書くだけ（.ipynb と同じ窓口フロー、PR化は Mani）
        ├─ 配信① Noema サイト /blog で描画         … SEO一体・自前ホスト
        ├─ 配信② Zenn に GitHub連携でクロスポスト  … 集客（canonical = Noema URL）
        └─ 導線  OIF公式サイトから /blog へリンク   … ブランド発信
```

### 執筆フォーマット
- 1記事 = `content/blog/<slug>.md`。冒頭に frontmatter（`title` / `date` / `author` / `tags` / `summary`）。
- 数式は §4 のドル記号ルールに従う。
- 図・コードは Markdown 標準。重い実装解説はノートブック側に寄せ、ブログは読み物・補足に使う。

### 公開フロー
1. ryo / rui が `content/blog/` に `.md` を書く
2. 別の理論メンバーが §5 の観点でレビュー
3. Mani が PR 化 → CI → マージ
4. 配信（Zenn クロスポスト等）は仕組みが流す。手で複製しない。

### 段階導入（開発をブロッカーにしない順序）
1. **今すぐ**: `content/blog/*.md` に執筆開始 ＋ Zenn にクロスポストして即配信（工数ほぼ0）
2. **中期**: Mani が Noema `/blog` 描画を実装。正本を自前配信し、Zenn は canonical 付きに（工数中）
3. **その後**: OIF公式サイトから新着記事へ導線（工数小）

---

> このガイドは草案。Phase 0 の監査運用が固まったら更新する。
