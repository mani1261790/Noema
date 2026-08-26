import cloudflare from "@astrojs/cloudflare";
import { satteri } from "@astrojs/markdown-satteri";
import { defineConfig } from "astro/config";
import {
  articleMarkdownFeatures,
  hardenArticleHtml,
  hardenArticleMarkdown
} from "./src/lib/safe-markdown";

export default defineConfig({
  site: "https://noema-learn.uk",
  output: "server",
  session: false,
  devToolbar: { enabled: false },
  // Keep the Cloudflare runtime active in local development so D1 bindings
  // and `cloudflare:workers` behave exactly as they do after deployment.
  adapter: cloudflare({
    configPath: "./wrangler.jsonc",
    imageService: "compile"
  }),
  markdown: {
    // Article validation rejects raw HTML and unsafe URL schemes. Hardening the
    // renderer is a second line of defence if Astro is invoked outside scripts.
    processor: satteri({
      features: articleMarkdownFeatures,
      mdastPlugins: [hardenArticleMarkdown],
      hastPlugins: [hardenArticleHtml]
    }),
    shikiConfig: {
      theme: "github-light"
    }
  },
  vite: {
    server: {
      fs: {
        allow: ["../.."]
      }
    }
  }
});
