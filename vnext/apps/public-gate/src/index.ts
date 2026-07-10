export default {
  fetch(): Response {
    return new Response("Not Found\n", {
      status: 404,
      headers: {
        "cache-control": "no-store, max-age=0",
        "content-type": "text/plain; charset=utf-8",
        "x-robots-tag": "noindex, nofollow, noarchive"
      }
    });
  }
} satisfies ExportedHandler;
