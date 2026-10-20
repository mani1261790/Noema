# Noema app icon

The existing deep teal and N remain the identity. The new N is a folded sheet:
warm paper on the front, mint on the turned face, with a restrained fold and shadow.
The mark stays inside the central maskable safe circle (radius 204.8 at 512 px).
Full-bleed, opaque exports allow each OS to apply its own mask without white corners.
The favicon uses a simplified silhouette to stay legible at 16 px.

- Source: `app-icon.svg` (hand-authored vector; no generated bitmap dependency).
- Preview: open `icon-preview.html` in a browser for square, circular, and small-size review.
- Regenerate: from `vnext`, run `pnpm --filter @noema/blog generate:pwa`.
- Outputs: `public/icons/` (192, 512, maskable 512, Apple touch 180).

## PWA behavior

`/install` provides browser-specific instructions and a native installation button
when the browser emits `beforeinstallprompt`. The manifest uses a stable `/` ID.
The worker is registered only in production builds, including local Wrangler previews,
so it cannot interfere with the Astro development server. `/sw.js` caches only `/offline` (the canonical Cloudflare Assets URL for
`offline.html`). HTML-extension URLs redirect and must not be used as the cached
navigation fallback. Articles, API responses, previews, and chat are not cached.
Network HTTP errors are preserved; only a failed navigation gets the offline screen.
Update the `noema-offline-v*` cache version when changing the offline screen. The
worker waits for old tabs to close before activating an update.

## Verification

- Blog tests, Astro/worker type checks, and production build.
- In the production build served by local Wrangler, inspect the manifest and
  service worker, disconnect the browser, navigate to an article, and reconnect.
- Verify iOS home-screen launch and Android installation on actual devices before
  claiming device acceptance. Desktop browser emulation is not that verification.
