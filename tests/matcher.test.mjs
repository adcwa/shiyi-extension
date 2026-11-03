import test from 'node:test';
import assert from 'node:assert/strict';
import '../src/lib/text.js';
const { find, compile } = globalThis.ShiyiText;
const match = (text, terms) => find(text, compile(terms.map((text, id) => ({ id, text }))));
test('whole word boundaries avoid matching inside a longer word', () => {
  assert.deepEqual(match('art partial ART artist', ['art']).map(m => [m.start, m.end]), [[0, 3], [12, 15]]);
});
test('leftmost longest phrase wins over nested words', () => {
  assert.deepEqual(match('cognitive load and load', ['load', 'cognitive', 'cognitive load']).map(m => m.entry.text), ['cognitive load', 'load']);
});
test('whitespace-normalized phrases retain exact source ranges', () => {
  const text = 'The cognitive\n    load is real.', result = match(text, ['cognitive load']);
  assert.equal(result.length, 1); assert.equal(text.slice(result[0].start, result[0].end), 'cognitive\n    load');
});
test('punctuation, full sentences and CJK do not need artificial spaces', () => {
  assert.equal(match('你好世界你好', ['你好']).length, 2);
  assert.equal(match('Good tools leave room for thought.', ['Good tools leave room for thought.', 'tools']).length, 1);
});
test('Unicode fold expansion preserves offsets', () => {
  const text = '💡 ＡＲＴ and İdea';
  const result = match(text, ['art', 'i̇dea']);
  assert.deepEqual(result.map(m => text.slice(m.start, m.end)), ['ＡＲＴ', 'İdea']);
});
test('emoji and accented text remain addressable', () => {
  const text = 'A café and 😀 are here';
  assert.deepEqual(match(text, ['café', '😀']).map(m => text.slice(m.start, m.end)), ['café', '😀']);
});
test('ten thousand terms can match an article without a giant regular expression', () => {
  const terms = Array.from({ length: 10000 }, (_, i) => ({ id: String(i), text: 'term' + i }));
  const article = 'term9999 partialterm1 term10 '.repeat(500), result = find(article, compile(terms));
  assert.equal(result.length, 1000); assert.equal(result[0].entry.id, '9999');
});
