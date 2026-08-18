# Studio MCP運用ガイド

Noema Studio MCPは、手元のMarkdownやMCP clientからD1 CMSの下書きを安全に読み書きするremote MCP serverです。

## 接続先と境界

- endpoint: `https://mcp.noema-learn.uk/mcp`
- transport: Streamable HTTP
- 認証: Cloudflare Access Managed OAuth
- 認可: Studioと同じD1 `cms_members` role
- 正本: Studioと同じD1 `noema-cms`

MCPは執筆の入口であり、公開ワークフローの自動化口ではありません。レビュー依頼、承認、修正依頼、公開、保管、復元、メンバー管理、記事削除はtoolとして公開しません。これらは状態と影響を人が確認できるStudio画面で行います。

## Tools

| tool | 変更 | 用途 |
| --- | --- | --- |
| `studio_whoami` | なし | Access identity、CMS role、capabilityの確認 |
| `studio_list_articles` | なし | 記事一覧の検索と状態filter |
| `studio_get_article` | なし | 記事IDからcurrent revisionを取得 |
| `studio_validate_draft` | なし | レビュー依頼基準でfrontmatterとMarkdownを検証 |
| `studio_create_draft` | draft作成 | immutable revision 1を作成 |
| `studio_update_draft` | draft更新 | `expectedVersion`を照合してimmutable revisionを追加 |

作成・更新にはclient生成のUUID `requestId`が必須です。同じidentity、tool、`requestId`、入力の再送は同じ処理として扱い、revisionを重複作成しません。同じkeyを異なる入力へ再利用すると`idempotency_conflict`になります。更新競合は`revision_conflict`で停止し、後勝ち上書きはしません。

MCP経由の作成・更新はD1監査eventへ`channel: mcp`、tool、request ID、最大200文字のclient識別子を記録します。Access tokenや記事本文は監査metadataへ保存しません。

## Cloudflare初期設定

初回deploy前に次を設定します。

1. Cloudflare Zero TrustのAI controlsでcustomer-managed MCP serverを追加し、server URLを`https://mcp.noema-learn.uk/mcp`にする。
2. `mcp.noema-learn.uk`を保護するAccess applicationと、Studio利用者に対応するallow policyを作る。
3. Managed OAuthを有効にする。
4. Access applicationのAUDをStudio MCP Workerのsecretへ設定する。

```bash
cd vnext/apps/studio-mcp
npx wrangler secret put MCP_ACCESS_POLICY_AUD --config wrangler.jsonc
```

AUDは`wrangler.jsonc`へ直書きせず、Worker secretとして管理します。`ACCESS_TEAM_DOMAIN`とbootstrap admin emailはreview可能なWorker設定です。MCP custom domainでは`workers.dev`とpreview URLを無効化しています。

Cloudflare API tokenには既存Worker/D1 deploy権限に加えて、このWorkerとcustom domainを更新できる権限が必要です。Access applicationとManaged OAuth policyは通常のcode deployでは作り替えません。

## Client接続

remote Streamable HTTPとOAuth discoveryに対応するMCP clientへendpointを追加します。初回接続時はCloudflare Accessの認証画面で、Studio利用者として許可されたidentityを選びます。Accessを通過してもD1のCMS memberが未招待または無効なら利用できません。

接続後は最初に`studio_whoami`を実行し、想定したemail、role、capabilityか確認してください。下書き更新前には`studio_get_article`の`lockVersion`を`expectedVersion`として使い、更新ごとに新しい`requestId`を生成します。通信結果が不明な再送だけは同じ`requestId`を使います。

## 検証

ローカルgateは次のとおりです。

```bash
cd vnext
npm test --workspace @noema/studio-mcp
npm run check --workspace @noema/studio-mcp
npm run deploy:dry-run --workspace @noema/studio-mcp
```

`develop`へのmerge後は、ActionsでD1 migration `0003_cms_mcp_idempotency.sql`が成功してからStudio MCP Workerがdeployされたことを確認します。その後、Access login、`studio_whoami`、一覧、検証、test draftの作成・同一request ID再送・更新を順に確認します。公開・承認toolが一覧に存在しないことも受入条件です。

## 障害時

- `401 unauthorized`: Access assertionがないか、署名・issuer・AUD・期限が不正。
- `403 member_not_registered`: Access identityがCMSへ未招待、無効、または別subjectへ登録済み。
- `revision_conflict`: 別の編集者が先に保存。最新版を取得し、内容を統合して新しいrequest IDで再実行。
- `idempotency_conflict`: 同じrequest IDを異なる入力へ再利用。意図した再送か確認し、新規操作なら新しいUUIDを使う。
- `503 authentication_unavailable`: Access JWKS取得など認証基盤が一時的に利用不可。書込み結果を推測せず、同じrequest IDで再送する。
