import './text.js';
import './block-text.js';
import { DEFAULT_PROVIDER, PROVIDERS, presetProfile } from './providers.js';

export const VERSION = '0.14.1';
export const LANGUAGES = Object.freeze({ 'zh-CN': '简体中文', en: 'English', ja: '日本語', ko: '한국어', fr: 'Français', de: 'Deutsch', es: 'Español' });
export const STYLES = Object.freeze({ regular: '常规', professional: '专业', humorous: '幽默', custom: '自定义' });
export const PROMPTS = Object.freeze({
  regular: '自然、准确、简洁地解释，优先使用常见表达，不额外展开。',
  professional: '优先使用准确的专业术语，保留概念边界；必要时用一句话说明含义。',
  humorous: '先准确解释，再用一句轻松幽默的表达帮助记忆；不改变原意，不编造事实。'
});
export const DEFAULT_PREFS = Object.freeze({ targetLanguage: 'zh-CN', displayMode: 'hover', style: 'regular', customPrompt: '将 {{text}} 翻译为 {{targetLanguage}}，用一句自然的表达解释。', includeContext: false, batchSize: globalThis.ShiyiBlockText.DEFAULT_BATCH_BLOCKS, translationColorLight: '#245e4d', translationColorDark: '#c1e7d5' });
export const DEFAULT_PROFILE = Object.freeze({ provider: DEFAULT_PROVIDER, region: '', name: '', endpoint: '', model: '', auth: 'bearer', timeoutSeconds: 20, rememberKey: false });
export const normalize = globalThis.ShiyiText.normalize;
export const entryIdentity = (text, language) => `${language}\u001f${normalize(text)}`;
export class AppError extends Error {
  constructor(code, message) { super(message); this.name = 'AppError'; this.code = code; }
}
export function assert(condition, code, message) { if (!condition) throw new AppError(code, message); }
export function boundedText(value, max, label, { optional = false } = {}) {
  assert(typeof value === 'string', 'INVALID_INPUT', `${label}格式不正确。`);
  const text = value.trim();
  assert((optional || text.length > 0) && text.length <= max, 'INVALID_INPUT', `${label}${optional ? '最多' : '需要 1–'}${max} 个字符。`);
  return text;
}
export function cleanPrefs(input) {
  assert(input && typeof input === 'object', 'INVALID_INPUT', '偏好设置格式不正确。');
  assert(Object.hasOwn(LANGUAGES, input.targetLanguage), 'INVALID_INPUT', '请选择支持的目标语言。');
  assert(['hover', 'inline'].includes(input.displayMode), 'INVALID_INPUT', '请选择释义显示方式。');
  assert(Object.hasOwn(STYLES, input.style), 'INVALID_INPUT', '请选择翻译风格。');
  const customPrompt = boundedText(input.customPrompt ?? DEFAULT_PREFS.customPrompt, 4000, '自定义提示词', { optional: input.style !== 'custom' });
  const batchSize = Number(input.batchSize ?? DEFAULT_PREFS.batchSize);
  assert(Number.isInteger(batchSize) && batchSize >= 1 && batchSize <= globalThis.ShiyiBlockText.MAX_BATCH_BLOCKS, 'INVALID_INPUT', '每批翻译块数需要是 1–64 的整数。');
  const color = (value, fallback) => {
    const chosen = value ?? fallback;
    assert(typeof chosen === 'string' && /^#[a-f\d]{6}$/i.test(chosen), 'INVALID_INPUT', '译文颜色需要使用六位颜色值，例如 #245e4d。');
    return chosen.toLowerCase();
  };
  return { targetLanguage: input.targetLanguage, displayMode: input.displayMode, style: input.style, customPrompt, includeContext: input.includeContext === true, batchSize,
    translationColorLight: color(input.translationColorLight, DEFAULT_PREFS.translationColorLight), translationColorDark: color(input.translationColorDark, DEFAULT_PREFS.translationColorDark) };
}
export function modelEndpoint(value) {
  let url;
  try { url = new URL(boundedText(value, 2048, '服务地址')); } catch { throw new AppError('INVALID_ENDPOINT', '请填写有效的服务地址，例如 https://模型服务地址/v1。'); }
  assert(!url.username && !url.password && !url.search && !url.hash, 'INVALID_ENDPOINT', '服务地址不能包含账号、密码、查询参数或片段；密钥请填入专用字段。');
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  assert(url.protocol === 'https:' || (url.protocol === 'http:' && loopback), 'INVALID_ENDPOINT', '模型服务需要 HTTPS；仅本机 localhost、127.0.0.1 或 ::1 允许 HTTP。');
  let path = url.pathname.replace(/\/+$/, '');
  if (!path.endsWith('/chat/completions')) path += '/chat/completions';
  url.pathname = path;
  return url.href;
}
export function cleanProfile(input) {
  assert(input && typeof input === 'object', 'INVALID_INPUT', '模型配置格式不正确。');
  const provider = input.provider ?? 'custom';
  const connectionId = Object.hasOwn(input, 'connectionId') ? input.connectionId : undefined;
  assert(connectionId === undefined || connectionId === null || typeof connectionId === 'string' && /^[a-z\d-]{1,80}$/i.test(connectionId), 'INVALID_INPUT', '模型连接标识不正确。');
  const connection = connectionId === undefined ? {} : { connectionId };
  if (provider === 'codex') {
    const timeoutSeconds = Number(input.timeoutSeconds ?? 60);
    assert([30, 60, 120, 180].includes(timeoutSeconds), 'INVALID_INPUT', '本机 Codex 超时可选择 30、60、120 或 180 秒。');
    const model = boundedText(input.model || 'auto', 160, 'Codex 模型');
    assert(/^[a-z\d._:/-]+$/i.test(model), 'INVALID_INPUT', '请填写 Codex 提供的模型标识，或使用 auto。');
    return { provider, region: '', name: boundedText(input.name || '本机 Codex', 40, '连接名称'), endpoint: 'codex://local', model, auth: 'none', timeoutSeconds, rememberKey: false, ...connection };
  }
  assert(provider === 'custom' || Object.hasOwn(PROVIDERS, provider), 'INVALID_INPUT', '请选择支持的厂家，或选择自定义服务。');
  const preset = provider === 'custom' ? null : presetProfile(provider, input.region || 'cn');
  assert(provider === 'custom' || preset, 'INVALID_INPUT', '请选择有效的服务地域。');
  const endpoint = modelEndpoint(preset?.endpoint || input.endpoint);
  if (preset && input.endpoint?.trim()) assert(modelEndpoint(input.endpoint) === endpoint, 'INVALID_ENDPOINT', '预设厂家的服务地址已自动配置；其他地址请选择自定义服务。');
  const auth = preset ? 'bearer' : input.auth ?? 'bearer';
  assert(['bearer', 'none'].includes(auth), 'INVALID_INPUT', '请选择密钥鉴权或无需密钥。');
  const timeoutSeconds = Number(input.timeoutSeconds ?? 20);
  assert(Number.isInteger(timeoutSeconds) && timeoutSeconds >= 5 && timeoutSeconds <= 25, 'INVALID_INPUT', '请求超时需要在 5–25 秒之间。');
  return { provider, region: preset?.region || '', name: boundedText(input.name || preset?.name || '我的翻译模型', 40, '连接名称'), endpoint,
    model: boundedText(input.model?.trim() || preset?.model || '', 160, '模型名称'), auth, timeoutSeconds, rememberKey: input.rememberKey === true, ...connection };
}
export function permissionPattern(value) {
  const url = new URL(value);
  assert(['https:', 'http:'].includes(url.protocol), 'INVALID_SITE', '这个页面不支持使用点译。');
  return `${url.protocol}//${url.hostname}/*`;
}
export function siteOrigin(value) {
  let url;
  try { url = new URL(value.includes('://') ? value.trim() : `https://${value.trim()}`); } catch { throw new AppError('INVALID_SITE', '请填写完整域名或网站来源地址。'); }
  assert(['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/', 'INVALID_SITE', '请填写域名或网站来源地址，不包含网页路径、账号和参数。');
  const host = url.hostname;
  const validHost = host === 'localhost' || host === '[::1]' || (host.length <= 253 && host.includes('.') && host.split('.').every(s => /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(s)));
  assert(validHost, 'INVALID_SITE', '网站域名格式不正确。');
  assert(!/(^|\.)chromewebstore\.google\.com$|(^|\.)microsoftedge\.microsoft\.com$/i.test(host), 'UNSUPPORTED_PAGE', '浏览器扩展商店页面不允许注入内容，请在普通网页中使用。');
  return url.origin;
}
export function pageOrigin(value) {
  try { const url = new URL(value); return siteOrigin(url.origin); } catch { return null; }
}
export function safeSource(value, title = '') {
  let url;
  try { url = new URL(value); } catch { return { domain: '', url: '', title: '' }; }
  if (!['https:', 'http:'].includes(url.protocol)) return { domain: '', url: '', title: '' };
  url.search = ''; url.hash = ''; url.username = ''; url.password = '';
  return { domain: url.host, url: url.href.slice(0, 2048), title: String(title).slice(0, 240) };
}
export function classifyText(text) {
  if (/[.!?。！？]$/.test(text) || /[。！？\n]/.test(text)) return 'sentence';
  return /\s/.test(text.trim()) ? 'phrase' : 'word';
}
export function secretIdentity(profile) { return `${profile.endpoint}\u001f${profile.auth}`; }
export function secretInput(value) {
  const key = boundedText(value ?? '', 4096, 'API Key', { optional: true });
  assert(!/[\r\n\u0000]/.test(key), 'INVALID_INPUT', 'API Key 不能包含换行或控制字符。');
  return key;
}
export function publicEntry(entry) {
  return { id: entry.id, text: entry.text, translation: entry.translation, kind: entry.kind, targetLanguage: entry.targetLanguage, style: entry.style, updatedAt: entry.updatedAt };
}
export function exportEntry(entry) {
  const { id, text, translation, kind, sourceLanguage, targetLanguage, style, customPromptVersion, modelName, source, context, createdAt, updatedAt } = entry;
  return { id, text, translation, kind, sourceLanguage, targetLanguage, style, customPromptVersion, modelName, source: safeSource(source?.url || '', source?.title || ''), context, createdAt, updatedAt };
}
export async function digest(value) {
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(buffer), x => x.toString(16).padStart(2, '0')).join('');
}
export function friendlyError(error) {
  if (error instanceof AppError) return { code: error.code, message: error.message, ...(error.connectionsExhausted ? { connectionsExhausted: true } : {}) };
  if (error?.name === 'QuotaExceededError') return { code: 'STORAGE_FULL', message: '本地存储空间不足，请先导出并整理词库。' };
  return { code: 'INTERNAL', message: '操作未完成，请重试；如刚更新插件，请刷新网页。' };
}
