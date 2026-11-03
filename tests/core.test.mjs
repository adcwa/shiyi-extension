import test from 'node:test';
import assert from 'node:assert/strict';
import { modelEndpoint, cleanProfile, cleanPrefs, DEFAULT_PREFS, siteOrigin, permissionPattern, pageOrigin, safeSource, entryIdentity, secretInput, exportEntry } from '../src/lib/core.js';
test('model endpoint accepts a base or full compatible endpoint without duplication', () => {
  assert.equal(modelEndpoint('https://models.example/v1/'), 'https://models.example/v1/chat/completions');
  assert.equal(modelEndpoint('https://models.example/chat/completions/'), 'https://models.example/chat/completions');
  assert.equal(modelEndpoint('https://models.example'), 'https://models.example/chat/completions');
});
test('remote plaintext, credentials and query-based secrets are rejected', () => {
  for (const url of ['http://models.example/v1', 'https://user:secret@models.example/v1', 'https://models.example/v1?key=secret', 'https://models.example/v1#secret', 'file:///etc/passwd', 'javascript:alert(1)']) assert.throws(() => modelEndpoint(url));
});
test('local model endpoints support IPv4, localhost and IPv6', () => {
  for (const url of ['http://localhost:11434/v1', 'http://127.0.0.1:11434/v1', 'http://[::1]:11434/v1']) assert.match(modelEndpoint(url), /chat\/completions$/);
});
test('model configuration only persists known fields and sane timeout', () => {
  const profile = cleanProfile({ endpoint: 'https://models.example/v1', model: 'my-model', name: 'Reading', timeoutSeconds: 20, apiKey: 'never-include' });
  assert.equal(profile.apiKey, undefined); assert.equal(profile.rememberKey, false);
  assert.throws(() => cleanProfile({ ...profile, timeoutSeconds: 60 }));
  assert.throws(() => cleanProfile({ ...profile, auth: 'custom-headers' }));
});
test('preference validation requires valid language, mode and nonempty custom style', () => {
  assert.deepEqual(cleanPrefs(DEFAULT_PREFS), DEFAULT_PREFS);
  for (const patch of [{ targetLanguage: 'unknown' }, { displayMode: 'html' }, { style: 'custom', customPrompt: ' ' }, { customPrompt: 'a'.repeat(4001) }]) assert.throws(() => cleanPrefs({ ...DEFAULT_PREFS, ...patch }));
});
test('reading preferences default legacy configurations to 16 blocks and normalize safe hex colors', () => {
  const { batchSize, translationColorLight, translationColorDark, ...legacy } = DEFAULT_PREFS;
  assert.deepEqual(cleanPrefs(legacy), DEFAULT_PREFS);
  assert.equal(cleanPrefs({ ...DEFAULT_PREFS, batchSize: '64', translationColorLight: '#1D4ED8' }).batchSize, 64);
  assert.equal(cleanPrefs({ ...DEFAULT_PREFS, translationColorLight: '#1D4ED8' }).translationColorLight, '#1d4ed8');
  for (const patch of [{ batchSize: 0 }, { batchSize: 65 }, { batchSize: 1.5 }, { batchSize: '' }, { translationColorLight: 'red' }, { translationColorDark: '#fff' }, { translationColorLight: '#112233; background:url(x)' }]) assert.throws(() => cleanPrefs({ ...DEFAULT_PREFS, ...patch }), error => error.code === 'INVALID_INPUT');
});
test('website rules use exact origins including ports, without silently granting subdomains', () => {
  assert.equal(siteOrigin('Read.Example.com'), 'https://read.example.com');
  assert.equal(siteOrigin('http://localhost:9080'), 'http://localhost:9080');
  assert.equal(permissionPattern('http://localhost:9080/path'), 'http://localhost/*');
  for (const url of ['https://read.example/path', '-bad..example', 'chrome://extensions', 'https://user:pass@example.com', 'https://chromewebstore.google.com']) assert.throws(() => siteOrigin(url));
  assert.equal(pageOrigin('chrome://extensions'), null);
});
test('source addresses and exports strip query strings and credentials', () => {
  const source = safeSource('https://u:p@read.example/article?token=private#section', 'Example');
  assert.equal(source.url, 'https://read.example/article');
  const record = exportEntry({ text: 'word', source, apiKey: 'private-key', authorization: 'never' });
  assert.equal(record.apiKey, undefined); assert.equal(record.authorization, undefined); assert.equal(record.source.url, source.url);
});
test('deduplication normalizes case, compatibility glyphs and whitespace per language', () => {
  assert.equal(entryIdentity(' Cognitive\n  Load ', 'zh-CN'), entryIdentity('cognitive load', 'zh-CN'));
  assert.notEqual(entryIdentity('load', 'zh-CN'), entryIdentity('load', 'ja'));
});
test('secret fields reject header injection', () => {
  assert.equal(secretInput('  local-test  '), 'local-test');
  assert.throws(() => secretInput('token\r\nInjected: header'));
});
