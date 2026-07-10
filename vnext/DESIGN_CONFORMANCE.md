# DADS準拠メモ

現行Noemaはデジタル庁デザインシステム（DADS）の公式HTML実装とデザイントークンを基準にしています。デジタル庁サイトそのものの複製ではなく、Noema固有の情報設計にDADSの規則とコンポーネントを適用します。

## 参照元

- 公式リポジトリ: `digital-go-jp/design-system-example-components-html`
- 固定コミット: `3b34f4c3553fa3bee90bfd8b6fe962ac3055107d`
- 取得日: 2026-07-10
- ライセンス: MIT
- 公式CSSの配置: `packages/ui/src/styles/official`

出典の詳細は `packages/ui/SOURCE.md` に記録しています。公式CSSは機械的にコピーし、Noema固有の調整は `packages/ui/src/styles/noema.css` と各アプリのCSSへ分離しています。

## コンポーネント対応

| 画面要素 | DADS基準 | Noemaでの使用 |
| --- | --- | --- |
| ボタン | `button.css` | 記事検索、質問送信、Markdown書き出し |
| リンク | `link.css` | ナビゲーション、パンくず、記事内リンク |
| パンくず | `breadcrumb.css` | 記事の現在位置 |
| ラベル・入力 | `form-control-label.css`, `input-text.css`, `textarea.css` | 記事AI、Studioメタデータ |
| ハンバーガー | `hamburger-menu-button.css` | モバイルのグローバルナビゲーション |
| 目次 | `toc.css` | デスクトップ記事目次 |
| Disclosure | `disclosure.css` | モバイル記事目次 |
| 見出し・リスト | `heading.css`, `list.css` | 記事本文と固定ページ |
| フォーカス | `global.css` | 黄色背景と黒アウトラインのフォーカス表示 |
| カード | カードの使い方、角の形状 | 記事一覧に外周と角丸ミディアム（12px）を適用 |

## Noema固有の判断

- ブランド名と技術図解にはDADSのキーカラーである青を使用する。
- 公開ブログはカードを多用せず、記事一覧に限って外周付きの角丸カードを使用する。
- 本文は読みやすさを優先し、行長と段落間隔を制限する。
- 記事AIはデスクトップでは補助カラム、モバイルでは明示的な固定ボタンから開くモーダルにする。
- Studioは公開サイトと分離し、設定・Markdown・プレビューを同時に見比べられる編集専用レイアウトにする。

## 実装確認

- 1280×720: トップ、記事、Studioで横スクロールなし。
- 390×844: 記事とStudioで横スクロールなし。
- モバイルメニューの開閉と `aria-expanded` 更新を確認。
- モバイル目次はキーボードとタッチで開けるネイティブ `details` を使用。
- 記事AIモーダルは開閉時にフォーカスを移動し、Escで閉じられる。
- Studioの全入力に明示的なラベルを関連付け、プレビュー内のHTMLをサニタイズ。
- UI確認用fixtureとプレビューURLは公開コンテンツから分離し、検索対象外に設定。
