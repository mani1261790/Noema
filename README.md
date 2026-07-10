# Noema

Noemaは、技術的なテーマを非技術者にも分かる形で届けるMarkdown技術ブログです。公開ブログ、記事執筆Studio、記事本文を文脈に質問へ答えるLLMアシスタントをCloudflare Workers上で構築しています。

旧notebook学習サービスとAWS実装は退役し、[Noema AWS Archive](https://github.com/mani1261790/Noema-AWS-Archive)へ移しました。旧構成、CDK、教材、復元手順、退役時のresource記録はアーカイブを参照してください。

## 現在の公開状態

- 公開予定URL: `https://noema-learn.uk`
- 開発確認URL: `https://noema-learn.mani1261790.workers.dev`
- `noema-learn.uk/*` は公開承認まで `noema-public-gate` が404を返します
- StudioはMVPでは `workers.dev` URLのみです

## 構成

- `vnext/apps/blog`: Astroによるブログと記事アシスタントAPI
- `vnext/apps/studio`: React/ViteによるMarkdown執筆エディター
- `vnext/apps/public-gate`: 本番hostを非公開に保つWorker
- `vnext/packages/content`: 記事schema、Markdown出力、UI fixture
- `vnext/packages/ui`: 共通UIとデジタル庁デザインシステム準拠style
- `docs`: product仕様、UIガイド、固定した公式design reference

## ローカル開発

Node.js 22.18以上が必要です。CIはNode.js 24を使います。

```bash
cd vnext
npm ci
npm run dev:blog
```

Studioは別terminalで起動します。

```bash
cd vnext
npm run dev:studio
```

## 検証

```bash
cd vnext
npm run check
npm run build
npm run deploy:dry-run
```

`deploy:dry-run` はCloudflareへuploadせず、3つのWorker bundleを検証します。

## デプロイ

`.github/workflows/deploy-vnext.yml` が `main` の変更をCloudflareへデプロイします。公開ゲートを先にデプロイするため、ブログやStudioの更新中も `noema-learn.uk` は閉じたままです。

詳しい初期設定、手動デプロイ、rollbackは [vnext/README.md](vnext/README.md) を参照してください。

## ドキュメント

- [プロダクト再設計](docs/product-reboot.md)
- [Noema UIスタイルガイド](docs/noema-style-guide.md)
- [デジタル庁デザインシステム固定リファレンス](docs/references/digital-agency-design-system/README.md)
- [デザイン適合表](vnext/DESIGN_CONFORMANCE.md)
