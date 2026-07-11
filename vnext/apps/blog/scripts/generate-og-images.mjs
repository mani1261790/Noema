import { readFile, readdir, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import satori from "satori";
import wawoff2 from "wawoff2";
import { parse as parseYaml } from "yaml";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, "..");
const outputDirectory = join(appRoot, "public", "og");
const articleDirectory = join(appRoot, "src", "content", "articles");
const compressedFont = await readFile(join(appRoot, "src", "assets", "fonts", "noto-sans-jp-japanese-700-normal.woff2"));
const fontData = await wawoff2.decompress(compressedFont);

const topicLabels = {
  "conversational-ai": "対話AI",
  "research-organization": "情報検索・整理",
  "generation-creation": "生成・制作",
  "development-environment": "開発環境",
  "data-models": "データとモデル",
  mathematics: "数理"
};

async function renderImage(title, topic) {
  const element = (type, style, children) => ({ type, props: { style, children } });
  const dot = (color) => element("div", { width: 18, height: 18, borderRadius: 9999, background: color });
  const markup = element("div", {
    width: 1200,
    height: 630,
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    padding: "72px 80px",
    background: "#faf9f5",
    color: "#1c2422",
    fontFamily: "Noto Sans JP"
  }, [
    element("div", { display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "3px solid #00645f", paddingBottom: 28 }, [
      element("div", { display: "flex", fontSize: 40, color: "#00645f" }, ["Noema"]),
      element("div", { display: "flex", fontSize: 24, color: "#44504d" }, [String(topic)])
    ]),
    element("div", { display: "flex", alignItems: "center", flex: 1, padding: "44px 0", fontSize: 58, lineHeight: 1.42, letterSpacing: "0.01em" }, [String(title)]),
    element("div", { display: "flex", alignItems: "center", gap: 18, fontSize: 22, color: "#44504d" }, [
      dot("#9a4b00"),
      dot("#00645f"),
      dot("#4355a5"),
      dot("#7a3e87"),
      element("div", { display: "flex", marginLeft: 12 }, ["noema-learn.uk"])
    ])
  ]);
  const svg = await satori(markup, {
    width: 1200,
    height: 630,
    fonts: [{ name: "Noto Sans JP", data: fontData, weight: 700, style: "normal" }]
  });
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function writeImage(filename, title, topic) {
  await writeFile(join(outputDirectory, filename), await renderImage(title, topic));
}

await mkdir(outputDirectory, { recursive: true });
for (const filename of await readdir(outputDirectory)) {
  if (extname(filename) === ".png") await rm(join(outputDirectory, filename));
}

await writeImage("default.png", "「できた」の先に、なぜがある。", "AIと技術を、直感と具体例から");
await writeImage("preview.png", "NotebookLMで自分専用の資料案内役をつくる", "情報検索・整理");

let articleFiles = [];
try {
  articleFiles = (await readdir(articleDirectory, { recursive: true })).filter((file) => file.endsWith(".md"));
} catch {
  articleFiles = [];
}

for (const filename of articleFiles) {
  const source = await readFile(join(articleDirectory, filename), "utf8");
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) continue;
  const data = parseYaml(match[1]);
  if (data?.status !== "published" || !data?.slug || !data?.title) continue;
  const topic = topicLabels[data.topics?.[0]] ?? data.topics?.[0] ?? "Noema";
  await writeImage(`${data.slug}.png`, data.title, topic);
}

console.log(`Generated ${2 + articleFiles.length} OG image candidates.`);
