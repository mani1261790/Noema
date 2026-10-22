# Article discovery and reader AI

## Scope

Preserve Studio editing and publication workflow. Make the published catalog discoverable through diverse homepage entries, factual article-format badges, purpose filters, author-aware multiword search and related-reading context. Replace reader-supplied OpenAI keys with bounded Workers AI article guidance and article questions.

## Behavior

- Homepage offers up to three different reading intents and excludes later series installments. Fresh articles exclude those already featured. Series retain first-article and overview links.
- Cards show up to two derived format badges. Code fences containing data/output alone are not labeled runnable code. No reader ability/difficulty classification is generated.
- Search uses AND across words and selected format filters; supports intent, series, topic, tag, author and date/relevance ordering. URL history and server-rendered pagination work independently of the AI service.
- AI discovery retrieves a bounded candidate set from public publications only; it returns at most three validated candidate IDs with reasons. Publication visibility and metadata are checked again after inference. Unlisted/private drafts are never discovery candidates.
- Article questions retain selected-text context and validated article-heading references, without an API-key input. An article-end button exposes the question panel without requiring text selection.
- Workers AI model: `@cf/qwen/qwen3-30b-a3b-fp8`. Maximum output: 900 tokens; maximum combined prompt: 24,000 characters; upstream timeout: 40 seconds; no automatic retry.
- Default budget: 100 upstream attempts per UTC day, shared across discovery and article questions and any deployments sharing this D1 database. A single atomic D1 upsert reserves usage before inference. Failed upstream calls consume reservations. Configuration accepts 1–200; zero/invalid disables calls. Per-connection short-term limit: 5/minute (Cloudflare location-local rate limiting). This is a request budget, not a currency billing cap.
- Migration `0023_reader_ai_budget.sql` stores only the current day and global request count. No question/answer or reader identifier is persisted by the application. Existing analytics and provider processing are described on the privacy page.
- Builds/local previews disable remote bindings. `NOEMA_REMOTE_AI=1` explicitly enables remote binding integration checks with authorized Cloudflare credentials. Deployment bundles retain the AI binding regardless.

## Verification so far

- Content package: 54 tests; blog: 145 tests plus 37 script tests passed.
- Astro and worker type checks passed; build and Wrangler deploy dry run passed with AI/D1/rate-limit bindings present.
- Browser checked author + full-width/multiword search, feature filter, pagination, back navigation, empty results, unknown filter, AI-unavailable fallback. Normal search remains usable on AI failure.
- Browser additionally verified the article question panel opens directly in question mode, closes, and reports unavailable service; JavaScript-disabled pagination and combined author/keyword search also passed.
- Horizontal overflow checked at 320, 390, 768 and 1160 px; pagination overflow at 320 px fixed.
- Desktop and mobile homepage visually inspected: the first article is visible without scrolling.
- Preview fixture: 50 articles/8 series derived from public HTML, local D1 only. Titles/descriptions/source images match public content; approach values were inferred for preview, so live metadata-based selection needs development verification.

## Outstanding before acceptance

- Inspect final screenshots after all UI changes, including the AI result panel and article question interaction.
- Run real Workers AI inference and inspect Japanese recommendation quality, empty-result behavior and article-grounded answers.
- Verify the development deployment, database migration and CI. Local Cloudflare credentials currently cannot create a remote preview for the configured account; no real upstream success is claimed here.
- Main/production release is outside this change.

## Development verification (2026-10-22)

PR #473 merged into develop as `faeefd4f548f73444c22bf7124476b9cbddd13f6`; final feature CI run 39764622371 passed. Deployment run 39765037949 applied the migration and deployed all three Workers. Its publication parity check matched all 50 public articles; image-dimension validation checked 197 rendered images and 156 unique assets.

Real Workers AI calls on the development site:

- Natural question about plausible AI mistakes: HTTP 200 in 5.9 seconds, first result was the directly relevant published article `why-ai-makes-plausible-mistakes`, followed by related reading with explanations.
- Unrelated Mars probe design question: HTTP 200 in 1.1 seconds, empty article array; no invented result.
- Git vs GitHub article question: HTTP 200 in 2.4 seconds, correct distinction and three valid article-heading references.
- Browser submission also returned the directly relevant article and successfully navigated to it. Actual desktop/mobile homepage and AI result display were inspected.

The deployment's final SEO crawl initially received one transient 503; a subsequent crawl passed page metadata but reported an unreadable series OG image. Both affected resources returned valid responses on direct retrieval. Full crawl revalidation is tracked below rather than treating deployment completion as proof of all checks.

Follow-up: AI guidance is explicitly unavailable with JavaScript disabled (ordinary server search still works), and article answer instructions request plain text because the answer renderer intentionally uses textContent.

### Resource-limit correction

Captured failed crawl responses identify Cloudflare error 1102 (`Worker exceeded resource limits`), so the failures are not accepted as harmless deployment propagation. The feature detector had been building a full Markdown AST for every article on each listing request. On the 50-article / 727,540-byte local fixture, this took approximately 51 ms. A linear structural scanner took approximately 5 ms with identical feature counts (14 code, 9 commands, 9 calculations, 4 math). Additional tests cover longer example fences, tilde fences and multiline math.

RSS, sitemap, series collection/navigation and post-inference visibility rechecks no longer retrieve article bodies unnecessarily. Article lists retain feature detection; individual series/editor cards still receive their feature data. Follow-up deployment must pass the unchanged six-concurrent-request public SEO crawler before acceptance.
