import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, deflateRawSync } from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const destination = path.join(root, 'releases', `dianyi-${pkg.version}`);
await fs.mkdir(destination, { recursive: true });
await fs.cp(path.join(root, 'src'), destination, { recursive: true, filter: source => !path.relative(path.join(root, 'src'), source).split(path.sep).some(part => part === '__pycache__' || part.startsWith('.')) && !source.endsWith('.pyc') });
await fs.copyFile(path.join(root, 'docs/user-guide.md'), path.join(destination, 'INSTALL.md'));
await fs.copyFile(path.join(root, 'docs/user-guide.html'), path.join(destination, 'INSTALL.html'));
for (const name of ['provider-defaults', 'summary-guide', 'knowledge-guide', 'model-library-guide', 'verification', 'qwen-access-diagnosis', 'inline-structure', 'annotation-stability', 'compact-layout', 'block-reading', 'architecture'].flatMap(name => [name + '.md', name + '.html'])) await fs.copyFile(path.join(root, 'docs', name), path.join(destination, name));
await fs.copyFile(path.join(root, 'docs', 'codex-setup.md'), path.join(destination, 'codex-setup.md'));
const manifest = JSON.parse(await fs.readFile(path.join(destination, 'manifest.json'), 'utf8'));
if (manifest.version !== pkg.version) throw new Error('Manifest version does not match package version');
if (!manifest.key) throw new Error('New installations require the committed public identity key');

const table = Array.from({ length: 256 }, (_, i) => { for (let k = 0; k < 8; k++) i = i & 1 ? 0xedb88320 ^ (i >>> 1) : i >>> 1; return i >>> 0; });
const crc = bytes => { let value = 0xffffffff; for (const byte of bytes) value = table[(value ^ byte) & 255] ^ (value >>> 8); return (value ^ 0xffffffff) >>> 0; };
function chunk(type, data) { const name = Buffer.from(type), size = Buffer.alloc(4), sum = Buffer.alloc(4); size.writeUInt32BE(data.length); sum.writeUInt32BE(crc(Buffer.concat([name, data]))); return Buffer.concat([size, name, data, sum]); }
const lines = [[5,10,5,3],[5,3,10,7],[10,7,14,7],[14,7,19,3],[19,3,19,10],[5,10,4,14],[4,14,6,19],[6,19,12,21],[12,21,18,19],[18,19,20,14],[20,14,19,10],[8,12,9,12],[15,12,16,12],[11,16,12,17],[12,17,13,16]];
function distance(x, y, [x1, y1, x2, y2]) { const dx = x2 - x1, dy = y2 - y1, t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy))); return Math.hypot(x - x1 - t * dx, y - y1 - t * dy); }
function makeIcon(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
      const nx = (x + (sx + .5) / 4) / size * 24, ny = (y + (sy + .5) / 4) / size * 24;
      const cx = Math.max(5, Math.min(19, nx)), cy = Math.max(5, Math.min(19, ny));
      if (Math.hypot(nx - cx, ny - cy) > 5) continue;
      const white = lines.some(line => distance(nx, ny, line) < .85);
      r += white ? 255 : 0; g += white ? 255 : 102; b += white ? 255 : 101; a++;
    }
    const offset = y * (size * 4 + 1) + x * 4 + 1;
    if (a) { raw[offset] = Math.round(r / a); raw[offset + 1] = Math.round(g / a); raw[offset + 2] = Math.round(b / a); raw[offset + 3] = Math.round(a / 16 * 255); }
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
await fs.mkdir(path.join(destination, 'icons'), { recursive: true });
for (const size of [16, 32, 48, 128]) await fs.writeFile(path.join(destination, 'icons', `icon${size}.png`), makeIcon(size));
async function filesUnder(directory) {
  const out = [];
  for (const item of await fs.readdir(directory, { withFileTypes: true })) {
    if (item.name.startsWith('.')) continue;
    const full = path.join(directory, item.name);
    if (item.isDirectory()) out.push(...await filesUnder(full)); else if (item.isFile()) out.push(full);
  }
  return out.sort();
}
// ZIP is generated without downloading a build tool or bundling test fixtures.
const archiveDate = ((2026 - 1980) << 9) | (11 << 5) | 3;
const files = await filesUnder(destination);
async function packageFiles(rewrite = (_name, bytes) => bytes) {
  const locals = [], central = []; let offset = 0;
  for (const full of files) {
    const filename = path.relative(destination, full).split(path.sep).join('/'), name = Buffer.from(filename), raw = rewrite(filename, await fs.readFile(full)), packed = deflateRawSync(raw), checksum = crc(raw);
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6); header.writeUInt16LE(8, 8); header.writeUInt16LE(archiveDate, 12); header.writeUInt32LE(checksum, 14); header.writeUInt32LE(packed.length, 18); header.writeUInt32LE(raw.length, 22); header.writeUInt16LE(name.length, 26);
    locals.push(header, name, packed);
    const record = Buffer.alloc(46); record.writeUInt32LE(0x02014b50); record.writeUInt16LE((3 << 8) | 20, 4); record.writeUInt16LE(20, 6); record.writeUInt16LE(0x800, 8); record.writeUInt16LE(8, 10); record.writeUInt16LE(archiveDate, 14); record.writeUInt32LE(checksum, 16); record.writeUInt32LE(packed.length, 20); record.writeUInt32LE(raw.length, 24); record.writeUInt16LE(name.length, 28); record.writeUInt32LE(((await fs.stat(full)).mode << 16) >>> 0, 38); record.writeUInt32LE(offset, 42); central.push(record, name);
    offset += header.length + name.length + packed.length;
  }
  const centralData = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(centralData.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralData, end]);
}
const zip = path.join(root, 'releases', `dianyi-chrome-edge-${pkg.version}.zip`); await fs.writeFile(zip, await packageFiles());
// Store identities are assigned by the existing Web Store item. The public key
// is exclusively for stable unpacked installs and must not be uploaded there.
const storeManifest = { ...manifest }; delete storeManifest.key;
const storeZip = path.join(root, 'releases', `dianyi-chrome-web-store-${pkg.version}.zip`);
await fs.writeFile(storeZip, await packageFiles((name, bytes) => name === 'manifest.json' ? Buffer.from(JSON.stringify(storeManifest, null, 2) + '\n') : bytes));
// Keep the legacy unpacked path as an install/test compatibility alias.
await fs.cp(destination, path.join(root, 'releases', `shiyi-${pkg.version}`), { recursive: true });
// Existing keyless installations must retain their original path-derived ID.
// New installs use the public manifest key and keep their ID across directories.
const fixed = path.join(root, 'releases', 'dianyi');
let previous = null;
try { previous = JSON.parse(await fs.readFile(path.join(fixed, 'manifest.json'), 'utf8')); } catch(error) { if(error.code!=='ENOENT')throw error; }
await fs.cp(destination, fixed, { recursive: true });
if(previous){const retained={...manifest};if(previous.key)retained.key=previous.key;else delete retained.key;await fs.writeFile(path.join(fixed,'manifest.json'),JSON.stringify(retained,null,2)+'\n');}
console.log(`Built ${files.length} production files\nUnpacked: ${destination}\nPackage: ${zip}\nChrome Web Store: ${storeZip}`);
