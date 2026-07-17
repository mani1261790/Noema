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
  devToolbar: { enabled: false },
  // The npm dev script opts into Astro's native server. Production builds
  // always include the Cloudflare adapter.
  adapter: process.env.NOEMA_LOCAL_DEV === "1"
    ? undefined
    : cloudflare({
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
