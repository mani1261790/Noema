import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const stylesheet = readFileSync(new URL("../src/studio.css", import.meta.url), "utf8");

test("narrow review layouts share the page scroll between the article and controls", () => {
  assert.match(
    stylesheet,
    /@media \(max-width: 640px\)[\s\S]*\.studio-workspace\.is-review-workspace \.studio-editor \{[\s\S]*height: auto;[\s\S]*overflow: visible;[\s\S]*grid-template-rows: auto;/u
  );
  assert.match(
    stylesheet,
    /\.studio-workspace\.is-review-workspace \.studio-writing-layout,[\s\S]*\.studio-workspace\.is-review-workspace \.studio-live-preview \{[\s\S]*height: auto;[\s\S]*overflow: visible;/u
  );
});

test("the narrow review article toggle stays above the article without covering it", () => {
  assert.match(
    stylesheet,
    /\.studio-workspace\.is-review-workspace \.studio-writing-controls \{[\s\S]*position: static;[\s\S]*justify-content: flex-end;/u
  );
  assert.match(
    stylesheet,
    /\.studio-workspace\.is-review-workspace \.studio-preview-toggle \{[\s\S]*min-height: 44px;/u
  );
  assert.match(
    stylesheet,
    /\.studio-workspace\.is-review-workspace \.studio-preview-toggle\[aria-pressed="true"\] \{[\s\S]*color: #fff;[\s\S]*background: var\(--color-key-900\);/u
  );
});
