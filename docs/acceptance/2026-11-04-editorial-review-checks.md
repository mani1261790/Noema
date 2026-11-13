# 校正記録と自動警告の検証

- 対象: `codex/editorial-review-checks`。`origin/develop` の `008872d` を基点とする。
- `pnpm test`: 581 tests passed（content 67、CMS 9、blog 158、public-gate 39、Studio Node 24、Studio Worker 254、MCP 30）。
- `pnpm run check`、`pnpm run build`、`pnpm run deploy:dry-run`: 成功。dry-runはアップロード・D1 migration適用・公開ではない。
- Workerテストでは実際のローカルD1 migrationsを適用。校正記録のないMCP保存、原稿ハッシュ不一致、必要な検査の不足、記録なしの更新・復元を拒否することを確認。
- MCP記事をStudioから編集・復元したあとも校正必須条件が残り、記録のないレビュー依頼・承認・公開を拒否することを確認。既存の楽観ロックと再送テストも成功。
- PlaywrightでローカルViteとAPI応答fixtureを使い、レビュー画面の連番・本文3行/6行の数式・本文9行の参考資料警告、校正未確認の表示、レビュー依頼ボタンの無効化を確認。
- 数式警告をクリックするとtextareaで `x₁ = 2` が選択され、タイトル警告をクリックすると `article-title` がフォーカスされることを確認。
- 390×844と1440×1000で画面を確認。実認証、デプロイ済みWorker、本番記事への変更は行っていない。

記録はクライアントの実行申告であり、サーバーで両スキルを実行したという証明ではない。自動警告は数式や分類の正しさの合格判定ではない。運用手順と制約は `docs/editorial-review-checks.md` を参照。
