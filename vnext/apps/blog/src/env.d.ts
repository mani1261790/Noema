/// <reference types="astro/client" />

declare module "cloudflare:workers" {
  const env: {
    ARTICLE_ASSETS: R2Bucket;
    CMS_DB: import("./lib/cms-publication-repository").CmsPublicationDatabase;
  };

  export { env };
}
