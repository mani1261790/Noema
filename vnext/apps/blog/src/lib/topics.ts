import {
  topicDescriptions,
  topicLabels,
  type ArticleSummary
} from "@noema/content";

type TopicSlug = keyof typeof topicLabels;

export type ActiveTopic = {
  slug: TopicSlug;
  label: (typeof topicLabels)[TopicSlug];
  description: (typeof topicDescriptions)[TopicSlug];
  articleCount: number;
};

export type TopicListingResponse = {
  noindex: boolean;
  status: 200 | 404;
};

export function topicListingResponse(articleCount: number): TopicListingResponse {
  return articleCount > 0
    ? { noindex: false, status: 200 }
    : { noindex: true, status: 404 };
}

export function listActiveTopics(
  articles: Array<Pick<ArticleSummary, "topics">>
): ActiveTopic[] {
  const articleCounts = new Map<TopicSlug, number>();

  for (const article of articles) {
    for (const topic of new Set(article.topics)) {
      articleCounts.set(topic, (articleCounts.get(topic) ?? 0) + 1);
    }
  }

  return (Object.keys(topicLabels) as TopicSlug[]).flatMap((slug) => {
    const articleCount = articleCounts.get(slug) ?? 0;
    return articleCount > 0
      ? [{
          slug,
          label: topicLabels[slug],
          description: topicDescriptions[slug],
          articleCount
        }]
      : [];
  });
}

export function listNarrowingTopics(
  articles: Array<Pick<ArticleSummary, "topics">>
): ActiveTopic[] {
  return listActiveTopics(articles).filter(
    ({ articleCount }) => articleCount < articles.length
  );
}
