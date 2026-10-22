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
