import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanProfile, DEFAULT_PROFILE, DEFAULT_PREFS } from '../src/lib/core.js';
import { PROVIDERS, presetProfile, translationModelInfo, translationModelLabel } from '../src/lib/providers.js';
import { makeRequest } from '../src/lib/model.js';
import { initialModelDraft, collectModelDraft, changeProvider, changeRegion, useRecommendedModel, canReuseKey, modelForm } from '../src/ui/model-setup.js';

test('each built-in vendor resolves an official endpoint and default model from the vendor choice alone', () => {
  const expected = {
    deepseek: ['https://api.deepseek.com/chat/completions', 'deepseek-flash'],
    qwen: ['https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', 'qwen-mt-flash'],
    openai: ['https://api.openai.com/v1/chat/completions', 'gpt-6-luna']
  };
  for (const [provider, [endpoint, model]] of Object.entries(expected)) {
    const profile = cleanProfile({ provider });
    assert.equal(profile.endpoint, endpoint); assert.equal(profile.model, model); assert.equal(profile.auth, 'bearer');
    assert.equal(profile.name, PROVIDERS[provider].name); assert.equal(profile.rememberKey, false);
  }
});
test('named presets cannot silently point a key to a different endpoint', () => {
  for (const provider of Object.keys(PROVIDERS)) assert.throws(() => cleanProfile({ provider, endpoint: 'https://unrelated.example/v1' }), error => error.code === 'INVALID_ENDPOINT');
  assert.throws(() => cleanProfile({ provider: '__proto__' }));
  assert.throws(() => cleanProfile({ provider: 'qwen', region: 'unknown' }));
});
test('Qwen region changes require a region-matched key and preserve the chosen model', () => {
  const draft = { ...presetProfile('qwen'), model: 'qwen-plus', apiKey: 'cn-fixture-key', rememberKey: true };
  const changed = changeRegion(draft, 'intl');
  assert.equal(changed.model, 'qwen-plus'); assert.equal(changed.apiKey, ''); assert.equal(changed.rememberKey, false);
  assert.equal(cleanProfile(changed).endpoint, 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions');
  assert.equal(canReuseKey(changed, { ...cleanProfile(draft), hasKey: true }), false);
});
test('switching vendors clears an entered key and does not reuse another vendor credential', () => {
  const draft = { ...presetProfile('deepseek'), apiKey: 'deepseek-fixture-key', rememberKey: true };
  const changed = changeProvider(draft, 'openai');
  assert.equal(changed.apiKey, ''); assert.equal(changed.rememberKey, false);
  assert.equal(canReuseKey(changed, { ...cleanProfile(draft), hasKey: true }), false);
  assert.equal(changeProvider(draft, 'deepseek'), draft);
});
test('fresh setup selects a ready preset without treating the saved config as connected', () => {
  assert.equal(DEFAULT_PROFILE.endpoint, '');
  const draft = initialModelDraft(DEFAULT_PROFILE);
  assert.equal(draft.provider, 'deepseek'); assert.equal(draft.model, 'deepseek-flash'); assert.equal(draft.advancedOpen, false);
  const html = modelForm(draft, { ...DEFAULT_PROFILE, hasKey: false });
  assert.match(html, /连接并保存/); assert.match(html, /id="model-advanced" class="model-advanced" >/);
  assert.equal((html.match(/ required/g) || []).length, 1);
});
test('legacy custom endpoints and model names remain intact on the new setup page', () => {
  const profile = { endpoint: 'https://company.example/v1/chat/completions', model: 'enterprise-model', name: 'Old connection', auth: 'bearer', timeoutSeconds: 25, hasKey: true };
  const draft = initialModelDraft(profile);
  assert.equal(draft.provider, 'custom'); assert.equal(draft.endpoint, profile.endpoint); assert.equal(draft.model, profile.model);
  assert.equal(canReuseKey(draft, profile), true);
  const clean = cleanProfile(draft); assert.equal(clean.endpoint, profile.endpoint); assert.equal(clean.name, profile.name);
});
test('passwords are never serialized into generated settings HTML', () => {
  const html = modelForm({ ...initialModelDraft(DEFAULT_PROFILE), apiKey: 'never-render-this-credential' }, DEFAULT_PROFILE);
  assert.ok(!html.includes('never-render-this-credential'));
});
test('translation requests use vendor-specific fast modes only on the pinned official presets', () => {
  const request = provider => makeRequest(cleanProfile({ provider }), DEFAULT_PREFS, 'curiosity');
  assert.deepEqual(request('deepseek').thinking, { type: 'disabled' });
  assert.equal(request('qwen').enable_thinking, undefined);
  assert.equal(request('qwen').translation_options.target_lang, 'Chinese');
  assert.equal(makeRequest(cleanProfile({ provider: 'qwen', model: 'qwen-flash' }), DEFAULT_PREFS, 'word').enable_thinking, false);
  assert.equal(request('openai').reasoning_effort, 'none');
  const custom = cleanProfile({ provider: 'custom', endpoint: PROVIDERS.deepseek.endpoint, model: 'custom-model' });
  const body = makeRequest(custom, DEFAULT_PREFS, 'word');
  assert.equal(body.thinking, undefined); assert.equal(body.reasoning_effort, undefined); assert.equal(body.enable_thinking, undefined);
});
test('custom connections still require their explicit endpoint and model and support local no-auth services', () => {
  assert.throws(() => cleanProfile({ provider: 'custom' }));
  const profile = cleanProfile({ provider: 'custom', endpoint: 'http://127.0.0.1:11434/v1', model: 'local-model', auth: 'none' });
  assert.equal(profile.auth, 'none'); assert.equal(profile.model, 'local-model');
});
test('every vendor has one clearly recommended translation model matching the default, without putting recommendation text in API IDs', () => {
  for (const [provider, preset] of Object.entries(PROVIDERS)) {
    const recommended = preset.translationModels.filter(item => item.recommended);
    assert.equal(recommended.length, 1); assert.equal(recommended[0].id, preset.model);
    assert.deepEqual(preset.translationModels.map(item => item.id), preset.models);
    assert.match(translationModelLabel(recommended[0]), /推荐 · 日常翻译/);
    const html = modelForm(initialModelDraft({ ...DEFAULT_PROFILE, provider }), DEFAULT_PROFILE);
    assert.ok(html.includes(`<option value="${preset.model}" selected>${preset.model} · 推荐 · 日常翻译</option>`));
    assert.match(html, /<code id="current-model">/); assert.match(html, /model-recommendation">推荐/);
    assert.equal(cleanProfile({ provider }).model, recommended[0].id);
  }
  assert.equal(translationModelInfo('custom', 'qwen-flash'), null);
});
test('saved higher-tier and unknown models stay selected until explicitly choosing the recommendation', () => {
  for (const model of ['qwen-plus', 'a-previously-saved-model']) {
    const draft = initialModelDraft({ ...presetProfile('qwen'), model, hasKey: true });
    const html = modelForm(draft, { ...draft, hasKey: true });
    assert.ok(html.includes(`<option value="${model}" selected>`));
    assert.ok(!html.includes('model-recommendation">推荐'));
    const recommended = useRecommendedModel({ ...draft, apiKey: 'typed-fixture', advancedOpen: true });
    assert.equal(recommended.model, 'qwen-mt-flash'); assert.equal(recommended.apiKey, 'typed-fixture'); assert.equal(recommended.advancedOpen, true);
  }
});
test('manual model choice reads the typed identifier rather than a UI sentinel and preserves the rest of the connection draft', () => {
  const draft = { ...presetProfile('openai'), apiKey: 'fixture' };
  const values = { 'model-id': '__other__', 'other-model': 'account-specific-model', 'model-name': 'Own connection', 'model-endpoint': draft.endpoint, timeout: '20', 'model-key': 'fixture' };
  const form = { querySelector: selector => selector === '#remember-key' ? { checked: true } : selector === '#model-advanced' ? { open: true } : { value: values[selector.slice(1)] } };
  const collected = collectModelDraft(form, draft);
  assert.equal(collected.model, 'account-specific-model'); assert.equal(collected.manualModel, true);
  assert.equal(collected.apiKey, 'fixture'); assert.equal(cleanProfile(collected).model, 'account-specific-model');
  assert.equal(cleanProfile(collected).manualModel, undefined);
  assert.ok(!modelForm(collected, DEFAULT_PROFILE).includes('value="fixture"'));
});
