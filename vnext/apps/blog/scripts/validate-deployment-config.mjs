import { readFile } from "node:fs/promises";

const configUrl = new URL("../dist/server/wrangler.json", import.meta.url);
const config = JSON.parse(await readFile(configUrl, "utf8"));
const redirectsUrl = new URL("../dist/client/_redirects", import.meta.url);
const redirects = new Set(
  (await readFile(redirectsUrl, "utf8"))
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean),
);

if (config.assets?.html_handling !== "drop-trailing-slash") {
  throw new Error("The Blog bundle must serve canonical HTML paths without trailing slashes.");
}

const permanentLegacyRedirects = [
  "/index.html / 301",
  "/about.html /about 301",
  "/about/ /about 301",
  "/privacy.html /privacy 301",
  "/privacy/ /privacy 301",
  "/terms.html /terms 301",
  "/terms/ /terms 301",
];
const missingRedirects = permanentLegacyRedirects.filter((rule) => !redirects.has(rule));
if (missingRedirects.length > 0) {
  throw new Error(`The Blog bundle must preserve permanent legacy redirects: ${missingRedirects.join(", ")}`);
}

const kvBindings = config.kv_namespaces ?? [];
if (kvBindings.length > 0) {
  throw new Error(`The Blog bundle must not provision KV bindings: ${kvBindings.map(({ binding }) => binding).join(", ")}`);
}

const d1Databases = config.d1_databases ?? [];
if (!d1Databases.some(({ binding, database_name: databaseName }) => binding === "CMS_DB" && databaseName === "noema-cms")) {
  throw new Error("The Blog bundle must use the shared noema-cms D1 database.");
}

const r2Buckets = config.r2_buckets ?? [];
if (!r2Buckets.some(({ binding, bucket_name: bucketName }) => binding === "ARTICLE_ASSETS" && bucketName === "noema-article-assets")) {
  throw new Error("The Blog bundle must use the shared noema-article-assets R2 bucket.");
}

console.log("Validated the Blog deployment (canonical HTML paths, permanent legacy redirects, shared CMS D1/R2, no KV provisioning).");
