// Qwen-MT protocol/default verified against official documentation on 2026-11-03.
// This is configuration data only; all credentials stay outside this module.
export const DEFAULT_PROVIDER = 'deepseek';
// Recommendations target this extension's short definitions and aligned page
// translation, rather than coding or deep reasoning. IDs remain API values.
const translationModel = (id, recommended, description, optionHint = '复杂文本备选') => Object.freeze({ id, recommended, description, optionHint });
export const PROVIDERS = Object.freeze({
  deepseek: Object.freeze({
    name: 'DeepSeek', description: 'DeepSeek 官方服务', shortName: 'DeepSeek',
    endpoint: 'https://api.deepseek.com/chat/completions', model: 'deepseek-flash',
    models: ['deepseek-flash', 'deepseek-v4-pro'],
    translationModels: Object.freeze([
      translationModel('deepseek-flash', true, '轻量省费，适合日常划词和网页翻译。'),
      translationModel('deepseek-v4-pro', false, '复杂文本备选；日常翻译优先使用 Flash。')
    ]),
    keyUrl: 'https://platform.deepseek.com/', docs: 'https://api-docs.deepseek.com/'
  }),
  qwen: Object.freeze({
    name: '通义千问', description: '阿里云百炼', shortName: '千问',
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', model: 'qwen-mt-flash',
    models: ['qwen-mt-flash', 'qwen-flash', 'qwen-plus'],
    translationModels: Object.freeze([
      translationModel('qwen-mt-flash', true, '千问专用翻译模型，适合日常划词和网页翻译。'),
      translationModel('qwen-flash', false, '通用轻量模型，可按需用于翻译与释义。', '通用模型备选'),
      translationModel('qwen-plus', false, '术语密集或复杂长句的备选，费用高于 Flash。')
    ]),
    regions: Object.freeze({
      cn: Object.freeze({ name: '中国内地（北京）', endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions' }),
      intl: Object.freeze({ name: '国际（新加坡）', endpoint: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions' })
    }),
    keyUrl: 'https://help.aliyun.com/zh/model-studio/get-api-key', docs: 'https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope'
  }),
  openai: Object.freeze({
    name: 'OpenAI', description: 'ChatGPT 系列模型', shortName: 'OpenAI',
    endpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-6-luna', models: ['gpt-6-luna'],
    translationModels: Object.freeze([
      translationModel('gpt-6-luna', true, '面向高频轻量任务，适合日常划词和网页翻译。')
    ]),
    keyUrl: 'https://platform.openai.com/', docs: 'https://developers.openai.com/api/docs/models/gpt-6-luna'
  })
});
export function translationModelInfo(provider, model) {
  if (!Object.hasOwn(PROVIDERS, provider)) return null;
  return PROVIDERS[provider].translationModels.find(item => item.id === model) || null;
}
export function translationModelLabel(item) {
  return `${item.id} · ${item.recommended ? '推荐 · 日常翻译' : item.optionHint}`;
}
export function presetProfile(provider, region = 'cn') {
  if (!Object.hasOwn(PROVIDERS, provider)) return null;
  const preset = PROVIDERS[provider]; if (!preset) return null;
  if (preset.regions && !Object.hasOwn(preset.regions, region)) return null;
  return { provider, region: preset.regions ? region : '', name: preset.name,
    endpoint: preset.regions ? preset.regions[region].endpoint : preset.endpoint,
    model: preset.model, auth: 'bearer', timeoutSeconds: 20, rememberKey: false };
}
export function providerRequestOptions(profile) {
  const preset = presetProfile(profile.provider, profile.region || 'cn');
  // Custom connections never inherit vendor switches just because their URL matches.
  if (!preset || profile.endpoint !== preset.endpoint) return {};
  if (profile.provider === 'deepseek') return { thinking: { type: 'disabled' } };
  if (profile.provider === 'qwen' && !isMTProfile(profile)) return { enable_thinking: false };
  if (profile.provider === 'openai' && profile.model === 'gpt-6-luna') return { reasoning_effort: 'none' };
  return {};
}
export const isMTProfile = profile => ['qwen', 'custom'].includes(profile.provider) && /^qwen-mt-/i.test(profile.model);
