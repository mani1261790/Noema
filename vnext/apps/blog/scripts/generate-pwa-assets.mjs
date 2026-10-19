import { readFile, mkdir } from "node:fs/promises";
import sharp from "sharp";

const source = await readFile(new URL("../design/app-icon.svg", import.meta.url));
const destination = new URL("../public/icons/", import.meta.url);
await mkdir(destination, { recursive: true });
// Opaque, full-bleed exports: the OS applies its own corner or circular mask.
for (const [name, size] of [["icon-192.png", 192], ["icon-512.png", 512], ["icon-maskable-512.png", 512], ["apple-touch-icon.png", 180]]) {
  await sharp(source).resize(size, size).png().toFile(new URL(name, destination).pathname);
}
