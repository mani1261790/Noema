# 評価コンテンツ

Noema の評価は章単位で作成します。

- `notebook-checks/{notebookId}.json`: notebook ごとの5問の多肢選択問題。合格には 5/5 が必要。
- `chapter-finals/{chapterId}.json`: 章ごとの約10問の最終課題。合格には 90% が必要。
- Notebook check では、すべての問題に `correctChoiceId` を含める。
- Chapter final は rubric ベースで、採点エージェントが設問ごとに採点する。
- ファイルが欠けている場合や形式が不正な場合は、すぐに失敗させる。汎用のプレースホルダー assessment へのフォールバックは使わない。
