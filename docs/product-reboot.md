# Noemaプロダクト再設計仕様

ステータス: MVP実装・Cloudflare開発環境運用中

決定日: 2026-07-10

最終更新: 2026-07-11

対象: Markdown技術ブログとしての現行Noema

旧notebook/AWS版の退役、新applicationのCloudflare deployment、`develop`限定preview運用まで完了している。本書では実装済みのMVPと、公開までに残る目標を区別して記載する。

## 1. 要約

Noemaを、Jupyter Notebookを実行するサービスから、AIでできることとその仕組みを直感と具体例からひもとく独立した技術メディアへ作り直す。

次期 Noema の中心は次の3つとする。

1. Markdownで管理した技術記事を読む公開ブログ
2. 記事を Markdown で作成・プレビュー・公開する執筆者用エディター
3. 閲覧中の記事だけを文脈として、読者自身の API キーで LLM に質問できる記事アシスタント

現行の notebook、assessment、Python 実行環境、Bedrock、Cognito、学習進捗、AWS インフラは引き継がない。引き継ぐのは「表示中の教材を文脈として LLM と対話する」という体験だけであり、実装は作り直す。

## 2. プロダクトの目的

### 2.1 誰のためのサービスか

- 技術に関心はあるが、数式・コード・専門用語から入ると理解しにくい人
- 技術が仕事や生活にどう関係するかを先に知りたい非技術職
- 専門分野の全体像や直感的な理解を得たい初学者
- 正確さを失わず、平易な説明を読みたい技術者

入口ではAIの有用性をまだ見つけられていない人へ、目に見える成果や気になる話題を提示する。順路は示さず、使う、つくる、仕組みを知るといった関心から記事を選べるようにする。詳細は[コンテンツ・掲載方針](./content-strategy.md)を正とする。

### 2.2 提供価値

- 「何のための技術か」から説明し、専門用語は本文中で解きほぐす
- 直感、図、具体例、歴史、実利用の順で理解を支える
- 記事を読んで生じた疑問を、その記事の内容を知る LLM にその場で質問できる
- notebook や実行環境の準備なしで、URLを開くだけで読める
- 締切や固定コースに縛られず、自分の興味から次の記事を選べる

収益化を目的としない。Noemaは独立したメディアブランドと編集方針を保ち、OIFはAboutページ内の運営情報としてのみ示す。

参考とするコンテンツ体験は、専門的な制御工学を直感的なイメージと実用上のコツから説明する「こんとろラボ」の方向性である。ただし、記事・ブランド・画面を複製するものではない。

### 2.3 MVPで行わないこと

- `ipynb` の変換、表示、ダウンロード、Colab 連携
- ブラウザまたはサーバーでの Python 実行
- 問題、採点、章末課題、学習進捗
- 読者アカウント、ログイン、質問履歴の永続化
- Bedrock または Noema が費用を負担する LLM 推論
- 全記事横断 RAG、ベクトル検索、パーソナライズ
- AIによる記事の自動生成

## 3. 情報設計

### 3.1 公開サイト

| URL | 役割 |
| --- | --- |
| `/` | Noemaのブランドメッセージ、大小の注目記事カード、主要テーマ |
| `/articles` | 記事一覧。テーマ、キーワードで絞り込み |
| `/articles/{slug}` | 記事本文、目次、参考資料、関連記事、記事アシスタント |
| `/topics/{slug}` | テーマの説明と記事一覧 |
| `/about` | 編集方針、想定読者、運営情報 |
| `/privacy` | プライバシーと API キーの取扱い |
| `/terms` | 利用規約 |

初期実装では記事を用意しない。UI検証用の最小限のサンプルデータは、本番コンテンツと明確に区別してテストfixtureとしてのみ管理する。

### 3.2 記事ページ

記事ページは次の順序を基本とする。

1. パンくずリスト
2. タイトルと要約
3. 読了時間、更新日
4. 目次
5. 本文
6. 参考資料・出典
7. 関連記事
8. 記事アシスタント

記事アシスタントは本文を遮らない補助機能とする。デスクトップでは右側パネルまたは本文末尾、モバイルでは本文末尾から開くドロワーを基本にし、常時表示で可読領域を狭めない。

## 4. Markdown コンテンツ仕様

記事の source of truth は Git 管理された `.md` ファイルとする。MVPでは MDX とraw HTMLを採用せず、`javascript:` や `data:` など実行可能なURL schemeも許可しない。HTMLの例を示す場合はインラインコードまたはコードフェンスへ記述する。

```yaml
---
title: "記事タイトル"
description: "検索結果と記事一覧に表示する要約"
slug: "example-article"
status: "draft" # draft | published | archived
publishedAt: "2026-07-10"
updatedAt: "2026-07-10"
authors:
  - "author-id"
topics:
  - "research-organization"
tags:
  - "NotebookLM"
approach: "experience" # experience | practice | development | theory
outcome: "この記事を読んだ後にできること"
prerequisites: []
estimatedMinutes: 10
heroImage:
  src: "/images/articles/example.webp"
  alt: "画像から得られる情報を説明する代替テキスト"
sources:
  - title: "資料名"
    url: "https://example.com/source"
    checkedAt: "2026-07-12"
---
```

Studioとビルドは同じvalidatorを使い、raw HTML、危険なURL scheme、frontmatterのスキーマ、見出し階層、画像の代替テキストを検証する。Studioは編集中の記事単体で判定できる項目を即時検証し、全記事を参照できるビルドではslugの重複、記事リンク、fragmentも追加検証する。公開記事から下書き・保管記事へのリンクは公開時に到達不能になるためエラーとする。`topics`は記事の話題、`approach`は体験・活用・開発・理論という触れ方を表し、互いに独立して設定する。Markdownは安全なHTMLに変換し、見出しIDと目次を決定的に生成する。renderer側でもraw HTMLをテキストへescapeし、危険なリンク・画像URLを無効化して、検証の迂回だけで実行可能なHTMLが出力されないようにする。

公開ビルドではRSS、記事ごとのOG画像、`Article`構造化データを生成する。OG画像はNode.jsのビルド前工程でPNGへ変換し、Cloudflare Workerの実行時には画像生成処理を持ち込まない。

## 5. 執筆エディター

公開ブログと執筆画面は責務とアクセス制御を分離する。

- 公開先: `https://noema-learn.uk`
- 推奨する執筆先: `https://studio.noema-learn.uk`
- 認証: Cloudflare Access
- UI: Markdown入力、リアルタイムプレビュー、全frontmatter項目、既存MD読み込み、バリデーション結果
- 公開フロー: GitHub App を介して記事ブランチと Pull Request を作成し、レビュー後に `develop` へマージ
- 画像: Cloudflare R2 にアップロードし、記事へ参照を挿入

公開済み記事の正を Git に置くことで、編集履歴、レビュー、ロールバック、ローカル編集を維持する。D1 を source of truth にしない。MVPの自動保存はブラウザの`localStorage`だけを使い、端末をまたぐ下書き共有が必要になった時点で保存先を再検討する。

エディターの最初の実装単位は「既存または新規Markdownを編集し、プレビューし、ファイルとして取得できる」までとする。GitHub App によるPR作成とR2画像アップロードは、その次の単位で追加できる。

公開連携の第2実装単位として、Studio WorkerにCloudflare Access JWTを検証するAPI境界を設ける。`/api/*`はSPAへフォールバックさせず、`Cf-Access-Jwt-Assertion`のRS256署名、issuer、application audience、有効期限、not-beforeを検証する。cookieだけの認証は受け付けない。Access設定がない場合はidentityを返さず503とし、Access認証が有効でGitHub Appだけが未設定の場合はcapabilitiesを`state: disabled`、`code: github_app_not_configured`として返す。記事送信APIは固定したStudio origin以外を認証処理前に拒否し、認証後もfail-closedで外部書き込みを行わない。

公開連携の第3実装単位では、固定repositoryと`develop`を対象に、新規記事だけをcreate-onlyのsubmission branchとDraft Pull Requestへ送信する。repository単位のSQLite-backed Durable ObjectでreconcileとGitHub I/Oを1操作ずつ直列化し、ref作成開始と本人cancelを同じclaimのexact compare-and-setで競合させる。通信断や再試行ではGitHub artifactを再観測し、既存refの更新、force update、`develop`への直接write、自動mergeは行わない。

## 6. 記事アシスタント

### 6.1 MVPの動作

1. 読者が記事ページで対応プロバイダーの API キーを入力する
2. キーはブラウザのメモリにだけ保持する
3. 質問、記事ID、直前の会話、APIキーを Cloudflare Worker に送る
4. Worker が公開済み記事本文からプロンプトを構築し、LLM API を呼ぶ
5. 回答と、根拠にした記事内見出しを返す

記事アシスタントは、表示中の記事だけを知識源とする。全記事横断検索、Embedding、Vectorize はMVPに含めない。

### 6.2 APIキーの取扱い

- APIキーを Cookie、`localStorage`、D1、KV、R2、ログ、例外監視へ保存しない
- Worker はリクエスト処理中だけキーを保持し、上流LLM APIへの認証以外に使用しない
- ブラウザ更新後は再入力を求める
- ログにはキーを含むヘッダーと本文を出力しない
- UI上で「Noemaを経由してプロバイダーへ送信されること」を事前に明示する

MVPのプロバイダーは1つに絞る。推奨は OpenAI API から開始し、モデルはNoema側で安全な既定値を指定する。Anthropic、Google等への対応はプロバイダー抽象化を導入する段階で別途判断する。

### 6.3 回答ルール

- 記事にない事実を記事由来であるかのように答えない
- 記事内の根拠見出しを示す
- 推測と記事記載事項を区別する
- 記事の誤りを断定的に補強しない
- 医療、法律、金融など高リスク分野では注意書きを表示する
- 質問と回答をMVPでは永続化しない

## 7. Cloudflare構成

### 7.1 推奨技術

新実装は既存 Next.js/AWS 構成を段階的に変換せず、別のアプリとして作成して切り替える。

| 役割 | 採用候補 | 理由 |
| --- | --- | --- |
| 公開ブログ | Astro + Cloudflare Workers Static Assets | Markdown中心、静的生成、少ないクライアントJSに適する |
| 記事アシスタントAPI | Cloudflare Worker | APIキーを永続化せずLLM APIへ中継できる |
| 執筆エディター | React/Vite + Cloudflare Worker | 入力中心の独立したWebアプリとして分離しやすい |
| 執筆者認証 | Cloudflare Access | 読者アカウントを作らず管理画面だけ保護できる |
| 記事画像 | Cloudflare R2 | 画像等のオブジェクト保存 |
| DNS/TLS | Cloudflare DNS + Worker Custom Domain | `noema-learn.uk` を維持して切り替え可能 |
| 可観測性 | Workers Logs + Web Analytics | AWS CloudWatchを置き換える |
| 下書き自動保存（将来） | D1 | 必要になるまで導入しない |

サービスが単純な段階で D1、KV、Queues、Vectorize、Durable Objects を先回りして導入しない。

### 7.2 論理構成

```text
読者
  └─ noema-learn.uk
       ├─ Cloudflare Worker + Static Assets
       │    └─ ビルド済みMarkdown記事、CSS、画像参照
       └─ /api/chat
            ├─ 公開済み記事コンテキスト
            └─ 読者指定のLLM API（BYOK）

執筆者
  └─ studio.noema-learn.uk
       ├─ Cloudflare Access
       ├─ Editor Worker + Static Assets
       ├─ R2（画像）
       └─ GitHub App（記事PR）
```

## 8. `noema-learn.uk` の移行

2026-07-11時点でAWS版とCloudFrontは退役済みであり、ドメインのネームサーバーはCloudflareが管理している。現行applicationはCloudflare Workersへdeployされ、開発中の確認には`workers.dev`を使う。

現在の配信状態:

- `develop`の最新versionをブログとStudioの`workers.dev` URLへ自動deployする
- `main`やfeature branchからはdeployしない
- `noema-learn.uk/*`は`noema-public-gate`が404を返す
- ブログWorkerは本番hostnameのrouteをまだ持たない

公開切替は、SEO、security、mobile、記事アシスタントを受入確認した後、公開ゲートからrouteを外してブログWorkerへcustom domainまたはrouteを移す別作業とする。開発preview workflowを本番公開へ流用しない。

## 9. 現行機能の扱い

| 現行要素 | vNextでの扱い |
| --- | --- |
| `content/notebooks/**/*.ipynb` | 廃止。移行対象にしない |
| notebook HTMLビルド | 廃止 |
| assessment / chapter final | 廃止 |
| Python runner | 廃止 |
| Next.js学習画面とstatic app | 新UIで置換 |
| Cognito | 廃止。執筆者はCloudflare Access |
| Bedrock | 廃止 |
| API Gateway / Lambda / SQS / DynamoDB | 廃止 |
| S3 / CloudFront | Worker Static Assets / R2へ置換 |
| 記事文脈Q&Aの考え方 | BYOK記事アシスタントとして再実装 |
| `noema-learn.uk` | 継続利用 |

## 10. 実装ロードマップ

### Phase 0: 仕様とデザイン基盤（完了）

- 本仕様を合意する
- デジタル庁デザインシステムを固定する
- Noema固有スタイルガイドを定義する
- 新旧の削除・移行境界を確定する

完了条件: 画面一覧、コンテンツ形式、Cloudflare構成、未決定事項がレビュー済み。

### Phase 1: 読めるブログシェル（MVP完了）

- 新しいAstroアプリを作成
- トップ、記事一覧、記事詳細、テーマ、固定ページを実装
- Markdownスキーマとビルド検証を実装
- デジタル庁デザインシステム準拠のレスポンシブUIを実装
- 画面・コンポーネント単位の公式ガイドライン対応表と検証証跡を作成

完了条件: fixture記事で主要画面を検証でき、適用可能なデジタル庁デザインシステムβ版 v2.16.0の規範に対する既知の不適合が0件である。

### Phase 2: 記事アシスタント（MVP完了）

- APIキー入力UI
- WorkerのLLM中継
- 記事コンテキストと根拠見出し
- 入力制限、タイムアウト、エラー表示、ログ秘匿

完了条件: キーを保存せず、表示中の記事についてのみ対話できる。

### Phase 3: エディター（公開API境界まで実装・GitHub/R2連携は未実装）

- 独立エディターUI
- Cloudflare Access JWT検証境界（実環境のAccess application/policyは未設定）
- Markdownプレビューとスキーマ検証
- GitHub PR作成（未実装）
- R2画像アップロード（未実装）

完了条件: ブラウザから記事PRを作成し、レビュー後に公開できる。

現時点のAPIは完了条件を満たした公開機能ではない。GitHub Appを接続する前に、`studio.noema-learn.uk`のAccess application、許可policy、team domain、application AUD、固定allowed originを設定し、`workers.dev`とpreview URLを迂回経路にしないことを実環境で確認する。次のPR作成単位は新規記事だけを扱うcreate-onlyのDraft PRとし、既存記事の更新はbase/blob SHAを使う競合検出を設計してから追加する。

### Phase 4: Cloudflare移行（AWS廃止完了・一般公開は未実施）

- Cloudflare preview環境で受入確認
- `noema-learn.uk` をWorkerへ切替
- 監視とロールバック確認
- AWSデータ棚卸し、退避、リソース廃止
- AWS依存コードと運用文書の削除

AWS廃止とCloudflare開発環境への移行は完了した。残る完了条件は、公開受入確認後に`noema-learn.uk`をブログWorkerへ接続することである。

## 11. 未決定事項

実装前に次の判断が必要である。推奨値を初期案とする。

| 項目 | 推奨 | 選択肢・影響 |
| --- | --- | --- |
| MVPのLLMプロバイダー | OpenAIのみ | 複数対応はUI、エラー、モデル管理が増える |
| エディターの次回範囲 | create-onlyのDraft PR作成 | 既存記事の編集には期待するbase/blob SHAと競合処理が別途必要 |
| 記事画像 | 初期はGit管理、後にR2 | R2を先に入れるとアップロード・削除・参照整合性が必要 |
| ブランドカラー | デジタル庁の青系をNoema用に定義 | 完全コピーではなくNoemaの識別性が必要 |
| 既存URLのリダイレクト | 主要URLのみ新サイトへ301 | notebook単位の移行先がないため一律対応方針が必要 |
| 旧学習データ | 解決済み: 移行せず削除 | 件数と退役結果はAWS Archiveに記録済み |

## 12. 外部アクセスが必要になる時点

Phase 0とローカルUI実装には追加アクセスは不要である。Cloudflare上のpreview作成以降、次が必要になる。

- 対象zoneを含むCloudflareアカウントへのアクセス
- Workers、R2、Access、DNSを操作できるCloudflare API tokenまたは対話ログイン
- GitHub Actionsでデプロイする場合はrepository secret `CLOUDFLARE_API_TOKEN`
- `studio.noema-learn.uk` で利用するCloudflare Accessの許可ユーザー/メールドメイン
- エディターからPRを作る段階ではGitHub Appの作成権限

AWS版は退役済みのため、現行Noemaの開発にAWS accessは不要である。

APIキーや認証情報をIssue、PR本文、リポジトリへ貼り付けない。

## 13. 参照

- [Noema UIスタイルガイド](./noema-style-guide.md)
- [コンテンツ・学習導線仕様](./content-strategy.md)
- [開発環境デプロイ](./development-deployment.md)
- [デジタル庁デザインシステムの固定コピー](./references/digital-agency-design-system/README.md)
- [退役したAWS版と復元資料](https://github.com/mani1261790/Noema-AWS-Archive)
