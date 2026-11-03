import test from 'node:test';
import assert from 'node:assert/strict';
import '../src/lib/page-map.js';
import { cleanPageInfo, cleanPageBlocks, openedPage, patchedPage, PAGE_TTL, MAX_PAGE_BYTES, MAX_PAGE_BLOCKS } from '../src/lib/page-cache.js';

const MapPage = globalThis.ShiyiPageMap;
const info = cleanPageInfo({ mode: 'bilingual', scope: 'page', title: 'Reading' });
function block(locator = '#paragraph', text = 'Original paragraph', values = ['译文'], link = '') {
  const signature = JSON.stringify(['p', '', [['', link, text, false]]]);
  return { locator, signature, key: MapPage.key(locator, signature), values, translation: values.join('') };
}
const record = value => ({ mapping: { key: value.key, locator: value.locator, signature: value.signature }, slots: value.values.map(() => ({})) });

test('page mappings match exact structures and retain separate repeated occurrences', () => {
  const a = block('#a', 'Same word', ['甲']), b = block('#b', 'Same word', ['乙']);
  const first = record(a), second = record(b), result = MapPage.match([first, second], [b, a]);
  assert.equal(result.get(first), a); assert.equal(result.get(second), b);
});
test('a unique unchanged paragraph can move, while ambiguous repeated paragraphs cannot be guessed', () => {
  const a = block('#a'), moved = record(block('#moved'));
  assert.equal(MapPage.match([moved], [a]).get(moved), a);
  assert.equal(MapPage.match([moved], [a, block('#b')]).size, 0);
  assert.equal(MapPage.match([moved, record(block('#other'))], [a]).size, 0);
});
test('source text, hyperlink destinations and semantic structure participate in the mapping', () => {
  const saved = block('#a', 'Open guide', ['打开指南'], MapPage.fingerprint('https://example.test/a'));
  for (const next of [block('#a', 'Open another guide'), block('#a', 'Open guide', ['译文'], MapPage.fingerprint('https://example.test/b'))]) {
    assert.equal(MapPage.match([record(next)], [saved]).size, 0);
  }
  const changed = { ...saved, signature: saved.signature.replace('"p"', '"h2"') };
  changed.key = MapPage.key(changed.locator, changed.signature);
  assert.equal(MapPage.match([record(changed)], [saved]).size, 0);
});
test('mapping validation rejects changed keys, malformed slots, empty translations and wrong counts', () => {
  const value = block(); assert.equal(MapPage.valid(value), true);
  for (const patch of [{ key: 'forged' }, { values: [] }, { values: [''] }, { signature: '{}' }, { values: [7] }, { translation: null }]) assert.equal(MapPage.valid({ ...value, ...patch }), false);
  assert.throws(() => cleanPageBlocks([{ ...value, key: 'forged' }]));
});
test('locked inline code is replaced by placeholders in saved values and never saved in the translation', () => {
  const signature = JSON.stringify(['p', '', [['', '', 'Before ', false], ['code:1', '', '⟦SHIYI_1⟧', true]]]);
  const mapping = { locator: '#a', signature, key: MapPage.key('#a', signature) };
  const saved = MapPage.snapshot({ mapping, slots: [{ locked: false }, { locked: true }], values: ['之前 ', 'PRIVATE_CODE'], translation: '之前 PRIVATE_CODE' });
  assert.deepEqual(saved.values, ['之前 ', '⟦SHIYI_1⟧']); assert.equal(saved.translation, ''); assert.ok(!JSON.stringify(saved).includes('PRIVATE_CODE'));
});
test('page metadata only accepts bounded known modes and selection scopes', () => {
  assert.deepEqual(cleanPageInfo({ ...info, apiKey: 'private', selectionPaths: ['discard'], title: 'a'.repeat(500) }), { ...info, title: 'a'.repeat(240) });
  assert.deepEqual(cleanPageInfo({ mode: 'translation', scope: 'selection', selectionPaths: ['#a', '#a'] }).selectionPaths, ['#a']);
  for (const value of [{ mode: 'invalid' }, { ...info, scope: 'unknown' }, { ...info, scope: 'selection', selectionPaths: ['x'.repeat(4097)] }]) assert.throws(() => cleanPageInfo(value));
});
test('opening a page preserves usable blocks and rotates revision to reject older jobs', () => {
  const first = openedPage('page', null, info, false, 10);
  const saved = patchedPage(first, first.revision, info, [block()], 11);
  const next = openedPage('page', saved, info, false, 12);
  assert.equal(next.blocks.length, 1); assert.notEqual(next.revision, saved.revision);
  assert.equal(patchedPage(next, saved.revision, info, [block('#old')], 13), null);
});
test('retranslation clears old page mappings and retains cache bypass across a partially completed refresh', () => {
  const first = openedPage('page', null, info, false, 10), saved = patchedPage(first, first.revision, info, [block()], 11);
  const fresh = openedPage('page', saved, info, true, 12);
  assert.equal(fresh.blocks.length, 0); assert.equal(fresh.fresh, true);
  const partial = patchedPage(fresh, fresh.revision, { ...info, fresh: true }, [block()], 13);
  assert.equal(openedPage('page', partial, info, false, 14).fresh, true);
  const done = patchedPage(partial, partial.revision, { ...info, fresh: false }, [], 15);
  assert.equal(openedPage('page', done, info, false, 16).fresh, false);
});
test('expired pages cannot be read into a new job or mutated by a late response', () => {
  const first = openedPage('page', null, info, false, 10), saved = patchedPage(first, first.revision, info, [block()], 11);
  assert.equal(patchedPage(saved, saved.revision, info, [], 11 + PAGE_TTL), null);
  assert.equal(openedPage('page', saved, info, false, 12 + PAGE_TTL).blocks.length, 0);
});
test('page writes replace matching blocks and evict oldest mappings under count and byte limits', () => {
  const first = openedPage('page', null, info, false, 10);
  const blocks = Array.from({ length: MAX_PAGE_BLOCKS + 5 }, (_, index) => block('#p' + index));
  const saved = patchedPage(first, first.revision, info, blocks, 11);
  assert.equal(saved.blocks.length, MAX_PAGE_BLOCKS); assert.equal(saved.blocks[0].locator, '#p5');
  const changed = patchedPage(saved, saved.revision, info, [block('#p5', 'Original paragraph', ['新译文'])], 12);
  assert.equal(changed.blocks.length, MAX_PAGE_BLOCKS); assert.equal(changed.blocks.at(-1).translation, '新译文');
  const huge = Array.from({ length: 15 }, (_, i) => block('#large' + i, 'Text', ['大'.repeat(190000)]));
  const bounded = patchedPage(first, first.revision, info, huge, 13);
  assert.ok(bounded.bytes <= MAX_PAGE_BYTES); assert.ok(bounded.blocks.length < huge.length); assert.equal(bounded.blocks.at(-1).locator, '#large14');
});
test('page delta validation strips unrelated fields and rejects oversized input', () => {
  const value = block(); assert.deepEqual(cleanPageBlocks([{ ...value, apiKey: 'private' }]), [value]);
  assert.throws(() => cleanPageBlocks(Array.from({ length: 65 }, () => value)));
  assert.throws(() => cleanPageBlocks(Array.from({ length: 10 }, (_, i) => block('#' + i, 'Text', ['大'.repeat(190000)]))));
});
