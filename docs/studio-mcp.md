# Studio MCP接続・運用ガイド

Noema Studio MCPを使うと、MCP対応クライアントからNoemaの記事を検索し、下書きの検証・プレビュー・保存・レビュー承認まで行えます。公開、記事の公開終了・復元、メンバー管理など、外部公開やアクセス権に影響する操作はStudio画面で行います。

## はじめに確認すること

接続には、次の2つの許可が必要です。

1. **Cloudflare Accessの許可**: `mcp.noema-learn.uk`へ接続できる本人かを確認します。
2. **Noema Studioのメンバー登録**: その本人がNoemaで何を操作できるかを確認します。

Cloudflare Accessの認証に成功しただけでは、MCPは利用できません。招待を受けた人は、先にStudio画面で招待の受け入れと初回登録を完了してください。MCPから招待の受け入れやメンバー登録はできません。

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

`capabilities`には、編集、承認、公開、メンバー管理が可能かどうかが表示されます。MCPでは権限に応じて下書き編集、画像管理、レビュー依頼・修正依頼・承認まで行えます。公開、記事の公開終了・復元、画像の完全削除、メンバー管理はStudio画面で行います。

## MCPでできること

| ツール | データ変更 | 用途 |
| --- | --- | --- |
| `studio_whoami` | なし | 現在のメールアドレス、役割、権限を確認する |
| `studio_list_articles` | なし | 記事を検索し、状態で絞り込む |
| `studio_get_article` | なし | 記事IDから現在の本文と版情報を取得する |
| `studio_list_assets` | なし | 画像を検索し、記事挿入用URLと利用状況を確認する |
| `studio_validate_draft` | なし | 保存前の見出し情報とMarkdownを検証する |
| `studio_preview_draft` | なし | 保存せず、公開サイトと同じレンダラーで本文HTMLと検証結果を返す |
| `studio_create_draft` | 下書きを作成 | 記事と最初の版を作成する |
| `studio_update_draft` | 下書きを更新 | 競合を確認して新しい版を追加する |
| `studio_upload_asset` | 画像を追加 | R2へ画像を保存し、記事挿入用Markdownを返す |
| `studio_update_asset` | 画像情報を更新 | 競合を確認してactiveな画像のaltと管理用タグを更新する |
| `studio_archive_asset` | 画像をアーカイブ | 未使用のactive画像を競合検知付きで一覧から退避する |
| `studio_restore_asset` | 画像を復元 | アーカイブ済み画像を競合検知付きでactiveへ戻す |
| `studio_request_review` | レビュー状態を変更 | 原稿を検証してレビュー中へ進める |
| `studio_request_changes` | レビュー状態を変更 | レビュー担当が具体的な指摘を記録して要修正へ戻す |
| `studio_approve_article` | レビュー状態を変更 | レビュー担当が理由を記録して最新版を承認する。公開はしない |

MCPでは、公開、記事の保管・復元・削除、画像の完全削除、メンバー管理はできません。これらは、状態と影響を確認できるStudio画面で行います。承認しても記事は公開されず、`publicationStatus`は変わりません。

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

`studio_preview_draft`へ`studio_validate_draft`と同じ入力を渡すと、保存せずに`html`、`mediaType: "text/html"`、検証結果の`issues`と`valid`を返します。公開サイトと同じMarkdown、コードハイライト、KaTeXレンダラーを使います。Markdownのraw HTMLは実行されず、危険なリンクはリンク化されません。

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

MCP経由の記事作成・更新、画像アップロード・情報更新、レビュー依頼、修正依頼はD1監査イベントへ`channel: mcp`、ツール名、request ID、最大200文字のクライアント識別子を記録します。画像アップロード監査にはAsset ID、形式、容量、元ファイル名も記録します。Access token、記事本文、画像Base64は監査metadataへ保存しません。

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

`develop`へのmerge後は、ActionsでD1 migration `0004_cms_mcp_asset_idempotency.sql`が成功してからStudio MCP Workerがdeployされたことを確認します。その後、Access認証、`studio_whoami`、記事・Asset一覧、検証、テスト用下書きの作成、画像アップロード、同一request IDでの再送、本文への画像挿入、更新、レビュー依頼、修正依頼を順に確認します。画像の削除・アーカイブ、公開・承認ツールが一覧に存在しないことも受入条件です。
