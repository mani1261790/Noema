/// <reference types="astro/client" />

declare module "virtual:noema-static-page-revisions" {
  const revisions: Readonly<Record<"/about" | "/privacy" | "/updates", string>>;
  export default revisions;
}

declare module "cloudflare:workers" {
  const env: {
    ANALYTICS_RATE_LIMITER: RateLimit;
    ARTICLE_ASSETS: R2Bucket;
    ASSETS: { fetch(input: Request): Promise<Response> };
    CMS_DB: D1Database;
    READER_ANALYTICS?: AnalyticsEngineDataset;
  };

  export { env };
}
