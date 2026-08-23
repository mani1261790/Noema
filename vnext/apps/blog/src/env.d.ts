/// <reference types="astro/client" />

declare module "cloudflare:workers" {
  const env: {
    ARTICLE_ASSETS: R2Bucket;
    CMS_DB: D1Database;
    READER_ANALYTICS: AnalyticsEngineDataset;
  };

  export { env };
}
