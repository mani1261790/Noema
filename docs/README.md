# Noema Docs

このディレクトリは、Noema の実装・運用・データ仕様を管理するためのドキュメントです。

## 最初に読む

1. [system-architecture.md](./system-architecture.md)
2. [openapi.yaml](./openapi.yaml)
3. [operations/dev-loop.md](./operations/dev-loop.md)

## 実装リファレンス

- [system-architecture.md](./system-architecture.md): 現行の構成（Next.js ルート / static app / AWS）
- [openapi.yaml](./openapi.yaml): Next.js の公開 API（`/api/catalog`, `/api/notebooks/*`）
- [data-model.md](./data-model.md): MVP 時点のデータモデル
- [data-model-v2.md](./data-model-v2.md): データモデル再設計メモ
- [content-sources.md](./content-sources.md): 教材ソースとライセンス管理ルール

## 運用

- [operations/aws-setup.md](./operations/aws-setup.md): AWS 初期セットアップとデプロイ
- [operations/runbook.md](./operations/runbook.md): 障害対応・日次運用
- [operations/dev-loop.md](./operations/dev-loop.md): 実装からレビューまでの開発ループ

## 計画・履歴

- [mvp-roadmap.md](./mvp-roadmap.md): 初期ロードマップ

## 注意点

- `openapi.yaml` は Next.js 側（`src/app/api`）の契約を定義します。
- インフラ側 Lambda API（`infra/lambda/api.ts`）の契約は、このリポジトリでは OpenAPI 化されていません。
