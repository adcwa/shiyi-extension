import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PREFS, cleanProfile } from '../src/lib/core.js';
import { callModel, makeRequest } from '../src/lib/model.js';
import { frameMT, unframeMT } from '../src/lib/qwen-mt.js';
import { PROVIDERS } from '../src/lib/providers.js';
import '../src/lib/text.js';

const profile = { ...cleanProfile({ provider: 'qwen' }), auth: 'none' };
const response = text => new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
const translated = text => text.replaceAll('Hello', '你好').replaceAll('World', '世界').replaceAll('Other', '其他');

test('Qwen defaults to native qwen-mt-flash, keeps generic alternatives and sends a single raw user message', () => {
  assert.equal(profile.model, 'qwen-mt-flash'); assert.ok(PROVIDERS.qwen.models.includes('qwen-flash'));
  const body = makeRequest(profile, DEFAULT_PREFS, 'Hello');
  assert.deepEqual(body.messages, [{ role: 'user', content: 'Hello' }]);
  assert.deepEqual([body.translation_options.source_lang, body.translation_options.target_lang], ['auto', 'Chinese']);
  assert.equal(body.enable_thinking, undefined); assert.equal(body.response_format, undefined);
});
test('native MT maps all supported target languages and keeps opted-in context outside the source text', () => {
  for (const [targetLanguage, expected] of Object.entries({ 'zh-CN': 'Chinese', en: 'English', ja: 'Japanese', ko: 'Korean', fr: 'French', de: 'German', es: 'Spanish' })) {
    const body = makeRequest(profile, { ...DEFAULT_PREFS, targetLanguage }, 'Hello', 'PRIVATE_CONTEXT');
    assert.equal(body.translation_options.target_lang, expected); assert.ok(!JSON.stringify(body).includes('PRIVATE_CONTEXT'));
  }
  const body = makeRequest(profile, { ...DEFAULT_PREFS, includeContext: true, style: 'custom', customPrompt: 'Translate {{text}} to {{targetLanguage}} for engineers.' }, 'Hello', 'Useful context');
  assert.match(body.messages[0].content, /Hello/); assert.match(body.messages[0].content, /engineers/); assert.match(body.messages[0].content, /Useful context/);
  const chinese = makeRequest(profile, { ...DEFAULT_PREFS, style: 'custom', customPrompt: '用专业术语翻译 {{text}}。' }, 'Hello');
  assert.match(chinese.messages[0].content, /专业术语/); assert.ok(!/\p{Script=Han}/u.test(chinese.translation_options.domains));
});
test('native MT word translation accepts plain text and keeps credentials out of request bodies', async () => {
  const result = await callModel({ profile: { ...profile, auth: 'bearer' }, prefs: DEFAULT_PREFS, text: 'Hello', apiKey: 'isolated-unit-key', fetchImpl: async (url, options) => {
    const body = JSON.parse(options.body); assert.equal(body.messages.length, 1); assert.equal(body.messages[0].content, 'Hello');
    assert.ok(!options.body.includes('isolated-unit-key')); assert.equal(options.headers.Authorization, 'Bearer isolated-unit-key');
    assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error'); return response('你好');
  } });
  assert.equal(result.translation, '你好'); assert.equal(result.kind, 'word');
});
test('protected native frames use IDs, accept reordered fragments and reject missing, duplicate or extra boundaries', () => {
  const frame = frameMT([{ text: 'Hello' }, { text: 'World' }], 'test');
  assert.deepEqual(unframeMT(`${frame.tokens[1]}\n世界\n${frame.tokens[0]}\n你好\n${frame.end}`, frame), ['你好', '世界']);
  for (const value of [`${frame.tokens[0]}你好${frame.end}`, `${frame.tokens[0]}你好${frame.tokens[0]}重复${frame.tokens[1]}世界${frame.end}`, `extra${frame.text}`, `${frame.text}extra`]) assert.throws(() => unframeMT(value, frame));
});
test('native MT batches aligned fragments, deduplicates text and skips whitespace, numbers and protected code tokens', async () => {
  const calls = [];
  const blocks = [{ id: 'b1', parts: [{ id: 'p0', text: 'Hello' }, { id: 'p1', text: 'World' }, { id: 'p2', text: '⟦SHIYI_2⟧' }] }, { id: 'b2', parts: [{ id: 'p0', text: 'Hello' }, { id: 'p1', text: '3' }, { id: 'p2', text: ' ' }] }];
  const result = await callModel({ profile, prefs: DEFAULT_PREFS, blocks, fetchImpl: async (url, options) => { const body = JSON.parse(options.body); calls.push(body); assert.ok(body.translation_options.terms.every(term => term.source === term.target)); return response(translated(body.messages[0].content)); } });
  assert.equal(calls.length, 1); assert.ok(!calls[0].messages[0].content.includes('SHIYI'));
  assert.deepEqual(result.results.map(item => item.output.parts.map(part => part.text)), [['你好', '世界', '⟦SHIYI_2⟧'], ['你好', '3', ' ']]);
});
test('lost native framing falls back to bounded independent translations with exact original IDs', async () => {
  const calls = [];
  const result = await callModel({ profile, prefs: DEFAULT_PREFS, blocks: [{ id: 'b1', parts: [{ id: 'p1', text: 'Hello' }] }, { id: 'b2', parts: [{ id: 'p2', text: 'World' }] }], fetchImpl: async (url, options) => {
    const body = JSON.parse(options.body), text = body.messages[0].content; calls.push(text); return response(body.translation_options.terms ? 'No markers' : translated(text));
  } });
  assert.equal(calls.length, 3); assert.deepEqual(result.results.map(item => [item.id, item.output.parts[0].id, item.output.translation]), [['b1', 'p1', '你好'], ['b2', 'p2', '世界']]);
});
test('one empty native fallback result only fails its own block, while authentication errors never auto-retry', async () => {
  const blocks = [{ id: 'good', parts: [{ id: 'p0', text: 'Hello' }] }, { id: 'bad', parts: [{ id: 'p0', text: 'Bad' }] }];
  const result = await callModel({ profile, prefs: DEFAULT_PREFS, blocks, fetchImpl: async (url, options) => {
    const body = JSON.parse(options.body); return response(body.translation_options.terms ? 'missing markers' : body.messages[0].content === 'Bad' ? '' : '你好');
  } });
  assert.equal(result.results[0].output.translation, '你好'); assert.ok(result.results[1].error);
  let requests = 0;
  await assert.rejects(callModel({ profile, prefs: DEFAULT_PREFS, blocks, fetchImpl: async () => { requests++; return new Response('', { status: 401 }); } }), error => error.code === 'HTTP_401');
  assert.equal(requests, 1);
});
test('simultaneous native jobs share a two-request ceiling', async () => {
  let active = 0, peak = 0;
  await Promise.all(Array.from({ length: 5 }, (_, index) => callModel({ profile, prefs: DEFAULT_PREFS, text: `Hello ${index}`, fetchImpl: async () => {
    active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 10)); active--; return response('你好');
  } })));
  assert.equal(peak, 2);
});
test('native input packs obey fragment and character bounds instead of forwarding unbounded UI batches', async () => {
  const blocks = Array.from({ length: 64 }, (_, i) => ({ id: 'b' + i, parts: [{ id: 'p0', text: 'Hello ' + i + ' ' + 'x'.repeat(170) }] }));
  let requests = 0;
  const result = await callModel({ profile, prefs: DEFAULT_PREFS, blocks, fetchImpl: async (url, options) => {
    requests++; const body = JSON.parse(options.body); assert.ok(body.translation_options.terms.length <= 33); assert.ok(body.messages[0].content.length < 7000); return response(translated(body.messages[0].content));
  } });
  assert.ok(requests > 1); assert.ok(result.results.every(item => item.output));
});
test('Chinese detection accepts native prose and technical names, and remains conservative around foreign text', () => {
  const native = globalThis.ShiyiText.isTargetLanguage;
  for (const text of ['项目设置', '中文内容不需要重复显示。', '使用 OpenAI API 进行开发', '连接 qwen-mt-flash 模型', '请填写 API Key', '价格 2026 元 ✅']) assert.equal(native(text, 'zh-CN'), true, text);
  for (const text of ['Hello world', 'Translate 中文 to English', '日本語を読みます', '한국어 번역', 'Read 中文', '中文说明：Read guide']) assert.equal(native(text, 'zh-CN'), false, text);
  assert.equal(native('日本語', 'zh-CN', 'ja'), false); assert.equal(native('中文内容', 'en'), false);
});
test('native network failures and timeouts stop the whole call without per-fragment request storms', async () => {
  const blocks = [{ id: 'b1', parts: [{ id: 'p0', text: 'Hello' }, { id: 'p1', text: 'World' }] }];
  let requests = 0;
  await assert.rejects(callModel({ profile, prefs: DEFAULT_PREFS, blocks, fetchImpl: async () => { requests++; throw new TypeError('network'); } }), error => error.code === 'NETWORK');
  assert.equal(requests, 1);
  await assert.rejects(callModel({ profile: { ...profile, timeoutSeconds: .01 }, prefs: DEFAULT_PREFS, blocks, fetchImpl: (url, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('abort', 'AbortError')), { once: true })) }), error => error.code === 'TIMEOUT');
});
test('a canceled native job waiting for a shared request slot never sends its source', async () => {
  const release = []; let requests = 0;
  const fetchImpl = async () => { requests++; await new Promise(resolve => release.push(resolve)); return response('你好'); };
  const jobs = [callModel({ profile, prefs: DEFAULT_PREFS, text: 'Hello', fetchImpl }), callModel({ profile, prefs: DEFAULT_PREFS, text: 'World', fetchImpl })];
  await new Promise(resolve => setTimeout(resolve, 0));
  const controller = new AbortController(), queued = callModel({ profile, prefs: DEFAULT_PREFS, text: 'Other', fetchImpl, signal: controller.signal });
  controller.abort(); await assert.rejects(queued, error => error.code === 'CANCELLED'); assert.equal(requests, 2);
  release.forEach(resolve => resolve()); await Promise.all(jobs);
});
