import { readFile, mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";

const source = await readFile(new URL("../design/app-icon.svg", import.meta.url));
const publicUrl = new URL("../public/", import.meta.url);
const destination = new URL("icons/v2/", publicUrl);
await mkdir(destination, { recursive: true });
// Versioned URLs refresh OS icon caches. RGB exports have no alpha channel,
// while the OS remains responsible for applying its own corner mask.
for (const [name, size] of [["icon-192.png", 192], ["icon-512.png", 512], ["icon-maskable-512.png", 512], ["apple-touch-icon.png", 180]]) {
  const png = await sharp(source).resize(size, size).flatten({ background: "#00645f" }).removeAlpha().png().toBuffer();
  await writeFile(new URL(name, destination), png);
  if (name === "apple-touch-icon.png") {
    // Safari can discover these paths without relying on page metadata.
    await writeFile(new URL("apple-touch-icon.png", publicUrl), png);
    await writeFile(new URL("apple-touch-icon-precomposed.png", publicUrl), png);
    // Avoid a separate icon fetch in the iOS Add to Home Screen sheet.
    await writeFile(new URL("../src/lib/apple-touch-icon.txt", import.meta.url), `data:image/png;base64,${png.toString("base64")}`);
  }
}
