import { pathToFileURL } from "node:url";
import {
  NOEMA_INDEXNOW_KEY,
  NOEMA_INDEXNOW_KEY_PATH,
  NOEMA_PUBLIC_ORIGIN,
  submitNoemaIndexNow
} from "@noema/content/indexnow";

function decodeXmlText(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&apos;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

export function extractSitemapUrls(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/giu)]
    .map((match) => decodeXmlText(match[1] ?? "").trim())
    .filter(Boolean);
}

export async function verifyPublishedIndexNowKey(
  origin = NOEMA_PUBLIC_ORIGIN,
  fetcher: typeof fetch = fetch
): Promise<void> {
  const keyLocation = new URL(NOEMA_INDEXNOW_KEY_PATH, origin);
  const keyResponse = await fetcher(keyLocation);
  if (!keyResponse.ok || (await keyResponse.text()).trim() !== NOEMA_INDEXNOW_KEY) {
    throw new Error(`indexnow_key_unavailable:${keyResponse.status}`);
  }
}

export async function submitPublicSitemap(
  fetcher: typeof fetch = fetch,
  sitemapOrigin = NOEMA_PUBLIC_ORIGIN
): Promise<{ status: 200 | 202; urlCount: number }> {
  const sitemapUrl = new URL("/sitemap.xml", sitemapOrigin);
  const sitemapResponse = await fetcher(sitemapUrl);
  if (!sitemapResponse.ok) throw new Error(`sitemap_unavailable:${sitemapResponse.status}`);
  const urls = [...new Set(extractSitemapUrls(await sitemapResponse.text()))];
  if (urls.length === 0) throw new RangeError("indexnow_urls_required");

  let status: 200 | 202 = 200;
  let urlCount = 0;
  for (let offset = 0; offset < urls.length; offset += 10_000) {
    const result = await submitNoemaIndexNow(urls.slice(offset, offset + 10_000), fetcher);
    if (result.status === 202) status = 202;
    urlCount += result.urlCount;
  }
  return { status, urlCount };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--verify-key-only")) {
    await verifyPublishedIndexNowKey(process.env.NOEMA_INDEXNOW_KEY_ORIGIN ?? NOEMA_PUBLIC_ORIGIN);
    console.info("Verified the published IndexNow key.");
  } else {
    const result = await submitPublicSitemap(
      fetch,
      process.env.NOEMA_INDEXNOW_SITEMAP_ORIGIN ?? NOEMA_PUBLIC_ORIGIN
    );
    console.info(`IndexNow accepted ${result.urlCount} public URL(s) with status ${result.status}.`);
  }
}
