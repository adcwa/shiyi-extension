import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { callModel, makeRequest, parseCompletion } from '../src/lib/model.js';
import { DEFAULT_PREFS } from '../src/lib/core.js';
const profile = { endpoint: 'https://models.example/v1/chat/completions', model: 'a-model', auth: 'bearer', timeoutSeconds: 20 };
const prefs = { ...DEFAULT_PREFS };
const completion = translation => ({ choices: [{ message: { content: JSON.stringify({ translation, sourceLanguage: 'en', kind: 'word' }) } }] });
test('request avoids unnecessary model-specific parameters and omits context by default', () => {
  const request = makeRequest(profile, prefs, 'curiosity', 'private context');
  assert.equal(request.model, 'a-model'); assert.equal(request.stream, false);
  assert.deepEqual(JSON.parse(request.messages[1].content), { text: 'curiosity', targetLanguage: '简体中文' });
  assert.equal(request.temperature, undefined); assert.equal(request.max_tokens, undefined);
  assert.equal(JSON.parse(makeRequest(profile, { ...prefs, includeContext: true }, 'word', 'nearby sentence').messages[1].content).context, 'nearby sentence');
});
test('fenced structured, plain text and text-content-array responses are supported', () => {
  assert.equal(parseCompletion(completion('好奇心'), 'curiosity').translation, '好奇心');
  assert.equal(parseCompletion({ choices: [{ message: { content: '```json\n{"translation":"词义"}\n```' } }] }, 'word').translation, '词义');
  assert.equal(parseCompletion({ choices: [{ message: { content: '自然的译文' } }] }, 'word').translation, '自然的译文');
  assert.equal(parseCompletion({ choices: [{ message: { content: [{ type: 'text', text: '自然的译文' }] } }] }, 'word').translation, '自然的译文');
});
test('empty, incomplete, refused and excessively long completions fail without an entry', () => {
  for (const content of ['', '{broken', '[]', JSON.stringify({ translation: '' }), JSON.stringify({ translation: 'a'.repeat(2001) })]) assert.throws(() => parseCompletion({ choices: [{ message: { content } }] }, 'word'));
  assert.throws(() => parseCompletion({ choices: [{ message: { refusal: 'refused' } }] }, 'word'));
});
test('credentials stay in the Authorization header and errors do not reflect server bodies', async () => {
  let observed;
  const translation = await callModel({ profile, prefs, text: 'curiosity', apiKey: 'fake-fixture-key', fetchImpl: async (url, init) => { observed = init; return new Response(JSON.stringify(completion('好奇心')), { status: 200 }); } });
  assert.equal(translation.translation, '好奇心'); assert.equal(observed.headers.Authorization, 'Bearer fake-fixture-key'); assert.equal(observed.credentials, 'omit'); assert.equal(observed.redirect, 'error'); assert.ok(!observed.body.includes('fake-fixture-key'));
  await assert.rejects(callModel({ profile, prefs, text: 'word', apiKey: 'fixture', fetchImpl: async () => new Response('secret echoed by server', { status: 401 }) }), error => error.code === 'HTTP_401' && !error.message.includes('secret'));
});
test('HTTP errors remain actionable without returning raw upstream data', async () => {
  for (const status of [400, 403, 404, 429, 500]) await assert.rejects(callModel({ profile, prefs, text: 'word', apiKey: 'fixture', fetchImpl: async () => new Response('private upstream data', { status }) }), error => error.code === `HTTP_${status}` && !error.message.includes('private'));
});
test('oversized and non-JSON upstream bodies are rejected', async () => {
  await assert.rejects(callModel({ profile, prefs, text: 'word', apiKey: 'fixture', fetchImpl: async () => new Response('x'.repeat(140000)) }), error => error.code === 'RESULT_TOO_LARGE');
  await assert.rejects(callModel({ profile, prefs, text: 'word', apiKey: 'fixture', fetchImpl: async () => new Response('<html>not API</html>') }), error => error.code === 'INVALID_RESPONSE');
});
test('cancellation and timeouts have distinct outcomes', async () => {
  const waitForAbort = (url, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }));
  const controller = new AbortController();
  const pending = callModel({ profile, prefs, text: 'word', apiKey: 'fixture', signal: controller.signal, fetchImpl: waitForAbort });
  controller.abort(); await assert.rejects(pending, error => error.code === 'CANCELLED');
  await assert.rejects(callModel({ profile: { ...profile, timeoutSeconds: .01 }, prefs, text: 'word', apiKey: 'fixture', fetchImpl: waitForAbort }), error => error.code === 'TIMEOUT');
});
test('real HTTP transport uses a compatible local fixture, with no external provider credentials', async () => {
  let captured, redirects = 0;
  const server = http.createServer(async (request, response) => {
    if (request.url === '/redirect') { response.writeHead(302, { Location: '/target' }); response.end(); return; }
    if (request.url === '/target') { redirects++; response.end(); return; }
    let body = ''; for await (const chunk of request) body += chunk;
    captured = { path: request.url, headers: request.headers, body: JSON.parse(body) };
    response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(completion('好奇心')));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const output = await callModel({ profile: { ...profile, endpoint: base + '/v1/chat/completions' }, prefs, text: 'curiosity', apiKey: 'fake-local-fixture-key' });
    assert.equal(output.translation, '好奇心'); assert.equal(captured.path, '/v1/chat/completions'); assert.equal(captured.headers.authorization, 'Bearer fake-local-fixture-key');
    assert.equal(JSON.parse(captured.body.messages[1].content).text, 'curiosity');
    await assert.rejects(callModel({ profile: { ...profile, endpoint: base + '/redirect' }, prefs, text: 'word', apiKey: 'fixture' })); assert.equal(redirects, 0);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
