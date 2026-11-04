import { LANGUAGES, STYLES } from '../lib/core.js';
import { api, brand, esc, icon, languageOptions, notify, requestHost } from './common.js';
import { SUMMARY_PRESETS } from '../lib/summary-presets.js';
import { hasUsableConnection } from '../lib/connections.js';

const root = document.getElementById('popup'); root.style.cssText = 'padding:0';
let state, tabId, busy = false, pageMode = 'bilingual', polling = false;
function summarySection() {
  const profile = state.summaryProfile, ready = hasUsableConnection(state, 'summary'), automatic = !!state.knowledgePrefs.autoSummary;
  return `<section class="popup-section summary-section"><div class="page-heading"><strong>${icon('spark')}网页总结</strong><button class="link-btn" data-open="summary">总结设置</button></div><div class="site-row auto-summary-row"><div><strong>自动总结</strong><p id="auto-summary-note">${automatic ? '后台网页总结与定时回顾 · 使用模型额度' : '已关闭 · 仍可手动总结当前网页'}</p></div><button class="switch" role="switch" aria-checked="${automatic}" aria-label="自动总结" aria-describedby="auto-summary-note" id="auto-summary-switch"></button></div><label class="sr-only" for="summary-preset">总结方式</label><select class="input" id="summary-preset">${Object.entries(SUMMARY_PRESETS).map(([key, value]) => `<option value="${key}" ${state.summaryPrefs.preset === key ? 'selected' : ''}>${value.name}</option>`).join('')}</select><button class="btn primary page-start" id="summarize-page" ${state.tab?.supported && state.tab?.enabled ? '' : 'disabled'}>${icon('spark')}${ready ? '总结当前网页' : '选择总结模型'}</button><div class="knowledge-actions"><button class="link-btn" data-open="trails">我的轨迹</button><button class="link-btn" data-open="reviews">阅读回顾</button></div><p class="page-note">${ready ? esc(profile.model) + ' · 优先读取本地结果' : '从模型库选择，无需重复填写 Key'}</p></section>`;
}
async function load() {
  state = await api('UI_STATE', { tabId }); if (state.tab?.page?.active) pageMode = state.tab.page.mode; render();
}
function pageSection(ready) {
  const page = state.tab?.page, active = page?.active;
  return `<section class="popup-section page-section"><div class="page-heading"><strong>${icon('translate')}整页翻译</strong><span class="tag">批量翻译</span></div><div class="segmented" role="group" aria-label="页面译文显示方式">${[['bilingual', '双语对照'], ['translation', '仅译文']].map(([value, label]) => `<button data-page-mode="${value}" aria-pressed="${pageMode === value}" class="${pageMode === value ? 'active' : ''}">${label}</button>`).join('')}</div><p class="page-description">${active ? '译文仅调整颜色，双语字号小 2px，切换无需重译。' : '标题、正文和界面文字按块翻译，保留网页排版。'}</p><button class="btn primary page-start" id="page-translate" ${!state.tab?.supported || active ? 'hidden' : ''}>${icon('translate')}${ready ? state.tab?.blocked ? '恢复此网站并翻译' : '翻译当前页面' : '连接模型后翻译'}</button><div class="page-progress" ${active ? '' : 'hidden'}><p id="page-status" role="status" aria-live="polite"></p><progress id="page-progress" aria-label="页面翻译进度" max="1" value="0"></progress><p id="page-error"></p><div class="page-actions">${[['stop', '停止'], ['resume', '继续翻译'], ['retry', '重试失败'], ['refresh', '翻译新增内容'], ['retranslate', '重新翻译'], ['restore', '恢复原文']].map(([value, label]) => `<button class="btn small ${value === 'restore' ? 'page-restore' : ''}" data-page-command="${value}">${label}</button>`).join('')}</div></div><p class="page-note">${active ? '本页结果自动暂存，刷新后可直接恢复。' : '点击网页右下角的小猫，也可翻译选区或整页。'}</p></section>`;
}
function updatePageView() {
  const page = state.tab?.page; if (!page?.active) return;
  const text = document.getElementById('page-status'); if (!text) return;
  text.textContent = page.phase === 'collecting' ? '正在识别内容块…' : `已翻译 ${page.completed} / ${page.total} 块${page.running ? ' · 批量进行中' : page.phase === 'paused' ? ' · 已停止' : page.failed ? ` · ${page.failed} 块未完成` : page.limited ? ' · 可继续翻译' : ' · 已完成'}${page.newContent ? ' · 页面有更新' : ''}`;
  document.getElementById('page-progress').max = page.total || 1; document.getElementById('page-progress').value = page.completed;
  document.getElementById('page-error').textContent = page.error || '';
  root.querySelector('[data-page-command="stop"]').hidden = !page.running;
  root.querySelector('[data-page-command="resume"]').hidden = page.running || !page.waiting;
  root.querySelector('[data-page-command="retry"]').hidden = page.running || !page.failed;
  root.querySelector('[data-page-command="refresh"]').hidden = page.running || !page.newContent;
  root.querySelectorAll('[data-page-mode]').forEach(button => { const selected = button.dataset.pageMode === page.mode; button.classList.toggle('active', selected); button.setAttribute('aria-pressed', String(selected)); });
}
function render() {
  root.className = '';
  const tab = state.tab, on = !!tab?.enabled;
  const ready = hasUsableConnection(state, 'translation');
  root.innerHTML = `<header class="popup-head">${brand()}<span class="tag">当前网页</span><button class="icon-btn" data-open="translation" aria-label="打开偏好设置">${icon('settings')}</button></header>${summarySection()}${pageSection(ready)}<section class="popup-section"><div class="site-row"><div><strong>${esc(tab?.origin ? new URL(tab.origin).host : '浏览器受限页面')}</strong><p><span class="dot"></span>${!tab?.supported ? '当前页面不支持' : tab.blocked ? '黑名单中已停用' : on ? '默认开启 · 可直接划词' : '需要浏览器网站权限'}</p></div><button class="switch" role="switch" aria-checked="${on}" aria-label="在此网站启用点译" id="site-switch" ${tab?.supported && (tab.permitted || tab.blocked) ? '' : 'disabled'}></button></div>${tab?.blocked ? `<div class="status-box">已按黑名单规则 ${esc(tab.blockingSite)} 停用。<button class="btn primary" id="enable-site">恢复此网站</button></div>` : tab?.supported && !tab.permitted ? '<div class="status-box">浏览器尚未允许点译访问此网站。<button class="btn primary" id="website-access">允许网站访问</button></div>' : ''}<button class="popup-secondary" data-open="sites">管理网站黑名单</button></section><section class="popup-section"><label class="popup-field" for="target-language"><span>翻译为</span><select class="popup-select" id="target-language">${languageOptions(LANGUAGES, state.prefs.targetLanguage)}</select></label><span class="popup-label">短词释义显示</span><div class="segmented" role="group" aria-label="释义显示方式">${[['hover', 'hover', '悬浮释义'], ['inline', 'inline', '括号释义']].map(([value, glyph, label]) => `<button data-mode="${value}" class="${state.prefs.displayMode === value ? 'active' : ''}" aria-pressed="${state.prefs.displayMode === value}">${icon(glyph)}${label}</button>`).join('')}</div><span class="popup-label">翻译风格 ${state.prefs.style === 'custom' ? '<span class="tag green">当前使用自定义</span>' : ''}</span><div class="style-pills" role="group" aria-label="翻译风格">${['regular', 'professional', 'humorous'].map(value => `<button data-style="${value}" class="${state.prefs.style === value ? 'active' : ''}" aria-pressed="${state.prefs.style === value}">${STYLES[value]}</button>`).join('')}</div></section><section class="popup-section"><div class="model-row"><div class="model-avatar">${icon('cpu')}</div><div><strong>${esc(state.profile.name || '还没有连接翻译模型')}</strong><small>${ready ? esc(state.profile.model) : state.profile.endpoint && !state.profile.hasKey && state.profile.auth !== 'none' ? '需要重新填写会话密钥' : '连接自己的模型后，开始划词翻译'}</small></div><button class="link-btn" data-open="model">${ready ? '设置' : '配置'} ${icon('up')}</button></div><button class="open-library" data-open="library"><span>${icon('library')}打开我的词句库</span><span><small>${state.count} 条</small>${icon('arrow')}</span></button></section><footer class="popup-footer">${icon('shield')}词库保存在本地 · 使用自己的模型</footer>`;
  updatePageView();
}
async function action(task, target) {
  if (busy) return; busy = true; if (target) target.disabled = true;
  try { await task(); await load(); }
  catch (error) { notify(error.message); }
  finally { busy = false; if (target?.isConnected) target.disabled = false; }
}
async function setSiteEnabled(enabled) {
  await api('BLACKLIST_SET', { site: state.tab.blockingSite || state.tab.origin, blocked: !enabled });
}
root.addEventListener('click', event => {
  const button = event.target.closest('button'); if (!button) return;
  if (button.id === 'auto-summary-switch') { action(() => api('AUTO_SUMMARY_SET', { enabled: !state.knowledgePrefs.autoSummary }), button); return; }
  if (button.id === 'summarize-page') {
    const ready = hasUsableConnection(state, 'summary');
    if (!ready) { api('OPEN_OPTIONS', { section: 'summary' }).then(() => window.close()).catch(error => notify(error.message)); return; }
    const preset = document.getElementById('summary-preset').value;
    button.disabled = true;
    // Dispatch while this gesture is active. The background owns the open/start
    // chain because Chrome closes this popup as soon as the side panel opens.
    api('SUMMARY_OPEN', { tabId, preset }).then(() => window.close()).catch(error => { notify(error.message); button.disabled = false; });
    return;
  }
  if (button.dataset.open) { api('OPEN_OPTIONS', { section: button.dataset.open }).then(() => window.close()).catch(error => notify(error.message)); return; }
  if (button.id === 'page-translate') {
    action(async () => {
      const ready = hasUsableConnection(state, 'translation');
      if (!ready) { await api('OPEN_OPTIONS', { section: 'model' }); return; }
      if (state.tab.blocked) await setSiteEnabled(true);
      await api('PAGE_COMMAND', { tabId, action: 'translate', mode: pageMode });
    }, button); return;
  }
  if (button.dataset.pageMode) {
    pageMode = button.dataset.pageMode;
    action(async () => { await chrome.storage.local.set({ readerMode: pageMode }); if (state.tab?.page?.active) await api('PAGE_COMMAND', { tabId, action: 'mode', mode: pageMode }); }, button); return;
  }
  if (button.dataset.pageCommand) { action(() => api('PAGE_COMMAND', { tabId, action: button.dataset.pageCommand }), button); return; }
  if (button.id === 'site-switch' || button.id === 'enable-site') { action(() => setSiteEnabled(!state.tab.enabled), button); return; }
  if (button.id === 'website-access') { action(async () => { if (!await requestHost(state.tab.origin)) throw new Error('请在浏览器扩展详情中允许点译访问网站。'); }, button); return; }
  if (button.dataset.mode) action(() => api('SAVE_PREFS', { prefs: { ...state.prefs, displayMode: button.dataset.mode } }), button);
  if (button.dataset.style) action(() => api('SAVE_PREFS', { prefs: { ...state.prefs, style: button.dataset.style } }), button);
});
root.addEventListener('change', event => { if (event.target.id === 'target-language') action(() => api('SAVE_PREFS', { prefs: { ...state.prefs, targetLanguage: event.target.value } }), event.target); });
chrome.runtime.onMessage.addListener(message => { if (message?.type === 'SHIYI/UI_CHANGED' && !busy) load().catch(() => {}); });
(async () => {
  // A tab argument also permits opening the same popup as a tab during local verification.
  const explicit = new URLSearchParams(location.search).get('tab');
  if (explicit && /^\d+$/.test(explicit)) tabId = Number(explicit);
  else [tabId] = (await chrome.tabs.query({ active: true, currentWindow: true })).map(tab => tab.id);
  const saved = await chrome.storage.local.get('readerMode'); if (['bilingual', 'translation'].includes(saved.readerMode)) pageMode = saved.readerMode;
  await load();
  // A toolbar popup is the explicit per-page opt-in. Polling and background
  // restoration must never make a closed companion reappear.
  if (state.tab?.enabled) await api('PAGE_COMMAND', { tabId, action: 'show-companion' }).catch(() => {});
  setInterval(async () => {
    if (busy || polling || document.hidden) return; polling = true;
    try {
      const next = await api('UI_STATE', { tabId });
      const before = state.tab?.page?.active, after = next.tab?.page?.active, autoChanged = state.knowledgePrefs.autoSummary !== next.knowledgePrefs.autoSummary;
      state = next;
      if (before !== after || autoChanged) render(); else updatePageView();
    } catch {} finally { polling = false; }
  }, 1100);
})().catch(error => { root.innerHTML = `<div class="empty"><h3>暂时无法打开点译。</h3><p>${esc(error.message)}</p><button class="btn primary" id="retry-popup">重试</button></div>`; document.getElementById('retry-popup').onclick = () => location.reload(); });
