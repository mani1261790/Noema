import { env } from "cloudflare:workers";
import {
  getCmsPublishedArticleBySlug,
  getCmsPublishedArticleRedirect,
  getCmsPublishedSeriesBySlug,
  getCmsArticleLinkAvailability,
  getCmsPublishedEditorProfile,
  getCmsPublishedSeriesByArticleSlug,
  listCmsPublicArticleSummaries,
  listCmsPublishedSeries,
  listCmsPublishedEditors,
} from "./cms-publication-repository";

export function listPublicArticleSummaries() {
  return listCmsPublicArticleSummaries(env.CMS_DB);
}

export function getPublishedArticleBySlug(slug: string) {
  return getCmsPublishedArticleBySlug(env.CMS_DB, slug);
}

export function getPublishedArticleRedirect(slug: string) {
  return getCmsPublishedArticleRedirect(env.CMS_DB, slug);
}

export function getArticleLinkAvailability(
  slugs: Iterable<string>,
  sourceVisibility: "public" | "unlisted",
) {
  return getCmsArticleLinkAvailability(env.CMS_DB, slugs, sourceVisibility);
}

export function getPublishedSeriesByArticleSlug(slug: string) {
  return getCmsPublishedSeriesByArticleSlug(env.CMS_DB, slug);
}

export function listPublishedSeries() {
  return listCmsPublishedSeries(env.CMS_DB);
}

export function getPublishedSeriesBySlug(slug: string) {
  return getCmsPublishedSeriesBySlug(env.CMS_DB, slug);
}

export function getPublishedEditorProfile(publicId: string) {
  return getCmsPublishedEditorProfile(env.CMS_DB, publicId);
}

export function listPublishedEditors() {
  return listCmsPublishedEditors(env.CMS_DB);
}
