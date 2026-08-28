import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const studioCss = readFileSync(new URL("../src/studio.css", import.meta.url), "utf8");
const blogCss = readFileSync(new URL("../../blog/src/styles/blog.css", import.meta.url), "utf8");
const articleCss = readFileSync(new URL("../../../packages/ui/src/styles/article.css", import.meta.url), "utf8");
const officialStylesDirectory = new URL("../../../packages/ui/src/styles/official/", import.meta.url);
const officialCss = readdirSync(officialStylesDirectory)
  .filter((fileName) => fileName.endsWith(".css"))
  .map((fileName) => readFileSync(new URL(fileName, officialStylesDirectory), "utf8"))
  .join("\n");

const focusRulePattern = /[^{}]*:(?:focus-visible|focus-within)[^{}]*\{[^{}]*\}/g;
const forbiddenFocusTreatment = /color-primitive-yellow-300|#ffbf47|outline\s*:[^;]*(?:neutral-black|#000)/;

test("removes the black and yellow focus treatment from every Noema surface", () => {
  for (const css of [studioCss, blogCss, articleCss, officialCss]) {
    const focusRules = css.match(focusRulePattern) ?? [];
    assert.equal(
      focusRules.some((rule) => forbiddenFocusTreatment.test(rule)),
      false
    );
  }
});

test("does not outline headings focused after Studio navigation", () => {
  assert.match(studioCss, /#root \[tabindex="-1"\]:focus\s*\{[^}]*outline:\s*none;/s);
  assert.match(studioCss, /#root :focus-visible\s*\{[^}]*outline:\s*none;/s);
});
