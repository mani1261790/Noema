export const NOEMA_PUBLIC_ORIGIN = "https://noema-learn.uk";
export const NOEMA_INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
export const NOEMA_INDEXNOW_KEY = "f1af5e83c536073292fb9103ce6ac661";
export const NOEMA_INDEXNOW_KEY_PATH = `/${NOEMA_INDEXNOW_KEY}.txt`;

export interface NoemaPublicationSnapshot {
  publicationStatus: string;
  publishedSlug: string | null;
  publishedVisibility: string | null;
  topics: readonly string[];
}

export interface NoemaIndexNowSubmission {
  host: string;
  key: string;
  keyLocation: string;
  urlList: string[];
}

export interface NoemaIndexNowResult {
  status: 200 | 202;
  urlCount: number;
}

function isPublic(snapshot: NoemaPublicationSnapshot): boolean {
  return snapshot.publicationStatus === "published" &&
    snapshot.publishedVisibility === "public" &&
    Boolean(snapshot.publishedSlug);
}

function absoluteNoemaUrl(pathname: string): string {
  return new URL(pathname, NOEMA_PUBLIC_ORIGIN).toString();
}

export function noemaIndexNowUrlsForPublicationChange(
  before: NoemaPublicationSnapshot,
  after: NoemaPublicationSnapshot
): string[] {
  const publicSnapshots = [before, after].filter(isPublic);
  if (publicSnapshots.length === 0) return [];

  const urls = new Set([
    absoluteNoemaUrl("/"),
    absoluteNoemaUrl("/articles/"),
    absoluteNoemaUrl("/sitemap.xml")
  ]);
  for (const snapshot of publicSnapshots) {
    urls.add(absoluteNoemaUrl(`/articles/${snapshot.publishedSlug}/`));
    for (const topic of snapshot.topics) {
      urls.add(absoluteNoemaUrl(`/topics/${topic}/`));
    }
  }
  return [...urls];
}

export function createNoemaIndexNowSubmission(urls: readonly string[]): NoemaIndexNowSubmission {
  const origin = new URL(NOEMA_PUBLIC_ORIGIN);
  const normalized = [...new Set(urls.map((value) => new URL(value).toString()))];
  if (normalized.length === 0) throw new RangeError("indexnow_urls_required");
  if (normalized.length > 10_000) throw new RangeError("indexnow_url_limit_exceeded");
  for (const url of normalized) {
    const parsed = new URL(url);
    if (parsed.protocol !== origin.protocol || parsed.host !== origin.host) {
      throw new RangeError("indexnow_url_outside_noema");
    }
  }
  return {
    host: origin.host,
    key: NOEMA_INDEXNOW_KEY,
    keyLocation: absoluteNoemaUrl(NOEMA_INDEXNOW_KEY_PATH),
    urlList: normalized
  };
}

export async function submitNoemaIndexNow(
  urls: readonly string[],
  fetcher: typeof fetch = fetch
): Promise<NoemaIndexNowResult> {
  const submission = createNoemaIndexNowSubmission(urls);
  const response = await fetcher(NOEMA_INDEXNOW_ENDPOINT, {
    body: JSON.stringify(submission),
    headers: { "content-type": "application/json; charset=utf-8" },
    method: "POST"
  });
  if (response.status !== 200 && response.status !== 202) {
    throw new Error(`indexnow_submission_failed:${response.status}`);
  }
  return { status: response.status, urlCount: submission.urlList.length };
}
