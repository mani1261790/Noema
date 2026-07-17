# Noemaアプリケーション

Markdown技術ブログとしての現行実装です。directory名の`vnext`は旧AWS版と並行開発していた時期の名残ですが、現在はこちらが唯一のNoema applicationです。

退役したNext.js/AWS版は [Noema AWS Archive](https://github.com/mani1261790/Noema-AWS-Archive) に保存しています。

## 必要環境

- Node.js 22.18以上
- npm
- Cloudflareへ手動deployする場合だけWrangler login

GitHub ActionsではNode.js 24とWrangler 4.110.0を使います。

## Workspace

- `apps/blog`: Astroで構築するブログと記事アシスタントAPI
- `apps/studio`: React/Viteで構築するMarkdown執筆Studio
- `apps/public-gate`: `noema-learn.uk`を非公開に保つWorker
- `packages/content`: 記事schema、Markdown出力、UI確認用fixture
- `packages/studio-publication`: Studio記事送信の固定contract、GitHub操作計画、再試行判定
- `packages/ui`: Noema共通styleとデジタル庁公式snippet由来CSS
- `design/concepts`: 実装照合用の画面concept
- `design/qa`: browser確認時のcapture

## ローカル開発

```bash
cd vnext
npm ci
npm run dev:blog
```

別terminalでStudioを起動します。

```bash
cd vnext
npm run dev:studio
```

- ブログ: `http://localhost:4321`
- Studio: `http://localhost:4322`

`dev:studio`はUI編集用のViteだけを起動し、Worker APIや`.dev.vars`は読みません。公開APIを含む統合確認では、Studioをproduction buildしてWranglerで配信します。

```bash
cd vnext
npm run dev:studio:worker
```

既定URLは`http://localhost:8787`です。ローカルのmutation境界を確認する場合は、`.dev.vars`の`STUDIO_ALLOWED_ORIGIN`もこのoriginへ合わせます。

記事は`apps/blog/src/content/articles`へMarkdownで配置します。現在の公開記事は空で、開発画面は`packages/content`のfixtureを使います。`/preview/article`は`noindex`です。

記事のfrontmatterでは、話題を表す`topics`と、技術への触れ方を表す`approach`を独立して設定します。`approach`は`experience`、`practice`、`development`、`theory`の4種類で、開発と理論は並列です。加えて`outcome`、`prerequisites`を設定します。正は[コンテンツ・掲載方針](../docs/content-strategy.md)を参照してください。

公開記事はホーム、記事一覧、テーマページへ自動配置されます。記事一覧ではタイトル・概要・タグのキーワード検索、テーマ・タグの絞り込み、12件単位のページ送りが使え、検索条件はURLで共有できます。

ヘッダーの検索ボタンはページ内で検索ボックスを展開し、キーワードを記事一覧へ引き継ぎます。記事一覧ではキーワード検索を常に表示し、テーマ・タグは詳細条件として折りたたみます。

ブログのbuild前に`generate:og`が実行され、公開記事ごとの1200×630 PNGを`public/og`へ生成します。生成物はGit管理せず、Cloudflareへdeployする成果物だけに含めます。

Studioは既存のMarkdownを読み込み、すべてのfrontmatter項目を再編集できます。入力途中で必須項目が欠けた下書きもブラウザ内へversion付きで自動保存・復元し、保存に失敗した場合はMarkdown書き出しへ誘導します。新規入力はfixtureではなく空の記事から始まり、MD読み込み、書き出し、レビュー依頼を別の操作として明示します。本文のraw HTML、危険なURL scheme、H1、見出しレベルの飛び、画像alt、内部リンク形式は公開buildと共通のvalidatorで検査し、blocking errorから該当frontmatterまたは本文行へ移動できます。リンク先記事の存在確認には全記事が必要なため、Studioでは確認待ちとして表示し、公開buildで確定します。

1200 CSS px以上では設定・Markdown・プレビューを同時に表示し、それ未満では設定・本文・プレビューをキーボード操作可能なタブで1ペインずつ表示します。レビュー依頼と公開状態は色だけでなく文言でも示し、GitHub操作を通常の編集・ファイル操作から視覚的に分離します。入力と本文は16px以上、プレビュー本文は17pxとし、すべての主要タッチ対象を44px以上にします。

ブログのdev・check・build開始前には、記事全体のslug重複、公開状態を含む記事リンク、記事内fragmentも検証します。raw HTMLはvalidatorで拒否してrendererでもテキストとしてescapeし、危険なリンク・画像URLは両層で拒否または無効化します。HTMLのコード例はインラインコードまたはコードフェンスへ記述してください。

Studioのプレビューでは、`/`から始まる記事画像、本文画像、リンクを公開ブログのURLに対して解決します。記事ファイル相対の参照と本文内の見出しリンクは書き換えません。Studioから意図せず離れないように、見出し内fragment以外の本文リンクは別タブで開きます。公開ブログのURLはbuild時の`VITE_PUBLIC_SITE_URL`で指定し、未指定のローカル開発では`http://localhost:4321`を使います。手動でStudioをdeployする場合は、localhostを埋め込まないようにこの環境変数を必須とします。

## Studio公開API境界

Studio Workerは`/api/*`だけを静的SPAより先に処理します。Cloudflare Access認証、固定origin、GitHub App、repository単位のDurable Objectがすべて設定済みの場合だけ、新規記事をcreate-onlyのsubmission branchとDraft Pull Requestとして送信できます。`develop`への直接write、既存branchのupdate、force updateは行いません。

Studio UIはcapabilitiesを読み取って連携の有効・無効・確認不能を区別し、有効な場合だけ確認dialogからDraft PR作成を開始します。POST前にUUID v4と正規化済みrequestをブラウザへ保存し、完了、失敗、結果不明の状態をreload後も復元します。送信中または結果確認中は入力を固定し、再試行では同じ`submissionId`と同じ本文を使います。複数タブの送信操作はWeb Locksで直列化し、保存済みattemptの完全一致を確認してから更新・削除します。cancel完了をserverから確認できた場合だけ送信記録を消して編集を再開し、不正な保存値は下書きを保持したまま明示的な修復操作で解除します。

- `GET /api/publication-capabilities`: Access設定がなければidentityを返さず503。認証後、公開runtimeを利用できれば`state: enabled`、利用できなければ`state: disabled`と`code: github_app_not_configured`を返す
- `POST /api/article-submissions`: 固定allowed origin、Access principal、JSON media type、streaming byte上限、strict schemaを検証し、新規記事のDraft Pull Requestへ収束させる
- `POST /api/article-submission-cancellations`: `submissionId`だけを受け付け、同じAccess principalが所有し、GitHub artifact作成前の送信だけをcancelする
- その他の`/api/*`: JSONの404を返し、StudioのHTMLへフォールバックしない

capabilitiesのidentityとsubmission principalは検証済みJWTからserver側で導出します。submission requestにemailやsubjectを含めず、送信claimのprincipalも必ずJWTから決定します。`subject`はCloudflare Accessのopaqueな識別子であり、GitHub user、記事の`authors`、画面表示名には流用しません。

送信状態は`mani1261790/Noema`を名前にしたSQLite-backed Durable Objectで直列化します。各stepは全状態を再観測し、plannerが返す1操作だけを実行します。ref作成開始とcancelは同じimmutable claimへのexact compare-and-setで競合させ、GitHubの通信結果が不明な場合はbranch、commit digest、Pull Requestを再観測できるまでmilestoneを進めません。

Blogの`check`と`build`は、nested directoryを含む全記事で`<slug>.md`のbasenameとfrontmatter `slug`が一致し、slugが全directoryで一意であることを検証します。記事Markdownはregular non-executable fileに限定します。Studioはこのrepository invariantを前提にGit treeからslug衝突を定数回のAPI呼び出しで判定し、exact targetが存在する場合だけblob本文を取得します。

`wrangler.jsonc`の`ACCESS_TEAM_DOMAIN`、`ACCESS_POLICY_AUD`、`STUDIO_ALLOWED_ORIGIN`は、`studio.noema-learn.uk`を保護するCloudflare Access applicationと本人限定policyに対応するreview可能なproduction設定です。この3値のdeploy時source of truthは`wrangler.jsonc`であり、Dashboardの手動変更やローカル専用の`.dev.vars`では上書きしません。team domainは`<team>.cloudflareaccess.com`または同じHTTPS URLを受け付けます。Studioはcustom domainだけで公開し、`workers.dev`とpreview URLは無効化します。コード上のJWT検証に加えて、Accessの外部policyでも入口を保護します。

Wrangler統合確認用の実値はGit管理しない`.dev.vars`へ置きます。GitHub連携には`GITHUB_APP_CLIENT_ID`、`GITHUB_APP_INSTALLATION_ID`、`GITHUB_APP_PRIVATE_KEY`が必要で、Wranglerではrequired secretとして宣言しています。`Cf-Access-Jwt-Assertion`だけを認証入力として使い、`CF_Authorization` cookie単体、JWT、GitHub秘密鍵、installation tokenをログやリポジトリへ残しません。実際のGitHub書き込みを有効にする前に、GitHub Appを対象repositoryと`contents: write`、`pull_requests: write`だけに限定し、custom hostnameのAccess policyを実環境で受入確認し、`workers.dev`とpreview URLを無効化または同等に保護します。現在は新規記事のDraft PRだけがAPI送信対象で、既存記事はStudioで編集・Markdown出力できてもAPI送信対象にはしません。

## 記事アシスタント

読者自身のOpenAI API keyをrequest中だけ使います。

- API keyと会話を永続化しない
- OpenAI Responses APIへ`store: false`を指定する
- 表示中の記事だけをcontextにする
- 回答をStructured Outputsで検証し、根拠にした記事内見出しへのリンクを表示する
- StudioはMarkdownをlocal fileへ書き出すかDraft Pull Requestを作成し、`develop`へ直接公開しない

## 検証

```bash
cd vnext
npm test
npm run check
npm test
npm run build
npm run deploy:dry-run
```

`deploy:dry-run`はCloudflareへ認証・uploadせず、公開ゲート、ブログ、StudioのWorker成果物を検証します。

## Cloudflare開発環境

| 対象 | Worker | URL |
| --- | --- | --- |
| ブログ | `noema-learn` | <https://noema-learn.mani1261790.workers.dev> |
| Studio | `noema-studio` | <https://noema-studio.mani1261790.workers.dev> |
| 公開ゲート | `noema-public-gate` | <https://noema-learn.uk>（404） |

ブログとStudioは`workers.dev`で確認します。ブログWorkerは本番routeを持たず、`noema-learn.uk/*`は公開ゲートだけが受けます。

## 自動デプロイ

`.github/workflows/deploy-development.yml`が`develop`の最新versionを3 Workerへdeployします。

- `develop`へのpushだけがtrigger
- `main`、feature branch、Pull Requestはdeployしない
- 手動実行も`develop` refだけを許可
- GitHub Deployments / Environmentsは使わない
- repository secret `CLOUDFLARE_API_TOKEN`を使用
- 公開ゲート、ブログ、Studioの順にdeploy

設定、確認、手動実行、rollbackの正は [開発環境デプロイ](../docs/development-deployment.md) を参照してください。

## デザイン資料

- `design/concepts`: 実装前の画面concept
- `design/qa`: 実browserで確認したcapture
- `DESIGN_CONFORMANCE.md`: デジタル庁デザインシステムとの対応表
