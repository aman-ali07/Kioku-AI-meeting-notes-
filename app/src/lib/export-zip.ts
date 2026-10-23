import { crc32 } from "node:zlib";

/**
 * Minimal ZIP writer — STORE method only (no compression).
 *
 * WHY hand-rolled instead of a dependency (archiver etc.): full archive
 * compression buys nothing here — the audio blob dominates the zip and audio
 * (PCM/lossy containers) is already compressed — so a store-only archive is
 * ~60 lines with zero supply-chain surface. CRC comes from zlib.crc32
 * (Node ≥ 20.15; our 24.22). Round-trip-proved with `python3 -m zipfile -t`
 * in TESTING.md — don't extend this with compression without the same proof.
 */

export interface ZipEntry {
  /** Fixed ASCII names only (transcript.txt, metadata.json, audio.<ext>) —
   *  never user-supplied text; that keeps UTF-8-flag/name-encoding edge
   *  cases out of this tiny writer. */
  name: string;
  data: Buffer;
  /** DOS date/time OR-ed fields; a fixed floor date is deterministic and fine. */
  dosDate?: { date: number; time: number };
}

// DOS timestamps floor: 1980-01-01, 06:00 (the format's minimum encodable;
// year in bits 15–9 counting from 1980, month in bits 8–5 (1–12), day 4–0).
const FALLBACK_DOS = { date: (44 << 9) | (1 << 5) | 1, time: 6 << 11 };

export function writeZip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centralOffsets: number[] = [];
  let pos = 0;

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, "utf8");
    const crc = crc32(entry.data);

    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed: 1.1 (stored, fixed sizes)
    local.writeUInt16LE(0x0800, 6); // flags: UTF-8 name encoding
    local.writeUInt16LE(0, 8); // method 0 = store
    local.writeUInt16LE(entry.dosDate?.time ?? FALLBACK_DOS.time, 10);
    local.writeUInt16LE(entry.dosDate?.date ?? FALLBACK_DOS.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(entry.data.length, 18); // compressed size (== stored)
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28); // no extra field
    nameBytes.copy(local, 30);

    centralOffsets.push(pos);
    locals.push(local, entry.data);
    pos += local.length + entry.data.length;
  }

  const central: Buffer[] = [];
  let centralSize = 0;
  entries.forEach((entry, index) => {
    const nameBytes = Buffer.from(entry.name, "utf8");
    const record = Buffer.alloc(46 + nameBytes.length);
    record.writeUInt32LE(0x02014b50, 0); // central directory signature
    record.writeUInt16LE(20, 4); // version made by
    record.writeUInt16LE(20, 6); // version needed
    record.writeUInt16LE(0x0800, 8); // UTF-8 flag
    record.writeUInt16LE(0, 10); // method store
    record.writeUInt16LE(entry.dosDate?.time ?? FALLBACK_DOS.time, 12);
    record.writeUInt16LE(entry.dosDate?.date ?? FALLBACK_DOS.date, 14);
    record.writeUInt32LE(crc32(entry.data), 16);
    record.writeUInt32LE(entry.data.length, 20);
    record.writeUInt32LE(entry.data.length, 24);
    record.writeUInt16LE(nameBytes.length, 28);
    record.writeUInt16LE(0, 30); // extra len
    record.writeUInt16LE(0, 32); // comment len
    record.writeUInt16LE(0, 34); // disk number start
    record.writeUInt16LE(0, 36); // internal attrs
    record.writeUInt32LE(0, 38); // external attrs
    record.writeUInt32LE(centralOffsets[index]!, 42); // local header offset
    nameBytes.copy(record, 46);
    central.push(record);
    centralSize += record.length;
  });

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // end-of-central-directory signature
  eocd.writeUInt16LE(0, 4); // this disk
  eocd.writeUInt16LE(0, 6); // central dir disk
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(pos, 16); // central directory offset (== data length)
  eocd.writeUInt16LE(0, 20); // no comment

  return Buffer.concat([...locals, ...central, eocd]);
}
