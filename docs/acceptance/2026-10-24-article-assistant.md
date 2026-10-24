# Article assistant UI and usage audit

Target: develop, public reader. No Studio editing workflow changes.

## Reproduced fault

On the deployed reader in WebKit at 320px, the panel was 320px wide but its form was 432px and composer 400px. The panel's overflow clipping hid the right-hand controls without increasing document width. Missing minimum-width constraints on nested flex items caused this.

## Changes

- Short `AIに質問` entry with explicit pointer cursor, consistent inverse hover colors and visible focus.
- Constrain the flex form to the panel width. Mobile uses a full-width dialog with VisualViewport height/offset and safe-area padding; desktop retains the resizable side panel.
- Mobile opening focuses the close button, avoiding an immediate software keyboard. Tab stays in the mobile dialog, Escape restores the opener, and answer references close it and focus the article heading.
- Conversation scrolls independently; long unbroken output wraps. Usage/privacy disclosure keeps the composer compact.
- Mobile Enter inserts a newline. Pending submissions reject further submit events; the draft and conversation cannot be cleared mid-request. Fetch has a 45-second timeout.
- API 429 responses include Retry-After; daily exhaustion explains the UTC midnight / JST 09:00 reset. Missing database binding or invalid limit configuration fails closed.

## Existing usage controls, verified

Both `/api/chat` and `/api/discover` call the same provider gate:

- Configured daily limit: 100 upstream calls, shared across both features. An atomic D1 INSERT/UPDATE/RETURNING on one `reader` row reserves the call before AI invocation. Failed upstream calls remain counted. Invalid configuration fails closed; code rejects configured limits above 200.
- Configured burst limit: 5 per 60 seconds per connecting IP. Cloudflare rate-limit bindings are approximate and local to each edge location; this is not the strict cost boundary. D1 is the global daily boundary.
- Body <=32 KiB, combined system/user input <=24,000 characters, output <=900 tokens, upstream timeout 40 seconds, no automatic upstream retry. Chat history is capped at six turns of 500 characters each, question and selection at 1,000 each.
- The limit bounds these reader AI calls, not the Cloudflare account's total bill or use by other applications. Anonymous visitors can consume the shared allowance; there is no authenticated per-person entitlement.

Reference: https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/#accuracy

## Verification

- Blog check (Astro + Worker types), build, 152 Vitest tests and 38 Node tests passed locally.
- Provider-boundary tests mock AI: rate/daily rejection, database failure, invalid config, oversized input invoke no AI. Success passes the token cap; provider failure is not retried. SQLite counter test admits exactly 100/105 attempts and tests reset/late previous-day requests.
- Chromium and WebKit: 320x640, 390x740, 740x390, 1160x810, empty/long-response/429 states. Checked actual inner form/control bounds and panel scrollWidth, not only document overflow. Two extra submit events during an in-flight request still made one request.
- Additional browser checks: hover colors, pointer cursor, focus wrapping/restoration, mobile Enter newline, answer reference navigation, 390x360 viewport reduction and 200% text at 320px. Responses were intercepted with service workers blocked; no paid inference was needed.
- No physical iPhone/real software-keyboard verification. Browser viewport reduction verifies layout adaptation, not real-device keyboard behavior.
