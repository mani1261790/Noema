import type { APIRoute } from "astro";

const verification = "google-site-verification: google06ce5dd8fb657230.html";

export const GET: APIRoute = () =>
  new Response(verification, {
    headers: {
      "Cache-Control": "public, max-age=3600",
      "Content-Type": "text/html; charset=utf-8",
    },
  });
