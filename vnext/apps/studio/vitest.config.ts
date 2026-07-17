import {
  cloudflareTest,
  readD1Migrations
} from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";
import { TEST_GITHUB_PRIVATE_KEY } from "./test/github-test-fixture";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      miniflare: {
        bindings: {
          CMS_TEST_MIGRATIONS: await readD1Migrations("./migrations"),
          GITHUB_APP_CLIENT_ID: "Iv1.test-client-id",
          GITHUB_APP_INSTALLATION_ID: "12345678",
          GITHUB_APP_PRIVATE_KEY: TEST_GITHUB_PRIVATE_KEY
        }
      },
      wrangler: { configPath: "./wrangler.jsonc" }
    }))
  ],
  test: {
    include: ["test/**/*.test.ts"]
  }
});
