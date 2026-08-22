# Studio MCP接続・運用ガイド

Noema Studio MCPを使うと、MCP対応クライアントから記事、シリーズ、画像、レビュー、メンバーをStudioと同じCMS権限で管理できます。公開、公開終了、再公開など、読者に見える公開状態を変える操作だけはStudio画面で行います。

## はじめに確認すること

接続には、次の2つの許可が必要です。

1. **Cloudflare Accessの許可**: `mcp.noema-learn.uk`へ接続できる本人かを確認します。
2. **Noema Studioのメンバー登録**: その本人がNoemaで何を操作できるかを確認します。

Cloudflare Accessの認証に成功しただけでは、MCPは利用できません。招待を受けた人は、先にStudio画面で招待の受け入れと初回登録を完了してください。MCPの管理者ツールはメンバーの招待・役割・有効状態を設定できますが、本人に代わってAccess認証や初回登録を完了することはできません。

## 5分で接続する

### Codexで接続する（動作確認済み）

Noemaリポジトリには、接続先とOAuth scopeを`.codex/config.toml`で設定済みです。Codexアプリ、CLI、IDE拡張はこの設定を共有します。

1. CodexでNoemaリポジトリを開き、workspaceを信頼します。
2. 初めて設定を読み込むときは、CodexアプリまたはIDE拡張を再起動します。
3. MCP server一覧の`noema-studio`で「Authenticate」を実行します。CLIでは次のコマンドを実行します。

   ```bash
   codex mcp login noema-studio
   ```

4. CLIを使う場合は、表示された認可URLに`scope=openid`と`resource=https%3A%2F%2Fmcp.noema-learn.uk%2Fmcp`が含まれることを確認します。含まれない場合はブラウザを開かず、後述のエラー対応を行います。
5. ブラウザでCloudflare Accessの認証とOAuthの許可を完了します。
6. 新しいCodexタスクで`studio_whoami`を実行し、メールアドレスと役割を確認します。

`.codex/config.toml`の`scopes = ["openid"]`は削除しないでください。Cloudflare Managed OAuthはscopeのない許可要求を`Consent request is malformed`として拒否するため、Codexが常に正しい要求を送るために必要です。書き込みツールでは確認を表示し、読み取りツールはそのまま使えるよう`default_tools_approval_mode = "writes"`も設定しています。

この手順はCodex CLI `0.147.0`で、Dynamic Client Registration後の認可URLへ`scope=openid`と正しい`resource`が渡ることを確認しています。Codexのバージョンを変更した場合は`codex --version`を記録し、認可URLを同じように再確認します。

リポジトリ外でグローバル設定だけを使う場合は、初回認証と再認証で次のコマンドを使います。

```bash
codex mcp login noema-studio --scopes openid
```

### 1. 接続先を登録する

Streamable HTTPとOAuthに対応するMCPクライアントへ、次のURLを登録します。

```text
https://mcp.noema-learn.uk/mcp
```

クライアントによって項目名は「MCP server」「Remote MCP」「Connector」など異なります。接続方式を選べる場合は、`Streamable HTTP`を選択してください。認証情報を手入力する必要はありません。

Codexでは前項のプロジェクト設定を使い、ここで接続先を手動登録する必要はありません。ほかの製品は、Streamable HTTPとOAuthに加え、RFC 8707の`resource`、Dynamic Client Registration、製品が使うredirect URIをCloudflare側で許可できることを実機確認してから、この文書へ利用可能として追記します。

### 2. ブラウザで認証する

初回接続時にブラウザが開きます。

1. Cloudflare Accessの画面で、Studioに登録したメールアドレスを使って認証します。
2. メールのワンタイムコードなど、画面に表示された方法で本人確認を完了します。
3. OAuthの許可画面が表示されたら、接続先がNoema Studio MCPであることを確認して許可します。
4. MCPクライアントへ戻り、接続済みになったことを確認します。

認証メールだけが届き、画面が開いていない場合は、MCPクライアントの接続または再認証をもう一度実行してください。古いメールのコードではなく、その操作で届いた最新のコードを使います。

### 3. 自分の権限を確認する

接続後、最初に`studio_whoami`を実行します。返されたメールアドレスと役割が想定どおりであることを確認してください。

- `admin`: 管理者
- `editor`: 編集者
- `reviewer`: レビュー担当

`capabilities`には、編集、承認、公開、メンバー管理が可能かどうかが表示されます。MCPでは権限に応じて記事とシリーズの編集・履歴復元、画像管理、レビュー、メンバー管理を行えます。`canPublish`がtrueでも、公開状態を変更するMCPツールは提供しません。

## MCPでできること

| ツール | データ変更 | 用途 |
| --- | --- | --- |
| `studio_whoami` | なし | 現在のメールアドレス、役割、権限を確認する |
| `studio_list_articles` | なし | 記事を検索し、状態で絞り込む |
| `studio_get_article` | なし | 記事IDから現在の本文と版情報を取得する |
| `studio_list_article_versions` | なし | 記事の保存履歴と各版の状態を新しい順に取得する |
| `studio_get_article_version` | なし | 指定した過去版の本文、記事情報、公開範囲を取得する |
| `studio_list_article_version_checkpoints` | なし | 同じ編集セッションにまとまった自動保存checkpointを取得する |
| `studio_list_series` | なし | シリーズを検索し、現在の記事順と状態を取得する |
| `studio_get_series` | なし | シリーズIDから現在の内容と`lockVersion`を取得する |
| `studio_list_series_versions` | なし | シリーズのタイトル、説明、記事順の履歴を取得する |
| `studio_list_assets` | なし | 画像を検索し、記事挿入用URLと利用状況を確認する |
| `studio_list_review_comments` | なし | 記事のレビューコメントを取得する |
| `studio_list_members` | なし | 管理者がCMSメンバーと招待状態を取得する |
| `studio_validate_draft` | なし | 保存前の見出し情報とMarkdownを検証する |
| `studio_preview_draft` | なし | 保存せず、公開サイト・Studioと同じレンダラーで記事HTMLと検証結果を返す |
| `studio_create_draft` | 下書きを作成 | 記事と最初の版を作成する |
| `studio_update_draft` | 下書きを更新 | 競合を確認して新しい版を追加する |
| `studio_restore_article_version` | 下書きを更新 | 過去版を新しい版として競合検知・監査記録付きで復元する |
| `studio_create_series` | シリーズを作成 | 記事を指定順でまとめたシリーズを作成する |
| `studio_update_series` | シリーズを更新 | 競合検知付きでシリーズ情報と記事順を変更する |
| `studio_restore_series_version` | シリーズを更新 | 過去のシリーズ内容と記事順を新しい版として復元する |
| `studio_upload_asset` | 画像を追加 | R2へ画像を保存し、記事挿入用Markdownを返す |
| `studio_update_asset` | 画像情報を更新 | 競合を確認してactiveな画像のaltと管理用タグを更新する |
| `studio_archive_asset` | 画像をアーカイブ | 未使用のactive画像を競合検知付きで一覧から退避する |
| `studio_restore_asset` | 画像を復元 | アーカイブ済み画像を競合検知付きでactiveへ戻す |
| `studio_delete_asset` | 画像を完全削除 | 未使用画像をCMSとR2から削除する。取り消し不可 |
| `studio_request_review` | レビュー状態を変更 | 原稿を検証してレビュー中へ進める |
| `studio_withdraw_review` | レビュー状態を変更 | レビュー依頼を取り下げて下書きへ戻す |
| `studio_request_changes` | レビュー状態を変更 | レビュー担当が具体的な指摘を記録して要修正へ戻す |
| `studio_approve_article` | レビュー状態を変更 | レビュー担当が理由を記録して最新版を承認する。公開はしない |
| `studio_revoke_approval` | レビュー状態を変更 | 承認を取り消してレビュー中へ戻す |
| `studio_create_review_comment` | コメントを追加 | 現在のrevisionへレビューコメントを追加する |
| `studio_upsert_member` | メンバーを更新 | 管理者が招待、役割、有効状態を設定する |

MCPでは、記事の公開、公開終了、再公開はできません。過去版の復元、シリーズ編集、レビュー操作は公開状態を変更しません。承認しても記事は公開されず、`publicationStatus`は変わりません。画像の完全削除とメンバー無効化は影響が大きいため、ツールの説明と確認画面で対象を必ず確認してください。

## 下書きを作成・更新する

### 用語

- `frontmatter`: タイトル、説明、著者、タグなどの記事情報
- `markdown`: 記事本文
- `articleId`: 記事を識別するUUID
- `lockVersion`: 現在の版番号。記事取得時に返される
- `expectedVersion`: 更新対象として想定する版番号。取得した`lockVersion`を指定する
- `requestId`: 作成・更新を一度だけ実行するため、クライアント側で操作ごとに生成するUUID

### 新しい下書きの例

まず`studio_validate_draft`で内容を検証し、問題がなければ同じ記事内容を`studio_create_draft`へ渡します。

```json
{
  "requestId": "00000000-0000-4000-8000-000000000001",
  "frontmatter": {
    "title": "MCPから作る下書き",
    "description": "Studio MCPの接続確認に使う下書きです。",
    "slug": "mcp-first-draft",
    "status": "draft",
    "updatedAt": "2026-08-19",
    "authors": ["Noema編集部"],
    "topics": ["development-environment"],
    "tags": ["MCP"],
    "approach": "development",
    "outcome": "MCPから安全に下書きを保存できる",
    "prerequisites": [],
    "estimatedMinutes": 10,
    "heroImage": null,
    "sources": []
  },
  "markdown": "## はじめに\n\nここに記事本文を書きます。",
  "visibility": "internal"
}
```

`studio_validate_draft`では`requestId`を除いてください。この検証はD1を変更しません。

### 保存前に表示を確認する

`studio_preview_draft`へ`studio_validate_draft`と同じ入力を渡すと、保存せずに`html`、`mediaType: "text/html"`、検証結果の`issues`と`valid`を返します。公開サイトとStudioが共有する記事レンダラーを使い、記事ヘッダー、目次、本文、参考資料まで含むHTMLを生成します。Markdownのraw HTMLは実行されず、危険なリンクはリンク化されません。

記事内アコーディオンなど、Noema固有の記法は[Noema記事Markdown拡張](./article-markdown.md)を参照してください。MCP server instructionsと記事作成・更新toolのschemaにも同じ記法を含めているため、AIクライアントはtool一覧から書式と制約を取得できます。

プレビュー入力のMarkdownは65,536文字、生成HTMLは2,097,152文字までです。上限を超える場合は、原稿を分割して確認してください。これは本文のレンダリング確認であり、ブラウザ幅、CSS、フォントを含む最終的な見た目の確認はStudio画面で行います。

### 既存の下書きを更新する例

1. `studio_get_article`へ`articleId`を渡し、最新版を取得します。
2. 応答の`lockVersion`を更新入力の`expectedVersion`へ指定します。
3. 新しい`requestId`を生成し、`studio_update_draft`を実行します。

```json
{
  "articleId": "11111111-1111-4111-8111-111111111111",
  "expectedVersion": 1,
  "requestId": "00000000-0000-4000-8000-000000000002",
  "frontmatter": {
    "title": "MCPから更新した下書き",
    "description": "Studio MCPで更新した下書きです。",
    "slug": "mcp-first-draft",
    "status": "draft",
    "updatedAt": "2026-08-19",
    "authors": ["Noema編集部"],
    "topics": ["development-environment"],
    "tags": ["MCP"],
    "approach": "development",
    "outcome": "MCPから安全に下書きを更新できる",
    "prerequisites": [],
    "estimatedMinutes": 10,
    "heroImage": null,
    "sources": []
  },
  "markdown": "## 更新内容\n\n本文を更新しました。",
  "visibility": "internal"
}
```

作成・更新が通信途中で失敗し、処理結果が分からない場合に限り、同じ入力と同じ`requestId`で再送します。同じ利用者、ツール、`requestId`、入力の再送は同じ処理として扱われ、版は重複しません。新しい操作では必ず新しい`requestId`を使ってください。

## 版履歴を確認・復元する

履歴の確認は`reviewer`、`editor`、`admin`が行えます。復元は記事を更新するため、`editor`または`admin`の権限が必要です。

1. `studio_list_article_versions`へ`articleId`を渡し、復元候補を新しい順に取得します。
2. 候補の`revisionId`を`studio_get_article_version`へ渡し、本文、frontmatter、公開範囲を確認します。
3. 自動保存の途中経過も確認する場合は、候補の`versionId`を`studio_list_article_version_checkpoints`へ渡します。続きがあるときは、応答の`nextBeforeRevisionNumber`を次の呼び出しの`beforeRevisionNumber`へ指定します。
4. `studio_get_article`で現在の`lockVersion`を取得します。
5. 新しい`requestId`を生成し、`studio_restore_article_version`を実行します。

```json
{
  "articleId": "11111111-1111-4111-8111-111111111111",
  "revisionId": "22222222-2222-4222-8222-222222222222",
  "expectedVersion": 7,
  "requestId": "00000000-0000-4000-8000-000000000003"
}
```

復元は指定した過去版を直接上書きしたり、その後の履歴を削除したりしません。過去版の内容を現在の下書きへコピーし、`saveReason: "restored"`と復元元のrevision IDを記録した新しいimmutable revisionを追加します。公開中の記事がある場合、その公開版は固定されたままです。復元後の原稿は`draft`となり、レビュー承認は解除されるため、内容を確認してから改めてレビューへ進めてください。

別の編集が先に保存されて`lockVersion`が変わっていた場合は`revision_conflict`になります。現在の記事と復元候補をもう一度確認し、新しい`expectedVersion`と`requestId`で判断し直してください。通信途中で結果が分からない場合だけ、同じ入力と同じ`requestId`を再送できます。その再送では版を重複して追加しません。

## シリーズを作成・編集する

シリーズの`articleIds`は、そのまま読者へ示す記事順です。更新前に`studio_get_series`で現在の`lockVersion`を取得し、`studio_update_series`の`expectedVersion`へ指定します。同じ記事を複数シリーズへ入れたり、同一シリーズ内で重複させたりすることはできません。

```json
{
  "seriesId": "11111111-1111-4111-8111-111111111111",
  "expectedVersion": 2,
  "slug": "local-llm-with-ollama",
  "title": "Ollamaで始めるローカルLLM",
  "description": "ローカルLLMの導入から活用までを順に学ぶシリーズです。",
  "articleIds": [
    "22222222-2222-4222-8222-222222222222",
    "33333333-3333-4333-8333-333333333333"
  ]
}
```

過去の並びへ戻す場合は、`studio_list_series_versions`で対象の`versionId`を確認し、最新版の`lockVersion`とともに`studio_restore_series_version`へ渡します。復元は履歴を削除せず、新しいシリーズ版を追加します。シリーズ操作は記事の`publicationStatus`を変更しません。

## 画像をアップロードして本文へ挿入する

### 既存の画像を探す

`studio_list_assets`でファイル名、alt、管理用タグを検索できます。`status`を省略すると`active`だけを検索します。アーカイブ済みの画像を探す場合だけ、`status: "archived"`を明示します。応答の`markdownUrl`は記事本文で使う永続URLです。`previewUrl`はStudio画面での確認用URLなので、Markdownには使いません。

```json
{
  "query": "Cloudflare",
  "status": "active",
  "limit": 50
}
```

### 新しい画像を追加する

PNG、JPEG、WebP、GIFのいずれかを、`data:`接頭辞なしの正規Base64へ変換し、`studio_upload_asset`へ渡します。Data URLや非標準Base64は`invalid_asset`として拒否されます。画像は8MB以下、`alt`は必須です。`requestId`は画像1点のアップロードごとに新しいUUIDを使います。

```json
{
  "fileName": "worker-architecture.png",
  "contentType": "image/png",
  "dataBase64": "iVBORw0KGgo...",
  "alt": "Cloudflare WorkerとD1、R2の接続構成図",
  "tags": ["Cloudflare", "構成図"],
  "requestId": "00000000-0000-4000-8000-000000000005"
}
```

成功すると、Asset情報と次のような`markdown`が返ります。

```markdown
![Cloudflare WorkerとD1、R2の接続構成図](/media/articles/11111111-1111-4111-8111-111111111111.png)
```

通信結果が分からない場合だけ、同じ入力と同じ`requestId`で再送してください。D1のAsset台帳と監査イベントは重複しません。R2書き込み直後に処理が停止した場合は、台帳に登録されない孤立オブジェクトが残る可能性があります。別の画像や異なるaltで同じ`requestId`を使うと`idempotency_conflict`になります。

既存画像のaltや管理用タグを直す場合は、`studio_list_assets`が返した`id`と`updatedAt`を、`studio_update_asset`の`assetId`と`expectedUpdatedAt`へ指定します。新しい`requestId`も必要です。画像ファイル、URL、active／archived状態はこのツールでは変更されません。

```json
{
  "assetId": "11111111-1111-4111-8111-111111111111",
  "expectedUpdatedAt": "2026-08-19T05:30:00.000Z",
  "alt": "Cloudflare WorkerとD1、R2の接続構成図",
  "tags": ["Cloudflare", "構成図"],
  "requestId": "00000000-0000-4000-8000-000000000006"
}
```

### 画像をアーカイブ・復元する

使わなくなった画像は`studio_archive_asset`でアーカイブできます。R2の画像ファイルは削除されないため、必要になれば`studio_restore_asset`で復元できます。記事の本文またはヒーロー画像から参照されている画像は`asset_in_use`となり、アーカイブできません。

```json
{
  "assetId": "11111111-1111-4111-8111-111111111111",
  "expectedUpdatedAt": "2026-08-19T05:30:00.000Z",
  "requestId": "00000000-0000-4000-8000-000000000007"
}
```

アーカイブ結果の新しい`updatedAt`を、復元時の`expectedUpdatedAt`へ指定します。通信結果が分からない再送だけ同じ入力と同じ`requestId`を使います。別の状態変更では新しい`requestId`が必要です。

完全に不要な画像だけは`studio_delete_asset`でCMSとR2から削除できます。この操作は取り消せず、記事から参照されている画像は拒否されます。通常はアーカイブを使い、完全削除前に`studio_list_assets`でID、参照数、状態を再確認してください。

### 記事へ挿入する

1. `studio_get_article`で対象記事の最新版を取得します。
2. `studio_upload_asset`が返した`markdown`を、現在の本文の希望位置へ挿入します。
3. 取得した記事の`lockVersion`を`expectedVersion`へ指定し、新しい`requestId`で`studio_update_draft`を実行します。
4. 更新結果の版が1つ進んだことを確認します。

記事更新時にStudioが`/media/articles/...`を検出し、Assetの利用記事を自動記録します。他の編集者が先に保存していた場合は`revision_conflict`となるため、最新版へ画像を挿入し直してください。アップロードしただけで記事更新に失敗した画像はAsset一覧に残るので、同じ画像を再アップロードせず再利用します。

## レビューへ進める

### レビューを依頼する

`studio_request_review`へ、`studio_get_article`で確認した`articleId`と`lockVersion`、新しい`requestId`を渡します。必要であればレビュー担当への補足を`note`へ500文字以内で指定します。

```json
{
  "articleId": "11111111-1111-4111-8111-111111111111",
  "expectedVersion": 2,
  "requestId": "00000000-0000-4000-8000-000000000003",
  "note": "構成と技術内容のレビューをお願いします。"
}
```

下書きまたは要修正の記事だけをレビュー中へ進められます。保存内容がレビュー基準を満たさない場合は状態を変更せず、修正箇所を返します。

### 修正を依頼する

レビュー担当者は`studio_request_changes`で、レビュー中または承認済みの記事を要修正へ戻せます。AIが原稿を確認した場合でも、抽象的な判定だけを保存せず、著者が対応できる具体的な`note`を必ず指定します。

```json
{
  "articleId": "11111111-1111-4111-8111-111111111111",
  "expectedVersion": 3,
  "requestId": "00000000-0000-4000-8000-000000000004",
  "note": "結論の根拠となる一次情報の出典を追記してください。"
}
```

現在のレビュー状態と指摘は`studio_get_article`の`reviewStatus`と`reviewNote`で確認します。レビュー依頼、修正依頼、承認は、結果が分からない再送だけ同じ入力と同じ`requestId`を使います。公開を実行するMCPツールはありません。

記事単位のやり取りは`studio_create_review_comment`で追加し、`studio_list_review_comments`で確認します。コメント先は記事全体の`article`、本文の`body`、記事情報の`metadata`から選びます。編集者は`studio_withdraw_review`でレビュー依頼を取り下げられ、レビュー担当者または管理者は`studio_revoke_approval`で承認を取り消せます。いずれも公開状態は変更しません。

### レビューを承認する

レビュー担当者または管理者は、`studio_approve_article`でレビュー中の最新版を承認できます。`note`には、確認した内容を500文字以内で必ず記録します。レビュー担当者は自分が保存した最新版を自己承認できません。管理者には既存の緊急運用ルールが適用されます。

```json
{
  "articleId": "11111111-1111-4111-8111-111111111111",
  "expectedVersion": 4,
  "requestId": "00000000-0000-4000-8000-000000000008",
  "note": "構成、根拠となる一次情報、画像説明を確認しました。"
}
```

承認対象は`studio_get_article`で取得した`lockVersion`の最新版です。承認後も記事は未公開のままです。公開はStudio画面で、承認済みrevisionと公開範囲を人が確認して実行します。

## メンバーを管理する

`admin`だけが`studio_list_members`と`studio_upsert_member`を利用できます。`studio_upsert_member`はメールアドレス単位で招待、`admin`・`editor`・`reviewer`の役割、有効状態を設定します。最後の有効な管理者は無効化したり別の役割へ変更したりできません。

このツールはCMS側の許可を設定するもので、Cloudflare Accessの本人確認や招待された本人の初回登録を代行しません。対象メールアドレスと役割を確認してから実行してください。

## 困ったとき

| 表示 | 意味と対応 |
| --- | --- |
| `Consent request is malformed` | CodexのOAuth要求にscopeがありません。Noemaリポジトリであれば`.codex/config.toml`が読み込まれているか確認して再起動します。リポジトリ外では`codex mcp login noema-studio --scopes openid`を実行します。 |
| `401 unauthorized` | 認証情報がないか期限切れです。MCPクライアントから再認証します。 |
| `403 member_not_registered` | Studioで招待の受け入れ・初回登録が完了していない、メンバーが無効、または別のAccessアカウントに紐づいています。Studioへ同じメールアドレスでログインして登録状態を確認します。 |
| `revision_conflict` | 他の編集者が先に保存しています。最新版を取得し、変更を統合して、新しい`requestId`で更新します。 |
| `idempotency_conflict` | 同じ`requestId`が異なる入力で使われています。新しい操作なら新しいUUIDを使います。 |
| `invalid_asset` | 画像データとcontent typeが一致しない、altやタグが不正、または8MBを超えています。PNG、JPEG、WebP、GIFの元ファイルを確認します。 |
| `asset_conflict` | 他の編集者が先に画像情報を更新しています。`studio_list_assets`を再実行し、新しい`updatedAt`と新しい`requestId`で変更をやり直します。 |
| `asset_in_use` | 記事から参照されている画像です。本文とヒーロー画像の利用箇所を確認し、参照を外して保存してからアーカイブします。 |
| `series_conflict` | 他の編集者が先にシリーズを更新しています。`studio_get_series`で最新版と記事順を確認します。 |
| `series_article_conflict` | 記事が別のシリーズに含まれているか、同じシリーズ内で重複しています。シリーズ一覧を確認します。 |
| `last_admin_required` | 最後の有効な管理者を無効化または降格しようとしています。別の管理者を先に追加します。 |
| `invalid_transition` | 現在の記事または画像の状態では操作できません。`studio_get_article`または`studio_list_assets`で最新状態を確認します。 |
| `self_approval_forbidden` | レビュー担当者が自分で保存した最新版を承認しようとしています。別のレビュー担当者または管理者に確認を依頼します。 |
| `forbidden` | 現在のStudio役割に必要な権限がありません。修正依頼と承認にはレビュー担当または管理者の権限が必要です。 |
| `503 authentication_unavailable` | 認証基盤が一時的に利用できません。書き込み結果を推測せず、復旧後に同じ入力と同じ`requestId`で再送します。 |

認証できたか不明な場合は、接続状態だけで判断せず`studio_whoami`が成功することを確認してください。

## 管理者・開発者向け情報

### 接続先とデータの境界

- エンドポイント: `https://mcp.noema-learn.uk/mcp`
- 通信方式: Streamable HTTP
- 本人確認: Cloudflare Access Managed OAuth
- 操作権限: Studioと同じD1の`cms_members` role
- 記事データの正本: Studioと同じD1 `noema-cms`
- 画像データの正本: Studioと同じR2 `noema-article-assets`

MCP経由の記事作成・更新、画像アップロード・情報更新、レビュー状態変更はD1監査イベントへ`channel: mcp`、ツール名、request ID、最大200文字のクライアント識別子を記録します。シリーズ・コメント・メンバー操作もCMSと同じD1履歴または監査イベントへ記録されます。画像アップロード監査にはAsset ID、形式、容量、元ファイル名も記録します。Access token、記事本文、画像Base64は監査metadataへ保存しません。

### Cloudflare初期設定

直接MCPへ接続するために必要な設定は次のとおりです。

1. `mcp.noema-learn.uk`を保護するself-hosted Access applicationを作成する。
2. Studio利用者に対応するallow policyを設定する。
3. Access applicationのAdvanced settingsでManaged OAuthを有効にする。
4. 同じManaged OAuth設定でDynamic Client Registrationを有効にする。
5. Codexの`127.0.0.1` callbackを許可するため、Allow loopback clients（APIでは`dynamic_client_registration.allow_any_on_loopback`）を有効にする。
6. Access applicationのAUDをStudio MCP Workerの`MCP_ACCESS_POLICY_AUD`へ設定する。

Cloudflare Zero TrustのAI ControlsやMCP Portalへの登録は、複数のMCP serverを集約・制御する場合の任意設定です。Noema Studio MCPへ直接接続するための必須条件ではありません。

CodexはOAuth callbackに`127.0.0.1`のloopback addressと動的なportを使います。Dynamic Client RegistrationとAllow loopback clientsの両方が無効な場合、認証は完了しません。NoemaのCodex設定では、Cloudflareの許可要求が空にならないよう`openid` scopeも明示します。

Access applicationのAUDは秘密情報ではなく、WorkerがAccess JWTの対象を照合するための識別子です。初回deployより前に必要になるため、`ACCESS_TEAM_DOMAIN`と同様にレビュー可能な`wrangler.jsonc`の`vars`で管理します。MCP custom domainでは`workers.dev`とpreview URLを無効化しています。

MCPは既存の有効な`cms_members`だけを受け入れ、bootstrap adminの作成や招待の消費は行いません。Access applicationとManaged OAuth policyは、通常のコードdeployでは作り替えません。

Cloudflare API tokenには、既存のWorker/D1 deploy権限に加えて、このWorkerとcustom domainを更新できる権限が必要です。

### 検証

ローカルの確認コマンドは次のとおりです。

```bash
cd vnext
npm test --workspace @noema/studio-mcp
npm run check --workspace @noema/studio-mcp
npm run deploy:dry-run --workspace @noema/studio-mcp
```

`develop`へのmerge後は、ActionsのmigrationとStudio MCP Worker deployが成功したことを確認します。その後、Access認証、`studio_whoami`、記事・シリーズ・Asset一覧、検証、テスト用下書きとシリーズの作成・更新・履歴復元、レビューコメントと状態遷移を順に確認します。管理者ではメンバー一覧、未使用のテスト画像では削除も確認します。公開、公開終了、再公開のツールが一覧に存在しないことを受入条件にします。
