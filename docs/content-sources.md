# コンテンツソース

Noema は `content/catalog.json` で 2 種類のコンテンツソースを扱います。

- `noema-original`
  - Noema が独自に制作した教材
- `open-license-translation`
  - 外部のオープンライセンス教材を Noema が翻訳・再構成して掲載する教材

## カタログ項目

ルートレベルの既定値:

```json
{
  "contentSourceDefaults": {
    "kind": "noema-original",
    "provider": "Noema",
    "license": "internal"
  }
}
```

章単位:

```json
{
  "id": "llm",
  "title": "LLM",
  "audience": "advanced",
  "order": 5,
  "notebooks": []
}
```

- `audience`
  - `beginner` または `advanced`
  - Sidebar では `Python` と `機械学習` を beginner に置き、発展的なテーマを別枠に分けます。

外部教材を翻訳して取り込む notebook の例:

```json
{
  "id": "nma-example",
  "title": "神経科学入門",
  "order": 1,
  "tags": ["neuromatch", "translation"],
  "htmlPath": "/notebooks/nma-example.html",
  "colabUrl": "https://example.com",
  "source": {
    "kind": "open-license-translation",
    "provider": "Neuromatch Academy",
    "license": "CC BY 4.0 / BSD-3-Clause (code)",
    "originalTitle": "Original Tutorial Title",
    "originalUrl": "https://github.com/NeuromatchAcademy/course-content",
    "translationLanguage": "日本語"
  }
}
```

## 表示ルール

- Sidebar:
  - `open-license-translation` の notebook には `翻訳教材` バッジを表示します。
- Notebook ページ:
  - 翻訳教材では、本文の上に出典表示バナーを出します。
- Noema 独自教材:
  - 出典表示バナーは出しません。

## 出典表示チェックリスト

外部のオープンライセンス notebook を取り込む場合は、次を含めます。

- 元の提供者名
- 元のタイトル
- 元の URL
- 元のライセンス
- Noema が翻訳または再構成したことの明記
- コンテンツとコードでライセンスが分かれている場合は、コード側ライセンスの注記

## 外部コースの扱い

外部コースはソース資料としてリポジトリに置けます。ただし、Noema の中核教材と同じく、初学者から実務レベルまで順に進める構成へ書き直すまでは公開カタログに出しません。

`https://github.com/NeuromatchAcademy/course-content` のようなオープンライセンス教材の場合:

- コンテンツライセンス: `CC BY 4.0`
- コードライセンス: `BSD-3-Clause`
- 推奨する `source.license` の値:
  - `CC BY 4.0 / BSD-3-Clause (code)`
