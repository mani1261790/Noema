import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const layoutUrl = new URL("../src/layouts/BaseLayout.astro", import.meta.url);
const blogCssUrl = new URL("../src/styles/blog.css", import.meta.url);
const packageJsonUrl = new URL("../package.json", import.meta.url);

test("public pages self-host the configured Noto font families", async () => {
  const [layout, blogCss, packageJsonSource] = await Promise.all([
    readFile(layoutUrl, "utf8"),
    readFile(blogCssUrl, "utf8"),
    readFile(packageJsonUrl, "utf8"),
  ]);
  const packageJson = JSON.parse(packageJsonSource);

  assert.match(layout, /@fontsource-variable\/noto-sans-jp\/wght\.css/u);
  assert.match(layout, /@fontsource-variable\/noto-sans-mono\/wght\.css/u);
  assert.doesNotMatch(layout, /fonts\.(?:googleapis|gstatic)\.com/u);
  assert.match(blogCss, /"Noto Sans JP Variable"/u);
  assert.match(blogCss, /"Noto Sans Mono Variable"/u);
  assert.equal(
    packageJson.dependencies["@fontsource-variable/noto-sans-jp"],
    "^5.3.0",
  );
  assert.equal(
    packageJson.dependencies["@fontsource-variable/noto-sans-mono"],
    "^5.3.0",
  );
});
