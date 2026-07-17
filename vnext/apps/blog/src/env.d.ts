/// <reference types="astro/client" />

declare module "cloudflare:workers" {
  const env: {
    CMS_DB: import("./lib/cms-publication-repository").CmsPublicationDatabase;
  };

  export { env };
}
