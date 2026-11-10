import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePronunciation, pronunciationIdentity, runPronunciationModel, supportsPronunciation } from '../src/lib/pronunciation-model.js';

const pronunciation = { available: true, british: '/ˌɔː.kɪˈstreɪ.ʃən/', american: '/ˌɔːr.kəˈstreɪ.ʃən/', syllables: 'or-ches-tra-tion', explanation: '主重音在 /streɪ/，注意 /eɪ/ 双元音。' };
test('pronunciation accepts words and short English phrases and preserves IPA stress symbols', () => {
  assert(supportsPronunciation('orchestration'));
  assert(supportsPronunciation('machine learning'));
  assert(!supportsPronunciation('编排'));
  assert(!supportsPronunciation('a '.repeat(20)));
  assert.deepEqual(parsePronunciation('```json\n' + JSON.stringify(pronunciation) + '\n```'), pronunciation);
  assert.deepEqual(parsePronunciation('{"available":false,"reason":"无法确认该专名的读音。"}'), { available: false, reason: '无法确认该专名的读音。' });
});
test('malformed and unbounded pronunciation responses are rejected before caching', () => {
  for (const text of ['{', '[]', '{"available":true}', JSON.stringify({ ...pronunciation, british: 'a'.repeat(161) }), JSON.stringify({ ...pronunciation, explanation: 'a'.repeat(701) })]) assert.throws(() => parsePronunciation(text));
});
test('pronunciation caches distinguish context without storing plain URL identifiers in the key', async () => {
  const entry = { text: 'read', targetLanguage: 'zh-CN' }, url = 'https://example.org/article?token=private';
  const first = await pronunciationIdentity(url, entry, 'I read it yesterday.');
  assert.equal(first, await pronunciationIdentity(url, entry, ' I  read it yesterday. '));
  assert.notEqual(first, await pronunciationIdentity(url, entry, 'I read it every day.'));
  assert(!first.includes('private'));
});
test('the pronunciation request uses the supplied summary connection and bounds its JSON output', async () => {
  const requests = [];
  const result = await runPronunciationModel({
    profile: { provider: 'custom', model: 'summary', endpoint: 'http://127.0.0.1/v1/chat/completions', timeoutSeconds: 5 },
    apiKey: 'fake-pronunciation-key', entry: { text: 'orchestration' }, context: 'Workflow orchestration coordinates tasks.',
    fetcher: async (url, options) => {
      requests.push(JSON.parse(options.body));
      assert.equal(options.headers.Authorization, 'Bearer fake-pronunciation-key');
      assert(!options.body.includes('fake-pronunciation-key'));
      const data = 'data: ' + JSON.stringify({ choices: [{ delta: { content: JSON.stringify(pronunciation) } }] }) + '\n\ndata: [DONE]\n\n';
      return new Response(data, { headers: { 'content-type': 'text/event-stream' } });
    }
  });
  assert.deepEqual(result, pronunciation);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].model, 'summary');
  assert.equal(JSON.parse(requests[0].messages[1].content).task, 'pronunciation');
  assert(requests[0].messages[0].content.includes('不确定'));
});
