# Noemaドキュメント

現行Noemaのproduct仕様、開発環境、UI基準、デザイン出典を管理します。実装・運用と一致しなくなった説明は残さず、退役済みAWS版の資料は公開アーカイブへ分離します。

## 背景・意思決定

- [サービス方針の意思決定記録](./service-direction-decisions.md): 現在のNoemaへ再設計した目的、想定読者を2層で捉えた理由、その後変更した判断

## 目的別の入口

| したいこと | 最初に読む文書 |
| --- | --- |
| 記事を書く、レビューする、公開する | [Studio・CMS・ブログ接続ガイド](./studio-blog-connectivity.md#記事が反映されるまで) |
| Studioへメンバーを追加する | [メンバーを招待する](./studio-blog-connectivity.md#メンバーを招待する) |
| 公開範囲や公開後の修正方法を確認する | [Studio・CMS・ブログ接続ガイド](./studio-blog-connectivity.md#公開範囲) |
| codeやD1 schemaをCloudflareへ反映する | [開発環境デプロイ](./development-deployment.md#自動デプロイの流れ) |
| CMSのrole、状態遷移、API境界を実装する | [CMS contract](../vnext/packages/cms/README.md) |

## 編集・運用

- [Studio・CMS・ブログ接続ガイド](./studio-blog-connectivity.md): D1への保存、role、review、公開範囲、ブログ反映、メンバー管理、トラブル対応の運用上の正
- [コンテンツ・掲載方針](./content-strategy.md): 注目記事の大小、記事タイプ、テーマ、公開範囲、OIF表記方針

## 開発・デプロイ

- [開発環境デプロイ](./development-deployment.md): `develop`限定deploy、D1 migration、確認URL、GitHub設定、rollbackの運用上の正
- [アプリケーションREADME](../vnext/README.md): workspace構成、local D1 development、build
- [CMS contract](../vnext/packages/cms/README.md): role、状態遷移、公開範囲、revision、競合、API境界の実装上の正

## 仕様・デザイン

- [プロダクト再設計仕様](./product-reboot.md): product、D1 CMS、Studio、記事アシスタント、Cloudflare構成
- [Noema UIスタイルガイド](./noema-style-guide.md): デジタル庁デザインシステムをNoemaへ適用するrule
- [デザイン適合表](../vnext/DESIGN_CONFORMANCE.md): official componentと実装の対応、検証結果
- [デジタル庁デザインシステム固定リファレンス](./references/digital-agency-design-system/README.md): 実装時に参照した公式資料のversion固定copy

## 退役済みAWS版

旧notebook学習サービスのcode、教材、architecture、AWS CDK、復元手順、退役記録は [Noema AWS Archive](https://github.com/mani1261790/Noema-AWS-Archive) に保存しています。現行repoへ旧AWSの運用手順を戻しません。
