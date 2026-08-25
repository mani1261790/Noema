import { env } from "cloudflare:workers";
import {
  getCmsPublishedArticleBySlug,
  getCmsPublishedEditorProfile,
  getCmsPublishedSeriesByArticleSlug,
  listCmsPublicArticleSummaries,
  listCmsPublishedEditors,
} from "./cms-publication-repository";

export function listPublicArticleSummaries() {
  return listCmsPublicArticleSummaries(env.CMS_DB);
}

export function getPublishedArticleBySlug(slug: string) {
  return getCmsPublishedArticleBySlug(env.CMS_DB, slug);
}

export function getPublishedSeriesByArticleSlug(slug: string) {
  return getCmsPublishedSeriesByArticleSlug(env.CMS_DB, slug);
}

export function getPublishedEditorProfile(publicId: string) {
  return getCmsPublishedEditorProfile(env.CMS_DB, publicId);
}

export function listPublishedEditors() {
  return listCmsPublishedEditors(env.CMS_DB);
}
