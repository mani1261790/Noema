import { loadEnv } from "vite";

const publicSiteUrl = loadEnv("production", process.cwd()).VITE_PUBLIC_SITE_URL?.trim();

try {
  const parsed = new URL(publicSiteUrl ?? "");

  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
} catch {
  console.error(
    "Studioをdeployするには、build時のVITE_PUBLIC_SITE_URLへ公開ブログのHTTP(S) URLを指定してください。"
  );
  process.exit(1);
}
