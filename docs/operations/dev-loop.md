# 開発ループ（コミット / レビュー / push）

実装単位ごとに、このループを使います。

## 1. 実装する

- ひとまとまりの変更だけを行う。
- すぐレビューできる範囲にスコープを保つ。

## 2. ローカルチェック

最低限、次を実行します。

```bash
npm run build:notebooks
npm run typecheck
npm run lint
npm run build
```

インフラを変更した場合:

```bash
cd infra
npm run build
npm run synth
```

## 3. コミット

```bash
git add .
git commit -m "<scope>: <summary>"
```

## 4. Codex レビューゲート

- Codex にはレビュー指摘だけを依頼する（バグ、リグレッション、セキュリティ、テスト不足）。
- high/major の指摘はすべて修正する。
- チェックを再実行する。

## 5. Push する

```bash
git push
```

## 6. 次のタスク選定

- 次に最も効果が大きいタスクを選ぶ。
- 手順 1 から繰り返す。

## 保守フェーズの目標

このループは、次を満たすまで継続します。

- `main` の CI が green。
- デプロイ手順が再現可能。
- インシデント runbook があり、オンコール手順が文書化されている。
- KPI 監視が見えていて、対応に使える。
