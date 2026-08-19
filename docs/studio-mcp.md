# Studio MCP接続・運用ガイド

Noema Studio MCPを使うと、MCP対応クライアントからNoemaの記事を検索し、下書きを検証・保存できます。公開、承認、メンバー管理など、影響の大きい操作はStudio画面で行います。

## はじめに確認すること

接続には、次の2つの許可が必要です。

1. **Cloudflare Accessの許可**: `mcp.noema-learn.uk`へ接続できる本人かを確認します。
2. **Noema Studioのメンバー登録**: その本人がNoemaで何を操作できるかを確認します。

Cloudflare Accessの認証に成功しただけでは、MCPは利用できません。招待を受けた人は、先にStudio画面で招待の受け入れと初回登録を完了してください。MCPから招待の受け入れやメンバー登録はできません。

## 5分で接続する

### 1. 接続先を登録する

Streamable HTTPとOAuthに対応するMCPクライアントへ、次のURLを登録します。

```text
https://mcp.noema-learn.uk/mcp
```

クライアントによって項目名は「MCP server」「Remote MCP」「Connector」など異なります。接続方式を選べる場合は、`Streamable HTTP`を選択してください。認証情報を手入力する必要はありません。

特定製品の画面操作は、実機で動作確認できた製品だけをこの文書へ追記します。未確認の製品でも、標準のStreamable HTTPとOAuthに対応していれば同じ接続先を利用できます。

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

`capabilities`には、編集、承認、公開、メンバー管理が可能かどうかが表示されます。ただし、MCPが公開するのは下書きの編集、レビュー依頼、修正依頼までです。最終承認と公開はStudio画面で行います。

## MCPでできること

| ツール | データ変更 | 用途 |
| --- | --- | --- |
| `studio_whoami` | なし | 現在のメールアドレス、役割、権限を確認する |
| `studio_list_articles` | なし | 記事を検索し、状態で絞り込む |
| `studio_get_article` | なし | 記事IDから現在の本文と版情報を取得する |
| `studio_validate_draft` | なし | 保存前の見出し情報とMarkdownを検証する |
| `studio_create_draft` | 下書きを作成 | 記事と最初の版を作成する |
| `studio_update_draft` | 下書きを更新 | 競合を確認して新しい版を追加する |
| `studio_request_review` | レビュー状態を変更 | 原稿を検証してレビュー中へ進める |
| `studio_request_changes` | レビュー状態を変更 | レビュー担当が具体的な指摘を記録して要修正へ戻す |

MCPでは、最終承認、公開、保管、復元、記事削除、メンバー管理はできません。これらは、状態と影響を確認できるStudio画面で行います。

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

現在のレビュー状態と指摘は`studio_get_article`の`reviewStatus`と`reviewNote`で確認します。レビュー依頼と修正依頼も、結果が分からない再送だけ同じ入力と同じ`requestId`を使います。最終承認と公開を依頼するMCPツールはありません。

## 困ったとき

| 表示 | 意味と対応 |
| --- | --- |
| `401 unauthorized` | 認証情報がないか期限切れです。MCPクライアントから再認証します。 |
| `403 member_not_registered` | Studioで招待の受け入れ・初回登録が完了していない、メンバーが無効、または別のAccessアカウントに紐づいています。Studioへ同じメールアドレスでログインして登録状態を確認します。 |
| `revision_conflict` | 他の編集者が先に保存しています。最新版を取得し、変更を統合して、新しい`requestId`で更新します。 |
| `idempotency_conflict` | 同じ`requestId`が異なる入力で使われています。新しい操作なら新しいUUIDを使います。 |
| `invalid_transition` | 現在の記事状態ではそのレビュー操作を実行できません。`studio_get_article`で最新状態を確認します。 |
| `forbidden` | 現在のStudio役割に必要な権限がありません。修正依頼にはレビュー担当または管理者の権限が必要です。 |
| `503 authentication_unavailable` | 認証基盤が一時的に利用できません。書き込み結果を推測せず、復旧後に同じ入力と同じ`requestId`で再送します。 |

認証できたか不明な場合は、接続状態だけで判断せず`studio_whoami`が成功することを確認してください。

## 管理者・開発者向け情報

### 接続先とデータの境界

- エンドポイント: `https://mcp.noema-learn.uk/mcp`
- 通信方式: Streamable HTTP
- 本人確認: Cloudflare Access Managed OAuth
- 操作権限: Studioと同じD1の`cms_members` role
- 記事データの正本: Studioと同じD1 `noema-cms`

MCP経由の作成、更新、レビュー依頼、修正依頼はD1監査イベントへ`channel: mcp`、ツール名、request ID、最大200文字のクライアント識別子を記録します。Access tokenや記事本文は監査metadataへ保存しません。

### Cloudflare初期設定

直接MCPへ接続するために必要な設定は次のとおりです。

1. `mcp.noema-learn.uk`を保護するself-hosted Access applicationを作成する。
2. Studio利用者に対応するallow policyを設定する。
3. Access applicationでManaged OAuthを有効にする。
4. Access applicationのAUDをStudio MCP Workerの`MCP_ACCESS_POLICY_AUD`へ設定する。

Cloudflare Zero TrustのAI ControlsやMCP Portalへの登録は、複数のMCP serverを集約・制御する場合の任意設定です。Noema Studio MCPへ直接接続するための必須条件ではありません。

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

`develop`へのmerge後は、ActionsでD1 migration `0003_cms_mcp_idempotency.sql`が成功してからStudio MCP Workerがdeployされたことを確認します。その後、Access認証、`studio_whoami`、一覧、検証、テスト用下書きの作成、同一request IDでの再送、更新、レビュー依頼、修正依頼を順に確認します。公開・承認ツールが一覧に存在しないことも受入条件です。
