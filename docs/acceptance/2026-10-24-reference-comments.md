# Reference comments and duplicate-section warnings

- Optional `sources[].comment` is plain text, trimmed at schema validation, bounded to 1,000 characters. Existing references without comments remain valid. No database migration or existing-article rewrite is needed.
- Studio supports editing and read-only review display; browser draft restoration preserves comments. Shared reader/Studio rendering escapes comments and preserves line breaks. Markdown export/import round-trips comments.
- Shared Markdown validation emits `reference-heading` warnings with source lines for actual headings containing `参考`. Inline formatting and Setext headings are supported; code fences and ordinary paragraphs do not trigger it. No body section is automatically removed.
- Studio displays nonblocking warnings in reference settings, input checks and the review panel. Clicking the review warning selects the heading in the Markdown editor.
- MCP tool instructions recommend `frontmatter.sources` and optional comments instead of duplicate lists. Validate/preview/create/update responses include `warnings`; `issues` and `valid` retain their blocking-error semantics.

Validation: content 60 tests, CMS 9 tests, Studio 237 worker/Vitest tests plus Node suite, MCP 28 tests passed. Studio/MCP/blog type checks and Studio/blog builds passed. MCP integration test verifies valid-with-warning responses and comment persistence on create/update. Shared tests cover HTML escaping, export/import, optional/oversized comments, heading line detection and code-fence exclusions. Browser draft test covers restoration.

Local Chromium at 1160px and 390px with an intercepted CMS session and a synthetic local draft: comment edit updates preview, no document horizontal overflow on mobile, review warning selects exactly `## 参考にした資料` at line 5. No real CMS article was created, changed or published for browser testing. Physical-device verification not performed.
