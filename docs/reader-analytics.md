# 読者行動分析基盤

Noemaの分析基盤は、PVを増やすための追跡ではなく、記事が理解と次の行動につながったかを判断するために使います。公開記事で発生した限定的なイベントを、公開revisionへ結び付けて記録します。

## Studioで確認する

Studioの主ナビゲーションから「分析」を開き、7日・30日・90日を切り替えます。CMSの`view`権限が必要です。同じ集計はStudio MCPの読み取り専用ツール`studio_get_analytics_summary`からも取得できます。

主要指標は次の7つです。定義の正本は`@noema/cms`の`cmsAnalyticsMetricCatalog`です。画面、API、運用資料で分子・分母を独自に再定義しません。

| 指標ID | 計算 | 粒度 | 判断できること |
| --- | --- | --- | --- |
| `article_50_rate` | `article_50 / landing` | 公開記事revision | 流入時の約束と記事前半の構成を見直す |
| `qualified_read_rate` | `article_end / landing` | 公開記事revision | 記事の長さ、構成、説明の途切れを見直す |
| `onward_rate` | `navigation_click / article_end` | 公開記事revision | シリーズ導線と記事末尾CTAを見直す |
| `updates_guide_rate` | `updates_click / article_end` | 公開記事revision | 記事末の更新導線の発見性と説明を見直す |
| `updates_action_rate` | `updates_action / updates_click` | 公開記事revision | 更新案内ページの説明とRSS追加手順を見直す |
| `assistant_use_rate` | `assistant_open / landing` | 公開記事revision | アシスタントの発見性と必要性を見直す |
| `assistant_success_rate` | `assistant_success / assistant_open` | 公開記事revision | アシスタント実行経路の失敗を調べる |

分母が0の率は0%ではなく「—」と表示します。イベントは認証された人間だけを厳密に数えるものではないため、課金、セキュリティ判断、唯一の事業KPIには使わず、期間比較と記事改善の方向を見る指標として扱います。

### 直前の同期間と比較する

7日・30日・90日の各表示期間では、選んだ期間の直前にある同じ日数の集計を比較対象にします。率の増減は相対変化率ではなく、たとえば40%から45%なら`+5.0ポイント`と表示します。期間の切り替え、記事改訂、導線変更の前後を確認するための比較であり、表示された差だけから施策との因果関係は断定しません。

比較対象の全日が正本coverage開始日以降に入るまでは、前期間の値と増減を返しません。計測開始前の欠測を0件として扱うと、実際には比較できない増加を作ってしまうためです。APIとStudio MCPは`comparison.status: "collecting"`、`comparison.totals: null`、比較可能になる`availableOn`を返し、Studioも同じ日まで増減を表示しません。分母が0で率を計算できない場合も、0%との差には置き換えません。

この画面が扱うのはNoema内の行動です。ページ閲覧の実利用環境とCore Web VitalsはCloudflare Web Analytics、検索表示回数・検索クリック・検索語句はGoogle Search Consoleで別に確認します。Studioは両方を「外部で確認」と表示し、CloudflareはNoemaのWeb Analytics siteへ、Search ConsoleはURLプレフィックスプロパティ`https://noema-learn.uk/`の検索実績・インデックス状況・サイトマップ・外部リンクへ直接移動できます。Cloudflare Web Analyticsは`noema-learn.uk`で有効にし、EU訪問者データを除外する設定を使います。外部sourceの値をNoemaのAPIやD1へ取り込んだり、外部sourceの事実をサイト内イベントから推測したりしません。

外部流入とは別に、記事を開く直前のNoema内の入口を`home`、`article_index`、`series`、`topic`、`article`、`other_internal`へ分類します。外部referrerがある場合は`external`、referrerがない場合は`direct`です。これはホームや一覧の導線改善を比較するための列挙値であり、同一サイトの生URLや閲覧履歴は保存しません。外部流入のUTM・referrer hostを上書きせず、入口別の到達・50%到達・読了・次記事移動をStudioで別表として確認します。

「次にどの記事へ進んだか」では、`navigation_click`を出発記事の公開revision、`series_next`または`related`の導線種別、移動先slugで集計します。個々のイベントを読者やセッションへ結合せず、選択期間内で件数の多い経路から最大200件を表示します。これにより、クリックされない関連記事の差し替えや、シリーズ順序の見直し対象を判断できます。200件を超えた場合は画面で切り捨てを明示します。

## 収集するイベント

| イベント | 発生条件 |
| --- | --- |
| `landing` | 公開記事を表示したとき |
| `article_50` | 本文の50%位置まで表示したとき |
| `article_end` | 本文末尾まで表示したとき |
| `navigation_click` | シリーズ次記事または関連記事を選んだとき |
| `updates_click` | 記事末から更新案内ページへ移動したとき |
| `updates_action` | 元記事を示すURL fragment付きの更新案内ページで、RSS URLのコピーに成功するかフィードリンクを選んだ最初の1回 |
| `share` | 共有URLのclipboard保存に成功したとき |
| `assistant_open` | 「この記事について質問」ボタンまたは本文選択後の「AIに質問」から質問パネルを開いたとき |
| `assistant_success` | アシスタント回答の表示に成功したとき |
| `assistant_error` | アシスタント回答に失敗したとき |

同じページ表示では、同じ種類と対象のイベントを1回だけ送ります。記事ページのイベントにはそのページ表示の固定された入口分類を添えます。`updates_action`はURL fragmentの元記事slugだけを送り、流入元や読者を識別する値は添えません。サーバーはクライアントのrevision指定を受け取らず、受信時点でそのslugに紐づく公開revisionをD1から解決します。

`updates_action_rate`は集計上の段階差を見るための代理指標です。`updates_click`と`updates_action`は読者やセッション単位に結合しないため、同じ人の連続行動を表す率ではありません。再読み込み、bot、欠測、期間境界により100%を超えることがあります。RSS購読の完了や、その後も読み続けたことはNoemaでは把握しません。

イベント契約v1には、イベントごとに独立したUUIDの`eventId`、`schemaVersion: 1`、クライアント上の`occurredAt`を含めます。`eventId`は再送の重複排除だけに使い、別イベントや別ページを結合できる読者ID・セッションIDではありません。集計日は端末時計ではなく、サーバーの`receivedAt`から決めます。

## 保存先と保持境界

```mermaid
flowchart LR
  Reader["公開記事"] --> Endpoint["同一origin収集API"]
  Endpoint --> Resolve["公開revisionをD1で解決"]
  Resolve --> Facts["D1 イベント正本\n35日・重複排除"]
  Facts --> Daily["D1 日次マート\n400日"]
  Facts --> Entry["D1 入口別マート\n400日"]
  Resolve -. optional .-> Explore["Analytics Engine\n短期探索"]
  Facts --> Quality["品質検査\n鮮度・重複・整合"]
  Daily --> Studio["Studio / MCP\n7・30・90日集計"]
  Entry --> Studio
  Quality --> Studio
```

- D1の`cms_analytics_events`が短期の正本です。契約バージョン、イベントID、発生・受信時刻、公開revision、イベント種別、限定した流入・遷移次元を保存し、35日保持します。HTTPリクエスト全体や読者単位の識別子は保存しません。
- `cms_analytics_daily`は表示用マートです。イベント正本へのINSERTと同じDBトランザクション内のtriggerでUTC日次へ加算し、400日保持します。短期正本が残る範囲は再集計でき、長期傾向は日次マートで保持します。
- `cms_analytics_entry_daily`は入口分類ごとの表示用マートです。外部流入のsource次元とは混ぜず、記事への入口とそのページ表示内の読書行動を400日保持します。導入前または旧clientのイベントは`unknown`として分離し、入口別coverage開始日より前の結果を完全coverageと扱いません。
- `cms_analytics_ingestion_daily`は受理件数と重複除外件数を保持します。`cms_analytics_pipeline_state`は完全な正本のcoverage開始日を示し、移行前の集計を再処理可能と誤認しないために使います。
- Studio Workerの日次scheduled cleanup（03:17 UTC）は、収集が止まっていても35日・400日の保持期限を適用します。収集trigger内の削除は高速経路として残します。
- Analytics Engineは任意の短期探索層です。Cloudflare accountで有効化し`READER_ANALYTICS`をbindingした環境だけ、`noema_reader_events`へ同じイベントを送ります。blob 1〜11はイベント、slug、revision、source、medium、campaign、content、referrer host、遷移種別、遷移先slug、入口分類、double 1は件数、indexは不変の記事IDです。bindingがない環境でもD1の正本とStudio/MCPの分析は動作します。
- ブラウザの`sessionStorage`には流入識別子と30分の有効期限だけを保存します。永続的な読者IDや、イベント間を結合するセッションIDは作りません。

## データ品質とlineage

Studioと`studio_get_analytics_summary`は、分析値と同時に次の運用状態を返します。

| 検査 | 判定 |
| --- | --- |
| 収集鮮度 | 最新イベント受信から24時間以内か。ただし低トラフィック時はサイト稼働状況と併せて判断する |
| 重複排除 | 受理・重複試行に占める重複が5%以下か |
| イベント契約 | schema v1、時刻形式、端末時刻と受信時刻の24時間以内の差を満たすか |
| revision lineage | 全イベントをCMSの公開revisionへ解決できるか |
| 正本・マート整合 | 完全coverage期間のイベント行数と日次・入口別マートの各合計が一致するか |
| 指標整合 | `article_50 <= landing`など主要率の分子が分母以下か |

値がない場合と0は区別します。正本coverage前の期間は「正常」ではなく「未評価」とします。警告はデータを自動補正せず、bot、欠測、期間境界、収集障害の調査開始条件として扱います。

「正本・マート整合」が不一致の場合、adminはStudioの「正本から再集計」またはMCPの`studio_rebuild_analytics_mart`を使えます。対象は完全な正本coverage開始日と35日の保持期限のうち遅い日以降、かつ連続35日以内に限定し、削除と再投影をD1 batchで原子的に実行します。実行範囲、正本件数、実行者、時刻は`cms_analytics_pipeline_runs`へ記録します。

Noema内のlineageは`公開記事 -> 同一origin API -> cms_analytics_events -> cms_analytics_daily / cms_analytics_entry_daily -> Studio/MCP`です。Cloudflare Web AnalyticsとGoogle Search Consoleは別の正本を持つ外部sourceです。接続していない段階でNoemaの行動イベントから検索表示、検索クリック、Core Web Vitalsを推定しません。

質問本文、選択した本文、回答本文、会話履歴、APIキー、メールアドレス、IPアドレス、User-Agent、永続的な利用者IDは分析データへ保存しません。IPアドレスは乱用防止のためCloudflare edgeのRate Limitingキーとして一時利用しますが、D1、Analytics Engine、アプリケーションログには保存しません。UTMのsource・medium・campaign・contentは小文字英数字と`.`、`_`、`-`だけに制限します。キャンペーン名へ個人情報を入れてはいけません。

## 運用上の注意

- `landing`はブラウザ内のページ表示であり、厳密なユニークユーザー数ではありません。
- 同一originヘッダー、JSON形式、4 KiB上限、固定schemaを収集APIで検査し、1 IPあたり毎分120イベントに制限します。未知のslugと受理したslugはどちらも204を返し、unlisted記事の存在を応答から推測できないようにします。これらは品質上の境界であり、botを完全に排除する認証ではありません。
- D1イベント正本への書き込みを正本とし、Analytics Engineのbindingがなくても収集APIは成功として扱います。bindingがある環境で探索用送信だけが失敗した場合も、D1書き込みは成功したまま構造化ログ`blog.analytics.exploratory_write_failed`へ残します。
- 日次集計はUTCで区切ります。画面の対象期間より未来の日付は集計に含めません。
- schema変更は新しいD1 migrationで行い、既存migrationを書き換えません。
