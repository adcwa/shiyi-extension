import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createPronunciationDictionary } from '../src/lib/pronunciation-dictionary.js';

const localFetch = async url => ({ ok: true, json: async () => JSON.parse(await fs.readFile(url, 'utf8')) });
test('bundled dictionary resolves common words and inflections without any model connection', async () => {
  const urls = [], lookup = createPronunciationDictionary({ fetchImpl: async url => { urls.push(url); return localFetch(url); } });
  const [first, second] = await Promise.all([lookup('engineer'), lookup('ENGINEERS')]);
  assert.equal(first.source, 'dictionary');
  assert.match(first.american, /^\/ˌ.*ˈnɪɹ\/$/);
  assert.equal(first.british, '');
  assert(second.american.includes('nɪɹz'));
  assert.equal(urls.length, 1, 'concurrent words with the same initial share their local shard');
  assert(urls.every(url => url.protocol === 'file:' && url.pathname.endsWith('/en-US/e.json')));
  assert((await lookup('orchestration')).american.includes('stɹeɪʃən'));
  const read = await lookup('read');
  assert(read.american.includes('/ˈɹɛd/') && read.american.includes('/ˈɹid/'));
  assert.match(read.explanation, /多个读音/);
});
test('dictionary misses and phrases are explicit and never fabricate a transcription', async () => {
  const lookup = createPronunciationDictionary({ fetchImpl: localFetch });
  for (const value of ['dianyiquuxword', 'hello world', '../passwords', '<script>', '', undefined, '中文']) assert.equal(await lookup(value), null);
  assert((await lookup('isn’t')).american);
});
test('unavailable dictionary data allows a later local retry and does not reach a remote URL', async () => {
  let count = 0;
  const lookup = createPronunciationDictionary({ fetchImpl: async url => {
    assert(url.pathname.endsWith('/en-US/c.json'));
    if (++count === 1) return { ok: false };
    return localFetch(url);
  } });
  await assert.rejects(lookup('cat'), { code: 'LOCAL_PRONUNCIATION_UNAVAILABLE' });
  assert((await lookup('cat')).american.includes('kæt'));
  assert.equal(count, 2);
});
test('all packaged dictionary shards are well formed and match their declared coverage', async () => {
  const base = new URL('../src/data/pronunciation/', import.meta.url);
  const metadata = JSON.parse(await fs.readFile(new URL('metadata.json', base), 'utf8'));
  let entries = 0;
  for (const initial of 'abcdefghijklmnopqrstuvwxyz') {
    const shard = JSON.parse(await fs.readFile(new URL(`en-US/${initial}.json`, base), 'utf8'));
    for (const [word, ipa] of Object.entries(shard)) {
      assert.equal(word[0], initial);
      assert(ipa.length <= 160 && ipa.startsWith('/') && ipa.endsWith('/'), word);
      entries++;
    }
  }
  assert.equal(entries, 125912);
  assert.equal(metadata.entries, entries);
  const license = await fs.readFile(new URL('LICENSES.txt', base), 'utf8');
  for (const author of ['Carnegie Mellon', 'dohliam', 'Lingliang Zhang', 'Kyle Gorman']) assert(license.includes(author));
});
