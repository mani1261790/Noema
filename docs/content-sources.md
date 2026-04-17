# Content Sources

Noema supports two content source modes in `content/catalog.json`.

- `noema-original`
  - Noema が独自に制作した教材
- `open-license-translation`
  - 外部のオープンライセンス教材を Noema が翻訳・再構成して掲載する教材

## Catalog Fields

Root-level defaults:

```json
{
  "contentSourceDefaults": {
    "kind": "noema-original",
    "provider": "Noema",
    "license": "internal"
  }
}
```

Per chapter:

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
  - `beginner` or `advanced`
  - Sidebar groups `Python` and `機械学習` under beginner, and advanced topics separately.

Per notebook for imported translations:

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

## Display Rules

- Sidebar:
  - `open-license-translation` notebooks show a `翻訳教材` badge.
- Notebook page:
  - Imported translations show an attribution banner above the article body.
- Original Noema notebooks:
  - No attribution banner is shown.

## Attribution Checklist

For each imported open-license notebook, include:

- Original provider name
- Original title
- Original URL
- Original license
- Indication that Noema translated and/or adapted the material
- Any code-specific license notes if the upstream repo separates content and code licenses

## Neuromatch Academy Example

For `https://github.com/NeuromatchAcademy/course-content`:

- Content license: `CC BY 4.0`
- Code license: `BSD-3-Clause`
- Recommended `source.license` value:
  - `CC BY 4.0 / BSD-3-Clause (code)`
