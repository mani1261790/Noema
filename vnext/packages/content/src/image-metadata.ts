export const supportedImageContentTypes = [
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type SupportedImageContentType = (typeof supportedImageContentTypes)[number];

export interface ImageDimensions {
  height: number;
  width: number;
}

export interface ImageMetadata extends ImageDimensions {
  contentType: SupportedImageContentType;
}

const MAX_IMAGE_DIMENSION = 100_000;

export function readImageMetadata(
  bytes: Uint8Array,
  expectedContentType?: SupportedImageContentType,
): ImageMetadata | null {
  const metadata = readPng(bytes) ?? readGif(bytes) ?? readJpeg(bytes) ?? readWebp(bytes);
  if (!metadata || (expectedContentType && metadata.contentType !== expectedContentType)) return null;
  if (!validDimension(metadata.width) || !validDimension(metadata.height)) return null;
  return metadata;
}

function readPng(bytes: Uint8Array): ImageMetadata | null {
  if (
    bytes.byteLength < 33 ||
    !startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) ||
    readBigEndianUint32(bytes, 8) !== 13 ||
    ascii(bytes, 12, 4) !== "IHDR" ||
    !endsWith(bytes, [0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82])
  ) return null;
  return {
    contentType: "image/png",
    height: readBigEndianUint32(bytes, 20),
    width: readBigEndianUint32(bytes, 16),
  };
}

function readGif(bytes: Uint8Array): ImageMetadata | null {
  if (
    bytes.byteLength < 14 ||
    !["GIF87a", "GIF89a"].includes(ascii(bytes, 0, 6)) ||
    bytes.lastIndexOf(0x3b) < 13
  ) return null;
  return {
    contentType: "image/gif",
    height: readLittleEndianUint16(bytes, 8),
    width: readLittleEndianUint16(bytes, 6),
  };
}

function readJpeg(bytes: Uint8Array): ImageMetadata | null {
  if (
    bytes.byteLength < 11 ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8 ||
    !hasJpegEndMarker(bytes)
  ) return null;

  let offset = 2;
  while (offset < bytes.byteLength) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    if (marker === undefined || marker === 0xd9 || marker === 0xda) break;
    offset += 1;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (offset + 2 > bytes.byteLength) return null;
    const segmentLength = readBigEndianUint16(bytes, offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.byteLength) return null;
    if (isStartOfFrame(marker)) {
      if (segmentLength < 7) return null;
      return {
        contentType: "image/jpeg",
        height: readBigEndianUint16(bytes, offset + 3),
        width: readBigEndianUint16(bytes, offset + 5),
      };
    }
    offset += segmentLength;
  }
  return null;
}

function readWebp(bytes: Uint8Array): ImageMetadata | null {
  if (
    bytes.byteLength < 30 ||
    ascii(bytes, 0, 4) !== "RIFF" ||
    ascii(bytes, 8, 4) !== "WEBP" ||
    readLittleEndianUint32(bytes, 4) !== bytes.byteLength - 8
  ) return null;

  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const chunkType = ascii(bytes, offset, 4);
    const chunkSize = readLittleEndianUint32(bytes, offset + 4);
    const payload = offset + 8;
    if (payload + chunkSize > bytes.byteLength) return null;

    if (chunkType === "VP8X" && chunkSize >= 10) {
      return {
        contentType: "image/webp",
        height: 1 + readLittleEndianUint24(bytes, payload + 7),
        width: 1 + readLittleEndianUint24(bytes, payload + 4),
      };
    }
    if (
      chunkType === "VP8 " && chunkSize >= 10 &&
      bytes[payload + 3] === 0x9d && bytes[payload + 4] === 0x01 && bytes[payload + 5] === 0x2a
    ) {
      return {
        contentType: "image/webp",
        height: readLittleEndianUint16(bytes, payload + 8) & 0x3fff,
        width: readLittleEndianUint16(bytes, payload + 6) & 0x3fff,
      };
    }
    if (chunkType === "VP8L" && chunkSize >= 5 && bytes[payload] === 0x2f) {
      const first = bytes[payload + 1] ?? 0;
      const second = bytes[payload + 2] ?? 0;
      const third = bytes[payload + 3] ?? 0;
      const fourth = bytes[payload + 4] ?? 0;
      return {
        contentType: "image/webp",
        height: 1 + ((fourth & 0x0f) << 10 | third << 2 | second >> 6),
        width: 1 + ((second & 0x3f) << 8 | first),
      };
    }
    offset = payload + chunkSize + (chunkSize % 2);
  }
  return null;
}

function isStartOfFrame(marker: number): boolean {
  return [
    0xc0, 0xc1, 0xc2, 0xc3,
    0xc5, 0xc6, 0xc7,
    0xc9, 0xca, 0xcb,
    0xcd, 0xce, 0xcf,
  ].includes(marker);
}

function hasJpegEndMarker(bytes: Uint8Array): boolean {
  for (let index = bytes.byteLength - 2; index >= 2; index -= 1) {
    if (bytes[index] === 0xff && bytes[index + 1] === 0xd9) return true;
  }
  return false;
}

function validDimension(value: number): boolean {
  return Number.isInteger(value) && value > 0 && value <= MAX_IMAGE_DIMENSION;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

function endsWith(bytes: Uint8Array, signature: number[]): boolean {
  const offset = bytes.byteLength - signature.length;
  return offset >= 0 && signature.every((value, index) => bytes[offset + index] === value);
}

function readBigEndianUint16(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

function readBigEndianUint32(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] ?? 0) * 0x1000000 +
    ((bytes[offset + 1] ?? 0) << 16) +
    ((bytes[offset + 2] ?? 0) << 8) +
    (bytes[offset + 3] ?? 0)
  ) >>> 0;
}

function readLittleEndianUint16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function readLittleEndianUint24(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] ?? 0) |
    ((bytes[offset + 1] ?? 0) << 8) |
    ((bytes[offset + 2] ?? 0) << 16)
  ) >>> 0;
}

function readLittleEndianUint32(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] ?? 0) +
    (bytes[offset + 1] ?? 0) * 0x100 +
    (bytes[offset + 2] ?? 0) * 0x10000 +
    (bytes[offset + 3] ?? 0) * 0x1000000
  ) >>> 0;
}
