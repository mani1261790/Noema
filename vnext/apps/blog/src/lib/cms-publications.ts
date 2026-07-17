import { env } from "cloudflare:workers";
import {
  getCmsPublishedArticleBySlug,
  listCmsPublicArticleSummaries,
} from "./cms-publication-repository";

export function listPublicArticleSummaries() {
  return listCmsPublicArticleSummaries(env.CMS_DB);
}

export function getPublishedArticleBySlug(slug: string) {
  return getCmsPublishedArticleBySlug(env.CMS_DB, slug);
}
