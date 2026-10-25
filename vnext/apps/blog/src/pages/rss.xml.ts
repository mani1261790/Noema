import type { APIRoute } from "astro";
export const GET: APIRoute = () => new Response("RSSの配信は終了しました。新着記事のプッシュ通知は https://noema-learn.uk/updates から登録できます。", {
  status: 410, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" },
});
