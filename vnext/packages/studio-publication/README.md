# Studio publication contract

`@noema/studio-publication`は、Noema Studioから新規記事をDraft Pull Requestとして送信または送信前にcancelする際に、入力を検証して外部I/Oの次の1操作を決めるWorker互換のdomain packageです。

このpackage自身はGitHub APIを呼び出さず、secretやnetwork接続も持ちません。repository、base branch、記事path、submission branch、commit、Draft Pull Requestのmetadataはserver側で固定・導出し、clientからの上書きを受け付けません。

## 固定する公開境界

- repository: `mani1261790/Noema`
- base branch: `develop`
- article path: `vnext/apps/blog/src/content/articles/{slug}.md`
- submission branch: `studio/submissions/{submissionId}`
- mode: 新規記事のcreate-only
- review: Draft Pull Request
- `develop`への直接書き込みと既存branchのforce updateは禁止

`submissionId`はclientが一度だけ生成するUUID v4です。同じ送信の再試行では同じIDを使います。canonical Markdown全体と固定targetからserver側でrequest digestを計算し、認証済みAccess principalとともにimmutable claimへ結び付けます。同じIDで内容または送信者を差し替えた要求は、GitHubへのwrite前でも競合として停止します。

claimは記事本文のsource of truthではありません。`submissionId`、slug、digestと、ref creation開始fence、初回commit SHA、Pull Request番号、terminal outcomeという単調増加の操作metadataだけを保持します。記事本文、review履歴、公開状態の正はGitとGitHubです。

## GitHub adapterの実装条件

外部I/Oを追加する段階では、次の順序を守ります。

1. `submissionId` claim、slug claim、`develop`の記事inventory、固定submission branch、候補Pull Requestをすべて観測する。取得失敗は不存在に変換せず、`unavailable`として渡す。
2. `reconcileArticleSubmission`または`reconcileArticleSubmissionCancellation`が返した操作を1つだけ実行し、次の操作前に必ず全状態を再観測する。同じsubmissionとslugに対するreconcileと外部操作は直列化し、古いdecisionを後から実行しない。
3. `reserve_claim`は`submissionId`とslugを強整合なcompare-and-setで原子的に予約する。実装先はpublication adapterを追加する段階で決定する。
4. GitHub writeへ進む前に、`record_ref_creation_started`の`expectedClaim`をcompare-and-set条件としてref creation開始fenceを単調に記録する。cancelのterminal記録も同じactive claimを`expectedClaim`にするため、create開始とcancelの一方だけが成功する。
5. fenceを再観測した後の`create_submission_ref`では、返された`expectedClaim`が現在も完全一致することを確認し、blob、tree、署名または同等に検証可能なmetadata付きcommitを作成してから、そのcommitを指す新規refを作る。空branchを先に作らない。
6. refはcreate-onlyで作り、既存refを更新しない。初回commitのtree deltaは対象Markdown 1ファイルの追加だけに限定する。
7. branch作成後に失敗した再試行では、元commitが現在のheadから到達可能であることを確認する。reviewerの追加commitは保持し、元へ巻き戻さない。merge後の完了判定も元digestへの巻き戻しを要求せず、merge commitの到達性と、要求pathに同じslugの記事が1件だけ存在することを確認して最終digestを返す。
8. claimにはref creation開始fence、検証済みの初回commit SHA、Pull Request番号、terminal outcomeだけを単調に記録し、可変なphase、現在のhead、PR state、現在の`develop` SHAを保存しない。
9. open、merged、closedの対応Pull Requestを再発見した場合は再作成しない。closeされた未merge PRはterminal outcomeをclaimへ記録した後、同じ値をcompare-and-set条件にしてslug予約を解放し、修正版を別の送信IDで作成できるようにする。
10. 複数候補、削除済みartifact、metadata不一致はfail closedとする。PR作成前にbranch headが初回commitから進んでいた場合も自動採用しない。
11. 本人によるcancelは、ref creation開始fence、初回commit milestone、submission branch、Pull Requestがすべて存在しないclaimだけに許可する。まずactive claimを`cancelled`へexact compare-and-setし、再観測後に完全一致するslug claimだけをcompare-and-setで解放する。途中でfenceまたはGitHub artifactを観測した場合は予約を解放しない。

branch、commit metadata、記事digest、Pull Requestの関係が一つでも不明または不一致ならfail closedとし、自動修復やforce updateを行いません。

HTTP endpointではAccess認証から作ったprincipalだけをserver contextとして渡します。client requestにprincipal、repository、base、path、branch、commit、Pull Request設定を含めることはできません。request全体のstreaming byte上限、Content-Type、same-origin検証はHTTP境界で別途適用します。

このpackageには、元の認証済みprincipalがGitHub artifact作成前の放棄claimを明示的にcancelする純粋contractまで含まれます。HTTP endpoint、永続化、GitHub adapterはまだ実装していません。adapterを有効化する際は、createとcancelを同じ強整合な直列化境界で実行し、`expectedClaim`、terminal outcome、slug claimの更新をそれぞれ厳密なcompare-and-setにしてください。ref creation開始fenceの記録後に処理が放棄された場合は本人cancelでfenceを巻き戻さず、GitHub状態を再観測してcreateを再開するか、別の監査付き管理操作で解決します。管理者cancelを追加する場合は、本人cancelとは別の認可policyと監査記録が必要です。自動expiryだけで予約を奪い返すことはしません。
