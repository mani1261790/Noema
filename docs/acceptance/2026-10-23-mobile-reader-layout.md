# Mobile reader layout

## Design

Keep reading titles and parent navigation visible. Auxiliary context uses native disclosures rather than fixed heights or clipped article text. Series name and position remain visible; the series description and full list open together. Article dates, reading time and tags remain available in a keyboard-operable disclosure, including without JavaScript.

Mobile article headers, outcomes, series navigation, cards and RSS notices use smaller spacing. List thumbnails no longer squeeze long titles into a narrow column on phones. Series landing pages show articles before sharing controls; their rows prioritize the complete title over a repeated excerpt. The repeated current-article breadcrumb remains available to assistive technology without occupying several visual lines. Article body content and figures are not truncated.

## Local verification

- Chromium: home, search, series index, series detail, series article, topic, about, updates and install at widths 320 / 390 / 430 / 768 / 1160 (45 page/width combinations): HTTP 200, no document horizontal overflow.
- 390px series introduction: 366px on development before the change, 136px in the local preview afterward. RSS notice: 308px to 179px.
- Series links, current article marker, metadata and TOC disclosures; keyboard Enter and JavaScript-disabled operation verified. Mobile menu search returns author results; article AI panel opens and closes.
- Content: 55 tests passed. Blog: 147 Vitest tests and 37 script tests passed. Astro/Worker type checks, production build and Wrangler dry run passed.
- Local preview uses a copy of the public-content fixture database, not remote content changes. Screenshots under untracked output/playwright/. Heights of fixture article outcomes are not identical to live content.
- Astro's dev dependency optimizer fails on the pre-existing binary font import after the tooling upgrade. Verification used the successful production build served by Wrangler locally.

## Release verification

Develop deployment and live mobile checks are recorded in the pull request after merging. Physical iPhone/Safari testing is not claimed by the Chromium viewport checks.
