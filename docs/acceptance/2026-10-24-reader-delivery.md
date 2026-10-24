# Reader delivery investigation

## Image 404

Three published Markdown references use `./images/*.svg`, which resolves to `/articles/images/*.svg`. No corresponding files were found in deployed assets, the repository, or Git history. The published alt text specifies the diagrams. Add accessible SVG diagrams matching that specification (VS Code is explicitly a schematic). Keep the existing public URLs so no live article mutation is needed.

Content validation now rejects relative image paths before publication. The deployment image check now checks static/relative same-origin images as well as CMS assets. The older CMS-only checker missed these three references.

## Intermittent 503

Earlier captured error responses (`/tmp/noema-http-failure-*.txt`) contain Cloudflare error 1102, “Worker exceeded resource limits.” The previous task's seven 503 navigations recovered on individual retry. This investigation's pre-change sample (50 browser navigations, then 100 requests at concurrency four) did not reproduce 503; therefore this is not evidence that the current deployment is permanently failing, or that a specific CPU versus memory limit was measured.

The article path unnecessarily parsed the same Markdown three times for metadata and read all 50 article bodies (~728 KB in the public preview fixture) for three related cards. It now shares one metadata parse and selects bodies only for the related cards, after ranking public metadata. No publication cache or visibility delay is introduced.

Local CPU benchmark on the public HTML-derived fixture, 50 articles, five iterations: metadata parsing 155.0 ms before, 51.7 ms after. This is a local processing measurement, not a Cloudflare request CPU metric. The production worker still renders Markdown and math on demand; this change reduces resource pressure rather than increasing account limits.

## Validation

Content and blog tests, Astro/Worker checks and production build are run before release. Live image retrieval and repeated article requests are verified after develop deploy and recorded in the PR.
