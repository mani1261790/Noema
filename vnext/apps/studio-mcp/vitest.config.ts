import {
  cloudflareTest,
  readD1Migrations
} from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      miniflare: {
        bindings: {
          CMS_TEST_MIGRATIONS: await readD1Migrations("../studio/migrations"),
          MCP_ACCESS_POLICY_AUD: "test-audience"
        }
      },
      wrangler: { configPath: "./wrangler.jsonc" }
    }))
  ],
  test: {
    include: ["test/**/*.test.ts"]
  }
});
