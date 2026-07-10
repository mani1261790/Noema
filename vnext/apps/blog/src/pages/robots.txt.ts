import type { APIRoute } from "astro";

export const prerender = true;

export const GET: APIRoute = ({ site }) => {
  const base = site ?? new URL("https://noema-learn.uk");
  return new Response(`User-agent: *\nAllow: /\nDisallow: /preview/\nSitemap: ${new URL("sitemap.xml", base)}\n`, {
    headers: { "content-type": "text/plain; charset=utf-8" }
  });
};
