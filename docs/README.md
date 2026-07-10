# Noema Docs

このディレクトリは、Noema の実装・運用・データ仕様を管理するためのドキュメントです。

## 最初に読む

1. [product-reboot.md](./product-reboot.md): notebook学習サービスからMarkdown技術ブログへ移行するvNext仕様
2. [noema-style-guide.md](./noema-style-guide.md): デジタル庁デザインシステムをNoemaへ適用するルール
3. [system-architecture.md](./system-architecture.md): 移行前の現行構成
4. [operations/dev-loop.md](./operations/dev-loop.md)

## vNext

- [product-reboot.md](./product-reboot.md): プロダクト、記事、エディター、記事アシスタント、Cloudflare移行
- [noema-style-guide.md](./noema-style-guide.md): UI原則、利用コンポーネント、アクセシビリティ受入条件
- [references/digital-agency-design-system](./references/digital-agency-design-system/README.md): 公式ガイドラインのバージョン固定コピー

vNextは実装前の目標仕様である。下記の既存文書は、移行が完了するまで現行サービスの説明として残す。

## 実装リファレンス

- [system-architecture.md](./system-architecture.md): 現行の構成（Next.js ルート / static app / AWS）
- [openapi.yaml](./openapi.yaml): Next.js の公開 API（`/api/catalog`, `/api/notebooks/*`）
- [data-model.md](./data-model.md): MVP 時点のデータモデル
- [data-model-v2.md](./data-model-v2.md): データモデル再設計メモ
- [content-sources.md](./content-sources.md): 教材ソースとライセンス管理ルール
- [glossary.md](./glossary.md): 用語チップス辞書の管理ルール

## 運用

- [operations/aws-setup.md](./operations/aws-setup.md): AWS 初期セットアップとデプロイ
- [operations/runbook.md](./operations/runbook.md): 障害対応・日次運用
- [operations/dev-loop.md](./operations/dev-loop.md): 実装からレビューまでの開発ループ

## 計画・履歴

- [mvp-roadmap.md](./mvp-roadmap.md): 初期ロードマップ

## 注意点

- `openapi.yaml` は Next.js 側（`src/app/api`）の契約を定義します。
- インフラ側 Lambda API（`infra/lambda/api.ts`）の契約は、このリポジトリでは OpenAPI 化されていません。
