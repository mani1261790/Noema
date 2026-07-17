# Noemaドキュメント

現行Noemaのproduct仕様、開発環境、UI基準、デザイン出典を管理します。実装・運用と一致しなくなった説明は残さず、退役済みAWS版の資料は公開アーカイブへ分離します。

## 現行実装

1. [Studio・ブログ接続ガイド](./studio-blog-connectivity.md): 執筆からDraft PR、`develop`、ブログ反映までの流れ、URL、トラブル対応
2. [開発環境デプロイ](./development-deployment.md): `develop`限定deploy、確認URL、GitHub設定、rollback
3. [アプリケーションREADME](../vnext/README.md): workspace構成、local development、build
4. [プロダクト再設計仕様](./product-reboot.md): product、記事、Studio、記事アシスタント、Cloudflare構成
5. [コンテンツ・掲載方針](./content-strategy.md): 注目記事の大小、記事タイプ、テーマ、OIF表記方針

## UIとデザイン

- [Noema UIスタイルガイド](./noema-style-guide.md): デジタル庁デザインシステムをNoemaへ適用するrule
- [デザイン適合表](../vnext/DESIGN_CONFORMANCE.md): official componentと実装の対応、検証結果
- [デジタル庁デザインシステム固定リファレンス](./references/digital-agency-design-system/README.md): 実装時に参照した公式資料のversion固定copy

## 退役済みAWS版

旧notebook学習サービスのcode、教材、architecture、AWS CDK、復元手順、退役記録は [Noema AWS Archive](https://github.com/mani1261790/Noema-AWS-Archive) に保存しています。現行repoへ旧AWSの運用手順を戻しません。
