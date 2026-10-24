# Card destinations

Article links keep a white card and a visible “記事を読む” action. Reading-intent and topic navigation use a pale background and explicit “一覧を見る” wording. Series are navigation groups, not stretched links: “1本目の記事を読む” and “全N本の目次を見る” are independent links. The first article destination is preserved; clicking empty space no longer unexpectedly opens an article.

Local Chromium checks: home, series, article search and topic pages at 320 / 390 / 768 / 1160px (16 combinations), no horizontal overflow. Mobile series cards remain compact (maximum 236px at 320px). Actual click tests distinguish the first article route from the series overview route. Desktop and mobile screenshots inspected, alongside existing test, type-check and build checks. Physical iPhone testing is not claimed.
