import {
  submitNoemaIndexNow,
  type NoemaIndexNowResult
} from "@noema/content/indexnow";

export async function notifyNoemaIndexNow(urls: readonly string[]): Promise<NoemaIndexNowResult> {
  const result = await submitNoemaIndexNow(urls);
  console.info(JSON.stringify({
    event: "studio.indexnow.submitted",
    status: result.status,
    urlCount: result.urlCount
  }));
  return result;
}

export function logNoemaIndexNowFailure(error: unknown): void {
  console.error(JSON.stringify({
    event: "studio.indexnow.failed",
    message: error instanceof Error ? error.message : String(error)
  }));
}
