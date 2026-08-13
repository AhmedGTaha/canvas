import { deflateRawSync } from "node:zlib";
import { assertSafeExportPath } from "./naming";

export type ExportFile = { path: string; contents: Uint8Array };

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Minimal deterministic ZIP writer (deflate, no external dependency). Entry order and
 * timestamps are fixed so the same project always produces the same archive bytes.
 */
export class ZipPackager {
  pack(files: ExportFile[]) {
    const entries = [...files].sort((a, b) => a.path.localeCompare(b.path));
    const seen = new Set<string>();
    const locals: Buffer[] = []; const central: Buffer[] = [];
    let offset = 0;

    for (const entry of entries) {
      const path = assertSafeExportPath(entry.path);
      if (seen.has(path)) throw new Error(`Duplicate export path: ${path}`);
      seen.add(path);
      const name = Buffer.from(path, "utf8");
      const raw = Buffer.from(entry.contents);
      const deflated = deflateRawSync(raw, { level: 9 });
      const stored = deflated.length < raw.length;
      const body = stored ? deflated : raw;
      const method = stored ? 8 : 0;
      const crc = crc32(raw);

      const localHeader = Buffer.alloc(30);
      localHeader.writeUInt32LE(0x04034b50, 0);
      localHeader.writeUInt16LE(20, 4); localHeader.writeUInt16LE(0x0800, 6);
      localHeader.writeUInt16LE(method, 8); localHeader.writeUInt16LE(0, 10); localHeader.writeUInt16LE(0x0021, 12);
      localHeader.writeUInt32LE(crc, 14); localHeader.writeUInt32LE(body.length, 18); localHeader.writeUInt32LE(raw.length, 22);
      localHeader.writeUInt16LE(name.length, 26); localHeader.writeUInt16LE(0, 28);
      locals.push(localHeader, name, body);

      const centralHeader = Buffer.alloc(46);
      centralHeader.writeUInt32LE(0x02014b50, 0);
      centralHeader.writeUInt16LE(20, 4); centralHeader.writeUInt16LE(20, 6); centralHeader.writeUInt16LE(0x0800, 8);
      centralHeader.writeUInt16LE(method, 10); centralHeader.writeUInt16LE(0, 12); centralHeader.writeUInt16LE(0x0021, 14);
      centralHeader.writeUInt32LE(crc, 16); centralHeader.writeUInt32LE(body.length, 20); centralHeader.writeUInt32LE(raw.length, 24);
      centralHeader.writeUInt16LE(name.length, 28); centralHeader.writeUInt16LE(0, 30); centralHeader.writeUInt16LE(0, 32);
      centralHeader.writeUInt16LE(0, 34); centralHeader.writeUInt16LE(0, 36); centralHeader.writeUInt32LE(0, 38);
      centralHeader.writeUInt32LE(offset, 42);
      central.push(centralHeader, name);
      offset += localHeader.length + name.length + body.length;
    }

    const centralBuffer = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6);
    end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(centralBuffer.length, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(0, 20);
    return Buffer.concat([...locals, centralBuffer, end]);
  }
}
