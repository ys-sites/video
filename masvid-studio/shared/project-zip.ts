import { crc32, inflateRawSync } from 'node:zlib';
import { PROJECT_ARCHIVE_LIMITS as limits } from './project-archive.ts';
import { unsafePortableSegment } from './project-name.ts';

/** Inspect central and local records before accepting bytes; never extract paths with a shell. */
export function readProjectZip(data: Buffer): Map<string, Buffer> {
  const fail = () => { throw new Error('INVALID_PROJECT_ARCHIVE: Invalid or unsupported ZIP'); };
  if (data.length > limits.bytes || data.length < 22) return fail();
  let end = data.length - 22;
  for (; end >= Math.max(0, data.length - 65557); end--) {
    if (data.readUInt32LE(end) === 0x06054b50 && end + 22 + data.readUInt16LE(end + 20) === data.length) break;
  }
  if (end < 0 || data.readUInt32LE(end) !== 0x06054b50) return fail();
  const count = data.readUInt16LE(end + 10), size = data.readUInt32LE(end + 12), start = data.readUInt32LE(end + 16);
  if (data.readUInt32LE(end + 4) || data.readUInt16LE(end + 8) !== count || count > limits.files + 1000 || start + size !== end) return fail();
  const files = new Map<string, Buffer>(), names = new Set<string>(), ranges: [number, number][] = [];
  let offset = start, expanded = 0;
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || data.readUInt32LE(offset) !== 0x02014b50) return fail();
    const flags = data.readUInt16LE(offset + 8), method = data.readUInt16LE(offset + 10), crc = data.readUInt32LE(offset + 16);
    const compressed = data.readUInt32LE(offset + 20), bytes = data.readUInt32LE(offset + 24);
    const nameLength = data.readUInt16LE(offset + 28), extra = data.readUInt16LE(offset + 30), comment = data.readUInt16LE(offset + 32);
    const mode = data.readUInt32LE(offset + 38) >>> 16, local = data.readUInt32LE(offset + 42);
    if ((flags & ~(method === 8 ? 0x80e : 0x808)) || ![0, 8].includes(method) || data.readUInt16LE(offset + 34) || ![0, 0x8000, 0x4000].includes(mode & 0xf000)) return fail();
    if (offset + 46 + nameLength + extra + comment > end || local + 30 > start) return fail();
    const rawName = data.subarray(offset + 46, offset + 46 + nameLength);
    const name = new TextDecoder('utf-8', { fatal: true }).decode(rawName);
    const clean = name.endsWith('/') ? name.slice(0, -1) : name;
    if (!clean || clean.length > 400 || /[\\:\x00-\x1f\x7f]/.test(clean) || clean.split('/').some(p => !p || p === '.' || p === '..' || unsafePortableSegment(p))) return fail();
    const key = clean.normalize('NFC').toLowerCase();
    if (names.has(key)) return fail(); names.add(key);
    if (data.readUInt32LE(local) !== 0x04034b50 || data.readUInt16LE(local + 6) !== flags || data.readUInt16LE(local + 8) !== method) return fail();
    const localNameLength = data.readUInt16LE(local + 26), localExtra = data.readUInt16LE(local + 28);
    const payload = local + 30 + localNameLength + localExtra;
    if (payload + compressed > start || !data.subarray(local + 30, local + 30 + localNameLength).equals(rawName)) return fail();
    if (!(flags & 8) && (data.readUInt32LE(local + 14) !== crc || data.readUInt32LE(local + 18) !== compressed || data.readUInt32LE(local + 22) !== bytes)) return fail();
    ranges.push([local, payload + compressed]);
    expanded += bytes;
    if (expanded > limits.bytes) throw new Error('PROJECT_ARCHIVE_TOO_LARGE: Expanded content exceeds 500 MB');
    const packed = data.subarray(payload, payload + compressed);
    const unpacked = method === 0 ? packed : inflateRawSync(packed, { maxOutputLength: Math.max(1, bytes) });
    if (unpacked.length !== bytes || crc32(unpacked) !== crc || name.endsWith('/') && bytes !== 0) return fail();
    if (!name.endsWith('/')) files.set(name, unpacked);
    offset += 46 + nameLength + extra + comment;
  }
  if (offset !== end || files.size > limits.files) return fail();
  ranges.sort((a, b) => a[0] - b[0]);
  if (ranges.some((range, i) => i > 0 && range[0] < ranges[i - 1][1])) return fail();
  const fileNames = new Set([...files.keys()].map(name => name.normalize('NFC').toLowerCase()));
  for (const name of files.keys()) {
    const parts = name.split('/'); parts.pop();
    while (parts.length) { if (fileNames.has(parts.join('/').normalize('NFC').toLowerCase())) return fail(); parts.pop(); }
  }
  return files;
}
