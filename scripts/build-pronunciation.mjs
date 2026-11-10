// Deliberate dictionary refresh only. Normal builds use the committed shards
// and never contact an external dictionary service.
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';

const source = 'https://raw.githubusercontent.com/open-dict-data/ipa-dict/972cd67dd5f96bc5660e28070cde26e3928abcd7/data/en_US.txt';
const sha256 = '2af6f154a5c363275f052d1f85acedef38ed185ca9745aa4314be77f6b70de67';
const bytes = process.argv[2] ? await fs.readFile(process.argv[2]) : Buffer.from(await (await fetch(source)).arrayBuffer());
if (createHash('sha256').update(bytes).digest('hex') !== sha256) throw new Error('Pronunciation source checksum mismatch');
const shards = new Map(Array.from('abcdefghijklmnopqrstuvwxyz', letter => [letter, Object.create(null)]));
for (const line of bytes.toString('utf8').split(/\r?\n/)) {
  const [raw, ipa] = line.split('\t'), word = raw?.toLowerCase();
  if (!/^[a-z][a-z.'-]*$/.test(word || '') || !ipa || ipa.length > 160) continue;
  if (!ipa.startsWith('/') || !ipa.endsWith('/')) throw new Error(`Invalid IPA for ${word}`);
  const shard = shards.get(word[0]);
  if (Object.hasOwn(shard, word)) throw new Error(`Duplicate pronunciation: ${word}`);
  shard[word] = ipa;
}
// Upstream labels both syllables as primary in this family. Correct only the
// earlier stress to secondary, preserving the source phonemes and variants.
// Reference: https://dictionary.cambridge.org/pronunciation/english/engineer
for (const word of ['engineer', 'engineers', 'engineered', 'engineering']) {
  const shard = shards.get('e');
  if (shard[word]?.startsWith('/ˈ') && shard[word].slice(2).includes('ˈ')) shard[word] = shard[word].replace('/ˈ', '/ˌ');
}
const destination = new URL('../src/data/pronunciation/en-US/', import.meta.url);
await fs.mkdir(destination, { recursive: true });
let entries = 0;
for (const [letter, data] of shards) {
  entries += Object.keys(data).length;
  await fs.writeFile(new URL(`${letter}.json`, destination), JSON.stringify(data) + '\n');
}
await fs.writeFile(new URL('../metadata.json', destination), JSON.stringify({ source, sha256, dialect: 'en-US', entries, format: 'word-to-ipa-v1', shards: 26, corrections: 'Leading stress in the engineer family corrected to secondary; see build-pronunciation.mjs.' }, null, 2) + '\n');
console.log(`Bundled ${entries} American English pronunciations in 26 local shards.`);
