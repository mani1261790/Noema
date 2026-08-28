import { ImageResponse } from "@cloudflare/pages-plugin-vercel-og/api";
import type { APIRoute } from "astro";
import { getPublishedSeriesBySlug } from "../../../lib/cms-publications";
import {
  createSeriesOgMarkup,
  SERIES_OG_IMAGE_HEIGHT,
  SERIES_OG_IMAGE_WIDTH,
} from "../../../lib/series-og";

let japaneseFont: Promise<ArrayBuffer> | undefined;

async function loadJapaneseFont(request: Request): Promise<ArrayBuffer> {
  if (!japaneseFont) {
    const fontUrl = new URL("/og/noema-og-japanese-bold.ttf", request.url);
    japaneseFont = fetch(fontUrl).then(async (response) => {
      if (!response.ok) throw new Error(`Series OG font request failed (${response.status}).`);
      return response.arrayBuffer();
    }).catch((error) => {
      japaneseFont = undefined;
      throw error;
    });
  }
  return japaneseFont;
}

function withCacheHeaders(
  response: Response,
  cacheControl = "public, max-age=3600, s-maxage=604800, stale-while-revalidate=86400",
): Response {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", cacheControl);
  headers.set("Content-Type", "image/png");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(response.body, { headers, status: response.status, statusText: response.statusText });
}

export const GET: APIRoute = async ({ params, request }) => {
  const series = params.slug ? await getPublishedSeriesBySlug(params.slug) : null;
  if (!series) {
    return new Response("Series image not found.", {
      headers: { "Cache-Control": "public, max-age=300", "Content-Type": "text/plain; charset=utf-8" },
      status: 404,
    });
  }

  try {
    const fontData = await loadJapaneseFont(request);
    const image = new ImageResponse(createSeriesOgMarkup({
      description: series.description,
      itemCount: series.items.length,
      title: series.title,
    }), {
      fonts: [{ data: fontData, name: "Noto Sans JP", style: "normal", weight: 700 }],
      height: SERIES_OG_IMAGE_HEIGHT,
      width: SERIES_OG_IMAGE_WIDTH,
    }) as unknown as Response;
    return withCacheHeaders(image);
  } catch (error) {
    console.error("Series Open Graph image generation failed.", error);
    const fallback = await fetch(new URL("/og/default.png", request.url));
    return withCacheHeaders(fallback, "no-store");
  }
};
