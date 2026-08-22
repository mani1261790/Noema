# Noema記事Markdown拡張

Noemaの記事本文はMarkdownで記述します。raw HTMLは使用せず、通常のMarkdownで表せない記事内UIだけを、Noema固有の限定的な記法として提供します。

公開ブログ、Studioのライブプレビュー、Studio MCPのプレビューは、同じ記事レンダラーを使用します。この文書の記法は、どの経路で記事を作成しても同じ表示になります。

## アコーディオン

長い補足や、必要な読者だけが確認すればよい内容を折りたたむときに使います。

```md
:::accordion 環境変数について

ここには通常のMarkdownを書けます。

- 箇条書き
- [参考リンク](https://example.com)
- インラインコード `EXAMPLE_VALUE`

:::
```

先頭の`:::accordion`と同じ行に、読者が内容を予測できるタイトルを指定します。本文の後は、単独行の`:::`で閉じます。表示にはブラウザ標準の`details`と`summary`を使うため、マウス、タッチ、キーボードのいずれでも開閉できます。

### 使用する場面

- 本筋を止めずに残したい詳しい補足
- OSやツールごとに分かれる追加手順
- 初読では不要だが、トラブル時に役立つ説明

通常の本文として読んでほしい重要事項、結論、警告は折りたたまないでください。

### 制約

- タイトルは必須です。
- アコーディオンの入れ子は使用できません。
- raw HTMLの`<details>`や`<summary>`は使用できません。
- 開始したアコーディオンは、単独行の`:::`で必ず閉じます。
- 記法の中でもH1見出し、危険なURL、altのない画像など、通常の記事Markdownと同じ検証規則が適用されます。

## Studio MCPから使う

Studio MCPはserver instructionsと、`studio_validate_draft`、`studio_preview_draft`、`studio_create_draft`、`studio_update_draft`のtool schemaに、この独自記法の説明を含めています。AIクライアントはtool一覧を取得した時点で記法と制約を把握できます。

MCPで記事を作成・更新するときも、先に`studio_validate_draft`で構文を検証し、`studio_preview_draft`で生成HTMLを確認してから保存してください。
