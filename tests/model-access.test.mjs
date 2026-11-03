import test from 'node:test';
import assert from 'node:assert/strict';
import { callModel } from '../src/lib/model.js';
import { DEFAULT_PREFS, cleanProfile } from '../src/lib/core.js';

const profile = cleanProfile({ provider: 'custom', endpoint: 'https://llm-workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1', model: 'qwen-mt-flash', auth: 'bearer', timeoutSeconds: 5 });

test('Qwen workspace base URL keeps its host and adds exactly one chat endpoint', () => {
  assert.equal(profile.endpoint, 'https://llm-workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions');
  assert.equal(cleanProfile(profile).endpoint, profile.endpoint);
});

test('distinct Qwen HTTP 403 causes remain distinguishable through the real model call', async () => {
  for (const code of ['AccessDenied.Unpurchased', 'Model.AccessDenied', 'Workspace.AccessDenied', 'AllocationQuota.FreeTierOnly']) {
    await assert.rejects(callModel({ profile, prefs: DEFAULT_PREFS, text: 'curiosity', apiKey: 'fixture-only-key', fetchImpl: async () => new Response(JSON.stringify({ error: { code, message: 'private upstream body with fixture-only-key' }, request_id: 'fixture-request-123' }), { status: 403 }) }), error => {
      assert.equal(error.code, 'HTTP_403');
      assert.ok(error.message.includes(code), 'The provider reason was discarded: '+error.message);
      assert.ok(!error.message.includes('fixture-only-key'));
      assert.ok(!error.message.includes('private upstream body'));
      return true;
    });
  }
});

test('real workspace and public Qwen free-quota response shapes explain the same underlying cause', async () => {
  const message = 'Free quota exhausted. To continue accessing the model on a paid basis, please add funds or disable the "use free tier only" mode in the management console.';
  for (const [endpoint, error, code] of [
    [profile.endpoint, { type: 'insufficient_quota', code: null, message }, 'insufficient_quota'],
    ['https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', { code: 'AllocationQuota.FreeTierOnly', message }, 'AllocationQuota.FreeTierOnly']
  ]) {
    await assert.rejects(callModel({ profile: { ...profile, endpoint }, prefs: DEFAULT_PREFS, text: 'curiosity', apiKey: 'fixture-only-key', fetchImpl: async () => new Response(JSON.stringify({ error, request_id: '11111111-2222-3333-4444-555555555555' }), { status: 403 }) }), failure => {
      assert.equal(failure.code, 'HTTP_403');
      assert.match(failure.message, /免费额度已耗尽/);
      assert.match(failure.message, /免费额度用完即停/);
      assert.ok(failure.message.includes(code));
      assert.ok(failure.message.includes('11111111-2222-3333-4444-555555555555'));
      return true;
    });
  }
});

test('Qwen API-key model restrictions get a permission hint, without echoing the server message', async () => {
  await assert.rejects(callModel({ profile, prefs: DEFAULT_PREFS, text: 'curiosity', apiKey: 'fixture-only-key', fetchImpl: async () => new Response(JSON.stringify({ error: { type: 'access_denied', message: 'Access denied by API-Key restrictions. fixture-only-key' } }), { status: 403 }) }), error => {
    assert.match(error.message, /模型访问范围/);
    assert.ok(!error.message.includes('fixture-only-key'));
    return true;
  });
});

test('generic quota, other providers and malformed/credential-shaped identifiers are not misreported as Qwen free-tier errors', async () => {
  for (const [connection, body] of [
    [profile, { error: { type: 'insufficient_quota', message: 'Allocated quota exceeded.' } }],
    [profile, { error: { code: 'constructor', message: 'private upstream data' } }],
    [{ ...profile, endpoint: 'https://custom.example/v1/chat/completions' }, { error: { code: 'AllocationQuota.FreeTierOnly', message: 'Free quota exhausted.' } }],
    [profile, { error: { code: 'fixture-only-key', type: '<script>secret</script>', message: 'fixture-only-key' }, request_id: 'sk-private-credential-value' }]
  ]) {
    await assert.rejects(callModel({ profile: connection, prefs: DEFAULT_PREFS, text: 'curiosity', apiKey: 'fixture-only-key', fetchImpl: async () => new Response(JSON.stringify(body), { status: 429 }) }), error => {
      assert.equal(error.code, 'HTTP_429');
      assert.ok(!/免费额度已耗尽|fixture-only-key|sk-private|<script>/.test(error.message));
      assert.ok(!error.message.includes('function Object'));
      return true;
    });
  }
});

test('oversized, non-JSON and empty error bodies preserve the HTTP failure and never echo their contents', async () => {
  for (const body of ['private '.repeat(20000), '<html>private upstream data</html>', null]) {
    await assert.rejects(callModel({ profile, prefs: DEFAULT_PREFS, text: 'curiosity', apiKey: 'fixture-only-key', fetchImpl: async () => new Response(body, { status: 403, headers: { 'x-request-id': 'safe-request-123' } }) }), error => {
      assert.equal(error.code, 'HTTP_403');
      assert.ok(!error.message.includes('private'));
      assert.ok(error.message.includes('safe-request-123'));
      return true;
    });
  }
});
