import { describe, expect, it } from "vitest";
import { inspectImage } from "./image-metadata";

describe("media image validation", () => {
  it("reads PNG dimensions from verified file bytes", () => {
    const bytes = new Uint8Array(45);
    bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
    new DataView(bytes.buffer).setUint32(8, 13);
    bytes.set(new TextEncoder().encode("IHDR"), 12);
    new DataView(bytes.buffer).setUint32(16, 320);
    new DataView(bytes.buffer).setUint32(20, 180);
    bytes.set(new TextEncoder().encode("IEND"), 37);
    expect(inspectImage(bytes)).toEqual({ mimeType: "image/png", extension: "png", width: 320, height: 180 });
  });

  it("reads JPEG start-of-frame dimensions", () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x01, 0x2c, 0x02, 0x80, 0x03, 0x01, 0x11, 0x00, 0xff, 0xd9]);
    expect(inspectImage(bytes)).toMatchObject({ mimeType: "image/jpeg", width: 640, height: 300 });
  });

  it("reads lossless WebP dimensions", () => {
    const bytes = new Uint8Array(30); bytes.set(new TextEncoder().encode("RIFF"), 0); new DataView(bytes.buffer).setUint32(4, 22, true); bytes.set(new TextEncoder().encode("WEBP"), 8); bytes.set(new TextEncoder().encode("VP8L"), 12); new DataView(bytes.buffer).setUint32(16, 5, true); bytes[20] = 0x2f;
    const width = 400; const height = 225; const bits = (width - 1) | ((height - 1) << 14); bytes[21] = bits & 0xff; bytes[22] = (bits >>> 8) & 0xff; bytes[23] = (bits >>> 16) & 0xff; bytes[24] = (bits >>> 24) & 0xff;
    expect(inspectImage(bytes)).toMatchObject({ mimeType: "image/webp", width, height });
  });

  it("does not trust a filename or declared content type", () => {
    expect(() => inspectImage(new TextEncoder().encode("not really an image"))).toThrow(/Only PNG, JPEG, and WebP/);
  });

  it("rejects corrupt supported image signatures", () => {
    expect(() => inspectImage(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toThrow(/JPEG file is corrupt/);
  });
});
