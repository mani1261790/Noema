import { describe, expect, it } from "vitest";
import { readImageMetadata } from "./image-metadata";

function png(width: number, height: number): Uint8Array {
  return Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    width >>> 24, width >>> 16, width >>> 8, width,
    height >>> 24, height >>> 16, height >>> 8, height,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
}

describe("readImageMetadata", () => {
  it("reads PNG and checks the declared content type", () => {
    expect(readImageMetadata(png(1200, 675), "image/png")).toEqual({
      contentType: "image/png",
      height: 675,
      width: 1200,
    });
    expect(readImageMetadata(png(1200, 675), "image/jpeg")).toBeNull();
  });

  it("reads GIF dimensions", () => {
    const bytes = Uint8Array.from([
      ...new TextEncoder().encode("GIF89a"),
      0x20, 0x03, 0x58, 0x02,
      0x00, 0x00, 0x00, 0x3b,
    ]);
    expect(readImageMetadata(bytes)).toEqual({
      contentType: "image/gif",
      height: 600,
      width: 800,
    });
  });

  it("reads JPEG start-of-frame dimensions", () => {
    const bytes = Uint8Array.from([
      0xff, 0xd8,
      0xff, 0xe0, 0x00, 0x02,
      0xff, 0xc2, 0x00, 0x07, 0x08, 0x02, 0x58, 0x03, 0x20,
      0xff, 0xd9,
    ]);
    expect(readImageMetadata(bytes)).toEqual({
      contentType: "image/jpeg",
      height: 600,
      width: 800,
    });
  });

  it("reads extended WebP dimensions", () => {
    const bytes = Uint8Array.from([
      ...new TextEncoder().encode("RIFF"),
      0x16, 0x00, 0x00, 0x00,
      ...new TextEncoder().encode("WEBPVP8X"),
      0x0a, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
      0x1f, 0x03, 0x00,
      0x57, 0x02, 0x00,
    ]);
    expect(readImageMetadata(bytes)).toEqual({
      contentType: "image/webp",
      height: 600,
      width: 800,
    });
  });

  it("rejects truncated, zero-sized, and hostile image headers", () => {
    expect(readImageMetadata(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(readImageMetadata(png(0, 1))).toBeNull();
    expect(readImageMetadata(png(100_001, 1))).toBeNull();
  });
});
