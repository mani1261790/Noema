import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const publicDir = path.resolve("public");

function ensurePublicDir() {
  fs.mkdirSync(publicDir, { recursive: true });
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc ^= buffer[i];
    for (let j = 0; j < 8; j += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodePng(width, height, pixelAt) {
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 4);
    row[0] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = 1 + x * 4;
      const [r, g, b, a] = pixelAt(x, y);
      row[offset] = r;
      row[offset + 1] = g;
      row[offset + 2] = b;
      row[offset + 3] = a;
    }
    rows.push(row);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", zlib.deflateSync(Buffer.concat(rows), { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function mix(a, b, t) {
  return a + (b - a) * t;
}

function hexToRgb(hex) {
  const clean = hex.replace("#", "");
  return [
    Number.parseInt(clean.slice(0, 2), 16),
    Number.parseInt(clean.slice(2, 4), 16),
    Number.parseInt(clean.slice(4, 6), 16)
  ];
}

function paintIcon(size, { inset = 0.16, background = "#071225" } = {}) {
  const bg0 = hexToRgb(background);
  const bg1 = hexToRgb("#0f3558");
  const glow = hexToRgb("#87d7ff");
  const warm = hexToRgb("#f8b36b");
  const tileA = hexToRgb("#c7edff");
  const tileB = hexToRgb("#79b6d7");
  const tileC = hexToRgb("#4d89b6");
  const radius = size * (0.22 + inset * 0.25);
  const margin = size * inset;
  const tileSize = size - margin * 2;
  const cell = tileSize / 3;

  return encodePng(size, size, (x, y) => {
    const nx = x / (size - 1);
    const ny = y / (size - 1);
    const dx = nx - 0.5;
    const dy = ny - 0.48;
    const radial = clamp01(1 - Math.sqrt(dx * dx + dy * dy) * 1.8);
    const topGlow = clamp01(1 - Math.hypot(nx - 0.22, ny - 0.18) * 2.8);
    const warmGlow = clamp01(1 - Math.hypot(nx - 0.78, ny - 0.2) * 4.2);

    let r = Math.round(mix(bg0[0], bg1[0], ny * 0.85));
    let g = Math.round(mix(bg0[1], bg1[1], nx * 0.7 + ny * 0.2));
    let b = Math.round(mix(bg0[2], bg1[2], radial * 0.7 + 0.2));

    r = Math.round(mix(r, glow[0], topGlow * 0.26));
    g = Math.round(mix(g, glow[1], topGlow * 0.38));
    b = Math.round(mix(b, glow[2], topGlow * 0.45));

    r = Math.round(mix(r, warm[0], warmGlow * 0.2));
    g = Math.round(mix(g, warm[1], warmGlow * 0.12));
    b = Math.round(mix(b, warm[2], warmGlow * 0.08));

    const cx = Math.max(0, Math.min(2, Math.floor((x - margin) / cell)));
    const cy = Math.max(0, Math.min(2, Math.floor((y - margin) / cell)));
    const localX = (x - margin) / cell;
    const localY = (y - margin) / cell;
    const insideTile = x >= margin && x <= size - margin && y >= margin && y <= size - margin;
    const innerPad = 0.12;
    const tileInset = 0.16;
    const tileLocalX = localX - cx;
    const tileLocalY = localY - cy;
    const insideCell =
      insideTile &&
      tileLocalX >= tileInset &&
      tileLocalX <= 1 - tileInset &&
      tileLocalY >= tileInset &&
      tileLocalY <= 1 - tileInset;

    const roundRect =
      insideCell &&
      (() => {
        const rx = (tileLocalX - 0.5) / (0.5 - tileInset);
        const ry = (tileLocalY - 0.5) / (0.5 - tileInset);
        const ax = Math.abs(rx);
        const ay = Math.abs(ry);
        const coreX = Math.max(ax - (1 - innerPad), 0);
        const coreY = Math.max(ay - (1 - innerPad), 0);
        return coreX * coreX + coreY * coreY <= innerPad * innerPad;
      })();

    if (roundRect) {
      const palette = [tileA, tileB, tileC];
      const base = palette[(cx + cy) % palette.length];
      const shade = clamp01(0.4 + (2 - cy) * 0.16 + cx * 0.06 - tileLocalY * 0.18);
      r = Math.round(mix(base[0], 255, shade * 0.2));
      g = Math.round(mix(base[1], 255, shade * 0.14));
      b = Math.round(mix(base[2], 255, shade * 0.08));

      const specular = clamp01(1 - Math.hypot(tileLocalX - 0.34, tileLocalY - 0.28) * 3.4);
      r = Math.round(mix(r, 255, specular * 0.28));
      g = Math.round(mix(g, 255, specular * 0.22));
      b = Math.round(mix(b, 255, specular * 0.18));
    }

    const vignette = clamp01(Math.hypot(nx - 0.5, ny - 0.5) * 1.28);
    r = Math.round(r * (1 - vignette * 0.12));
    g = Math.round(g * (1 - vignette * 0.12));
    b = Math.round(b * (1 - vignette * 0.08));

    return [r, g, b, 255];
  });
}

const iconSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="512" height="512" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="80" y1="52" x2="432" y2="456" gradientUnits="userSpaceOnUse">
      <stop stop-color="#0A1830"/>
      <stop offset="0.55" stop-color="#0E365A"/>
      <stop offset="1" stop-color="#1B5D85"/>
    </linearGradient>
    <radialGradient id="glowA" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(132 116) rotate(52) scale(224)">
      <stop stop-color="#93E3FF" stop-opacity="0.44"/>
      <stop offset="1" stop-color="#93E3FF" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glowB" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(408 124) rotate(136) scale(200)">
      <stop stop-color="#FFB36A" stop-opacity="0.28"/>
      <stop offset="1" stop-color="#FFB36A" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="glassA" x1="166" y1="134" x2="356" y2="348" gradientUnits="userSpaceOnUse">
      <stop stop-color="#F4FBFF"/>
      <stop offset="1" stop-color="#8FC5E1"/>
    </linearGradient>
    <linearGradient id="glassB" x1="178" y1="154" x2="330" y2="326" gradientUnits="userSpaceOnUse">
      <stop stop-color="#BEE4FB"/>
      <stop offset="1" stop-color="#5D96BE"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="120" fill="url(#bg)"/>
  <rect width="512" height="512" rx="120" fill="url(#glowA)"/>
  <rect width="512" height="512" rx="120" fill="url(#glowB)"/>
  <g opacity="0.96">
    <rect x="120" y="118" width="88" height="88" rx="26" fill="url(#glassA)"/>
    <rect x="212" y="118" width="88" height="88" rx="26" fill="url(#glassB)"/>
    <rect x="304" y="118" width="88" height="88" rx="26" fill="url(#glassA)"/>
    <rect x="120" y="212" width="88" height="88" rx="26" fill="url(#glassB)"/>
    <rect x="212" y="212" width="88" height="88" rx="26" fill="url(#glassA)"/>
    <rect x="304" y="212" width="88" height="88" rx="26" fill="url(#glassB)"/>
    <rect x="120" y="306" width="88" height="88" rx="26" fill="url(#glassA)"/>
    <rect x="212" y="306" width="88" height="88" rx="26" fill="url(#glassB)"/>
    <rect x="304" y="306" width="88" height="88" rx="26" fill="url(#glassA)"/>
  </g>
</svg>
`;

const faviconSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="64" height="64" rx="16" fill="#0A1830"/>
  <rect width="64" height="64" rx="16" fill="url(#bg)"/>
  <defs>
    <linearGradient id="bg" x1="10" y1="6" x2="54" y2="58" gradientUnits="userSpaceOnUse">
      <stop stop-color="#15385C"/>
      <stop offset="1" stop-color="#75B7D8"/>
    </linearGradient>
  </defs>
  <g opacity="0.96">
    <rect x="14" y="14" width="10" height="10" rx="3.2" fill="#F4FBFF"/>
    <rect x="27" y="14" width="10" height="10" rx="3.2" fill="#BEE4FB"/>
    <rect x="40" y="14" width="10" height="10" rx="3.2" fill="#F4FBFF"/>
    <rect x="14" y="27" width="10" height="10" rx="3.2" fill="#BEE4FB"/>
    <rect x="27" y="27" width="10" height="10" rx="3.2" fill="#F4FBFF"/>
    <rect x="40" y="27" width="10" height="10" rx="3.2" fill="#BEE4FB"/>
    <rect x="14" y="40" width="10" height="10" rx="3.2" fill="#F4FBFF"/>
    <rect x="27" y="40" width="10" height="10" rx="3.2" fill="#BEE4FB"/>
    <rect x="40" y="40" width="10" height="10" rx="3.2" fill="#F4FBFF"/>
  </g>
</svg>
`;

ensurePublicDir();

fs.writeFileSync(path.join(publicDir, "icon.svg"), iconSvg);
fs.writeFileSync(path.join(publicDir, "favicon.svg"), faviconSvg);
fs.writeFileSync(path.join(publicDir, "icon-192.png"), paintIcon(192, { inset: 0.16 }));
fs.writeFileSync(path.join(publicDir, "icon-512.png"), paintIcon(512, { inset: 0.16 }));
fs.writeFileSync(path.join(publicDir, "icon-maskable-512.png"), paintIcon(512, { inset: 0.08 }));
fs.writeFileSync(path.join(publicDir, "apple-touch-icon.png"), paintIcon(180, { inset: 0.18 }));
