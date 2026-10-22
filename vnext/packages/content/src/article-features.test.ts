import { describe, expect, it } from "vitest";
import { detectArticleFeatures, visibleArticleFeatures } from "./article-features";

describe("published article format signals", () => {
  it("distinguishes runnable code and commands from data and output", () => {
    expect(detectArticleFeatures('```python\nprint(1)\n```\n```bash\npwd\n```')).toEqual(["code", "commands"]);
    expect(detectArticleFeatures('```json\n{"code":1}\n```\n```console\nDone!\n```')).toEqual([]);
    expect(detectArticleFeatures('```console\n$ npm install\n```')).toEqual(["commands"]);
  });
  it("recognizes math without treating code examples as article equations", () => {
    expect(detectArticleFeatures('計算は \\(x^2\\) です。')).toEqual(["math"]);
    expect(detectArticleFeatures('$$x = y$$')).toEqual(["math"]);
    expect(detectArticleFeatures('`$x = y$`\n\n```text\n$$x = y$$\n```')).toEqual([]);
  });
  it("shows concrete manual calculation once rather than two overlapping badges", () => {
    const features = detectArticleFeatures('$$x = 2$$', '確率を手計算する');
    expect(features).toEqual(["calculation", "math"]);
    expect(visibleArticleFeatures(features)).toEqual(["calculation"]);
    expect(detectArticleFeatures('', '確率を手計算する')).toEqual([]);
  });
});
