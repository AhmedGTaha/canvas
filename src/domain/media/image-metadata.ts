import { DomainError } from "@/domain/shared/errors";

export type SupportedImage = { mimeType: "image/png" | "image/jpeg" | "image/webp"; extension: "png" | "jpg" | "webp"; width: number; height: number };

function positive(width: number, height: number, details: Omit<SupportedImage, "width" | "height">): SupportedImage {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) throw new DomainError("VALIDATION", "The image dimensions are invalid.");
  return { ...details, width, height };
}

function png(bytes: Uint8Array) {
  if (bytes.length < 8 || ![137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 45 || view.getUint32(8) !== 13 || String.fromCharCode(...bytes.slice(12, 16)) !== "IHDR") throw new DomainError("VALIDATION", "The PNG file is corrupt.");
  let offset = 8; let ended = false;
  while (offset + 12 <= bytes.length) { const length = view.getUint32(offset); const end = offset + 12 + length; if (end > bytes.length) break; if (String.fromCharCode(...bytes.slice(offset + 4, offset + 8)) === "IEND") { ended = length === 0; break; } offset = end; }
  if (!ended) throw new DomainError("VALIDATION", "The PNG file is corrupt.");
  return positive(view.getUint32(16), view.getUint32(20), { mimeType: "image/png", extension: "png" });
}

function jpeg(bytes: Uint8Array) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  const sof = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  while (offset + 3 < bytes.length) {
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === undefined || marker === 0xd9 || marker === 0xda) break;
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    const length = ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
    if (length < 2 || offset + length > bytes.length) break;
    if (sof.has(marker) && length >= 7) {
      if (bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) throw new DomainError("VALIDATION", "The JPEG file is corrupt or has no readable dimensions.");
      return positive(((bytes[offset + 5] ?? 0) << 8) | (bytes[offset + 6] ?? 0), ((bytes[offset + 3] ?? 0) << 8) | (bytes[offset + 4] ?? 0), { mimeType: "image/jpeg", extension: "jpg" });
    }
    offset += length;
  }
  throw new DomainError("VALIDATION", "The JPEG file is corrupt or has no readable dimensions.");
}

function webp(bytes: Uint8Array) {
  const ascii = (start: number, value: string) => [...value].every((char, index) => bytes[start + index] === char.charCodeAt(0));
  if (bytes.length < 30 || !ascii(0, "RIFF") || !ascii(8, "WEBP")) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const declaredSize = view.getUint32(4, true) + 8; const chunkSize = view.getUint32(16, true);
  if (declaredSize > bytes.length || 20 + chunkSize > bytes.length) throw new DomainError("VALIDATION", "The WebP file is corrupt or unsupported.");
  if (ascii(12, "VP8X")) return positive(1 + (bytes[24]! | bytes[25]! << 8 | bytes[26]! << 16), 1 + (bytes[27]! | bytes[28]! << 8 | bytes[29]! << 16), { mimeType: "image/webp", extension: "webp" });
  if (ascii(12, "VP8 ") && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) return positive((bytes[26]! | bytes[27]! << 8) & 0x3fff, (bytes[28]! | bytes[29]! << 8) & 0x3fff, { mimeType: "image/webp", extension: "webp" });
  if (ascii(12, "VP8L") && bytes[20] === 0x2f) {
    const bits = (bytes[21]! | bytes[22]! << 8 | bytes[23]! << 16 | bytes[24]! << 24) >>> 0;
    return positive((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1, { mimeType: "image/webp", extension: "webp" });
  }
  throw new DomainError("VALIDATION", "The WebP file is corrupt or unsupported.");
}

export function inspectImage(bytes: Uint8Array): SupportedImage {
  if (bytes.length === 0) throw new DomainError("VALIDATION", "The uploaded file is empty.");
  const result = png(bytes) ?? jpeg(bytes) ?? webp(bytes);
  if (!result) throw new DomainError("VALIDATION", "Only PNG, JPEG, and WebP images are supported.");
  return result;
}
