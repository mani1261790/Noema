import type { ArticleFrontmatter } from "@noema/content";
import { STUDIO_ARTICLE_MAX_TOPICS } from "@noema/studio-publication";

type ArticleTopic = ArticleFrontmatter["topics"][number];
export const MAX_ARTICLE_TOPICS = STUDIO_ARTICLE_MAX_TOPICS;

export function isArticleTopicChoiceDisabled(
  topics: ArticleFrontmatter["topics"],
  topic: ArticleTopic
): boolean {
  return topics.length >= MAX_ARTICLE_TOPICS && !topics.includes(topic);
}

export function toggleArticleTopic(
  topics: ArticleFrontmatter["topics"],
  topic: ArticleTopic,
  selected: boolean
): ArticleFrontmatter["topics"] {
  if (selected) {
    if (topics.includes(topic) || topics.length >= MAX_ARTICLE_TOPICS) return topics;
    return [...topics, topic];
  }
  return topics.filter((currentTopic) => currentTopic !== topic);
}
