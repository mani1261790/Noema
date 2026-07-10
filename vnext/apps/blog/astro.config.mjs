import cloudflare from "@astrojs/cloudflare";
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://noema-learn.uk",
  output: "server",
  devToolbar: { enabled: false },
  // The npm dev script opts into Astro's native server. Production builds
  // always include the Cloudflare adapter.
  adapter: process.env.NOEMA_LOCAL_DEV === "1" ? undefined : cloudflare(),
  markdown: {
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
