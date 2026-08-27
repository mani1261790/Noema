# 公開発見性の判断資料

2026-08-27時点で、Noemaの公開発見性と次の読者回遊施策を決めるために使った再現可能な資料です。

- `discovery-analysis.ipynb`: live sitemapと全掲載URLを再取得し、公開面の品質を確認する実行済みnotebook
- `public-search-observations.json`: 同日の限定的な公開検索結果。index coverageの正本ではありません
- `artifact.json`: report生成の正本
- `report.html`: 自己完結した閲覧用report

IndexNowの本番稼働後、既存の匿名イベントから出発記事・導線・移動先をStudioで確認する判断基盤を追補しました。読者行動の実数とGoogle Search Consoleは認証が必要で、この分析には含めていません。流入、検索query、click率、施策効果を判断するときは、認証済みdataで更新してください。
