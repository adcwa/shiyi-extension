import { LANGUAGES, STYLES } from '../lib/core.js';
import { api, brand, esc, icon, languageOptions, notify, requestHost } from './common.js';
import { SUMMARY_PRESETS } from '../lib/summary-presets.js';
import { hasUsableConnection } from '../lib/connections.js';

const root = document.getElementById('popup');
let state, tabId, busy = false, pageMode = 'bilingual', polling = false, preset, request = 0;

function summarySection() {
  const ready = hasUsableConnection(state, 'summary'), automatic = !!state.knowledgePrefs.autoSummary;
  return `<section class="popup-section summary-section" aria-label="网页总结">
    <div class="popup-row">
      <button class="btn" id="summarize-page" ${state.tab?.supported && (!ready || state.tab.enabled) ? '' : 'disabled'}>${icon('spark')}${ready ? '总结当前网页' : '选择总结模型'}</button>
      <label class="sr-only" for="summary-preset">总结方式</label>
      <select class="popup-select" id="summary-preset">${Object.entries(SUMMARY_PRESETS).map(([key, value]) => `<option value="${key}" ${(preset || state.summaryPrefs.preset) === key ? 'selected' : ''}>${value.name}</option>`).join('')}</select>
    </div>
    <div class="popup-row auto-summary-row"><div><label for="auto-summary-switch">自动总结与定时回顾</label>
      <p id="auto-summary-note">${automatic ? '已开启 · 后台任务使用模型额度' : '开启后使用模型额度 · 可手动总结'}</p></div>
      <button class="switch" role="switch" aria-checked="${automatic}" aria-label="自动总结" aria-describedby="auto-summary-note" id="auto-summary-switch"></button>
    </div>
  </section>`;
}
async function load({ poll = false } = {}) {
  const revision = ++request, next = await api('UI_STATE', { tabId });
  if (revision !== request || (poll && busy)) return;
  const tabKey = tab => [tab?.origin, tab?.supported, tab?.permitted, tab?.blocked, tab?.blockingSite, tab?.page?.active, !!tab?.page?.cached];
  const page = next.tab?.page;
  const layoutChanged = !state || JSON.stringify([tabKey(next.tab), next.prefs, next.knowledgePrefs.autoSummary, next.summaryPrefs.preset, hasUsableConnection(next, 'translation'), hasUsableConnection(next, 'summary')]) !== JSON.stringify([tabKey(state.tab), state.prefs, state.knowledgePrefs.autoSummary, state.summaryPrefs.preset, hasUsableConnection(state, 'translation'), hasUsableConnection(state, 'summary')]);
  state = next;
  if (page?.active) pageMode = page.mode;
  if (!poll || layoutChanged) render(); else updatePageView();
}
function pageSection(ready) {
  const tab = state.tab, page = tab?.page, active = page?.active, cached = tab?.enabled && page?.cached;
  const start = !ready ? '连接翻译模型' : !tab?.supported ? '翻译整页' : tab.blocked ? '恢复此站并翻译' : !tab.permitted ? '允许访问后翻译' : '翻译整页';
  const command = (value, label, hidden = false) => `<button class="btn small ${value === 'restore' ? 'page-restore' : ''}" data-page-command="${value}" ${hidden ? 'hidden' : ''}>${label}</button>`;
  return `<section class="popup-section page-section" aria-label="整页翻译">
    <div class="popup-row">
      <label class="popup-language" for="target-language">译为 <select class="popup-select" id="target-language">${languageOptions(LANGUAGES, state.prefs.targetLanguage)}</select></label>
      <label class="sr-only" for="page-mode">页面译文显示方式</label>
      <select class="popup-select" id="page-mode"><option value="bilingual" ${pageMode === 'bilingual' ? 'selected' : ''}>双语对照</option><option value="translation" ${pageMode === 'translation' ? 'selected' : ''}>仅译文</option></select>
    </div>
    ${active ? `<div class="page-progress"><p id="page-status" role="status"></p><progress id="page-progress" aria-label="页面翻译进度" max="1" value="0"></progress><p id="page-error" hidden></p>
      <div class="page-actions">${command('stop', '停止')}${command('retry', '重试失败')}${command('resume', '继续翻译')}${command('refresh', '翻译新增内容')}${command('restore', '恢复原文')}</div></div>` :
      `<button class="btn primary page-start" id="page-translate" ${ready && !tab?.supported ? 'disabled' : ''}>${icon('translate')}${cached ? '加载本地译文' : start}</button>`}
    <div class="popup-disclosures">
      <details id="translation-options"><summary>翻译选项</summary>
        <div class="popup-option"><label for="popup-display">释义显示</label><select class="popup-select" id="popup-display"><option value="hover" ${state.prefs.displayMode === 'hover' ? 'selected' : ''}>悬浮释义</option><option value="inline" ${state.prefs.displayMode === 'inline' ? 'selected' : ''}>括号释义</option></select></div>
        <div class="popup-option"><label for="popup-style">翻译风格</label><select class="popup-select" id="popup-style">${Object.entries(STYLES).map(([key, value]) => `<option value="${key}" ${state.prefs.style === key ? 'selected' : ''}${key === 'custom' ? ' disabled' : ''}>${value}</option>`).join('')}</select></div>
        <p class="page-note">切换目标语言或风格会恢复原文，可随后重新翻译。</p><div class="popup-links"><button class="link-btn" data-open="translation">更多翻译设置</button><button class="link-btn" data-open="model">翻译模型</button></div>
      </details>
      ${active || (cached && ready) ? `<details id="page-more" ${page?.running ? 'hidden' : ''}><summary>更多</summary><p class="page-note">重新翻译会调用模型，更新本页暂存。</p>${command('retranslate', '重新翻译')}</details>` : ''}
    </div>
  </section>`;
}
function updatePageView() {
  const page = state.tab?.page, status = document.getElementById('page-status');
  if (!page?.active || !status) return;
  const text = page.phase === 'collecting' ? '正在识别内容块…' : `已翻译 ${page.completed} / ${page.total} 块${page.running ? ' · 进行中' : page.phase === 'paused' ? ' · 已停止' : page.failed ? ` · ${page.failed} 块未完成` : page.waiting ? ' · 可继续翻译' : ' · 已完成'}${page.newContent ? ' · 页面有新内容' : ''}`;
  if (status.textContent !== text) status.textContent = text;
  const progress = document.getElementById('page-progress');
  progress.max = page.total || 1; progress.value = page.completed;
  const error = document.getElementById('page-error');
  error.textContent = page.error || page.cacheError || ''; error.hidden = !error.textContent;
  const more = document.getElementById('page-more');
  if (more) more.hidden = page.running;
  for (const [command, visible] of Object.entries({ stop: page.running, retry: !page.running && page.failed, resume: !page.running && page.waiting, refresh: !page.running && page.newContent })) root.querySelector(`[data-page-command="${command}"]`).hidden = !visible;
  document.getElementById('page-mode').value = page.mode;
}
function render() {
  const open = [...root.querySelectorAll('details[open]')].map(details => details.id);
  const focused = document.activeElement;
  const focusSelector = focused?.id ? `#${CSS.escape(focused.id)}` : focused?.closest('details[id]') && focused.matches('summary') ? `#${focused.parentElement.id}>summary` : focused?.dataset.pageCommand ? `[data-page-command="${focused.dataset.pageCommand}"]` : null;
  root.className = '';
  const tab = state.tab, on = !!tab?.enabled, host = tab?.origin ? new URL(tab.origin).host : '浏览器页面';
  const status = !tab?.supported ? '此页不可用' : tab.blocked ? '本站已停用' : on ? '本站已启用' : '需要网站权限';
  const ready = hasUsableConnection(state, 'translation');
  root.innerHTML = `<header class="popup-head">${brand()}<button class="link-btn" data-open="translation">设置</button></header>
    <div class="popup-section popup-site"><div class="popup-row"><strong title="${esc(host)}">${esc(host)}</strong>
      ${tab?.supported && !tab.blocked && !tab.permitted ? '<button class="link-btn" id="website-access">允许访问此网站</button>' : `<button class="popup-site-toggle" role="switch" id="site-switch" aria-checked="${on}" aria-label="在此网站启用点译" ${tab?.supported ? '' : 'disabled'}><span class="site-indicator" aria-hidden="true"></span>${status}</button>`}
    </div><details id="site-options"><summary>网站规则</summary>${tab?.blocked ? `<p class="page-note">已由规则 ${esc(tab.blockingSite)} 停用。</p>` : ''}<button class="link-btn" data-open="sites">管理网站黑名单</button></details></div>
    ${pageSection(ready)}${summarySection()}
    <footer class="popup-footer"><nav aria-label="阅读资料"><button data-open="library">词句库</button><button data-open="trails">我的轨迹</button><button data-open="reviews">阅读回顾</button></nav></footer>`;
  for (const id of open) { const details = document.getElementById(id); if (details) details.open = true; }
  updatePageView();
  if (focusSelector) root.querySelector(focusSelector)?.focus({ preventScroll: true });
}
async function action(task, target) {
  if (busy) return; busy = true; if (target) target.disabled = true;
  try { await task(); if (!window.closed) await load(); }
  catch (error) { notify(error.message); await load().catch(() => {}); }
  finally { busy = false; if (target?.isConnected) target.disabled = false; }
}
async function setSiteEnabled(enabled) {
  await api('BLACKLIST_SET', { site: state.tab.blockingSite || state.tab.origin, blocked: !enabled });
}
async function startReading(command) {
  await api('PAGE_COMMAND', { tabId, action: command, mode: pageMode, showProgress: true });
  window.close();
}
root.addEventListener('click', event => {
  const button = event.target.closest('button'); if (!button) return;
  if (button.id === 'auto-summary-switch') { action(() => api('AUTO_SUMMARY_SET', { enabled: !state.knowledgePrefs.autoSummary }), button); return; }
  if (button.id === 'summarize-page') {
    const ready = hasUsableConnection(state, 'summary');
    if (!ready) { api('OPEN_OPTIONS', { section: 'model-summary' }).then(() => window.close()).catch(error => notify(error.message)); return; }
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
      if (state.tab?.enabled && state.tab.page?.cached) { await startReading('load-local'); return; }
      if (!hasUsableConnection(state, 'translation')) { await api('OPEN_OPTIONS', { section: 'model' }); return; }
      if (!state.tab.permitted && !await requestHost(state.tab.origin)) throw new Error('请在浏览器扩展详情中允许点译访问网站。');
      if (state.tab.blocked) await setSiteEnabled(true);
      await startReading('translate');
    }, button); return;
  }
  if (button.dataset.pageCommand) {
    const command = button.dataset.pageCommand;
    action(() => ['resume', 'retry', 'refresh', 'retranslate'].includes(command) ? startReading(command) : api('PAGE_COMMAND', { tabId, action: command }), button);
    return;
  }
  if (button.id === 'site-switch') { action(() => setSiteEnabled(!state.tab.enabled), button); return; }
  if (button.id === 'website-access') { action(async () => { if (!await requestHost(state.tab.origin)) throw new Error('请在浏览器扩展详情中允许点译访问网站。'); }, button); return; }
});
root.addEventListener('change', event => {
  const field = event.target;
  if (field.id === 'summary-preset') { preset = field.value; return; }
  if (field.id === 'page-mode') {
    pageMode = field.value;
    action(async () => {
      await chrome.storage.local.set({ readerMode: pageMode });
      if (state.tab?.page?.active) await api('PAGE_COMMAND', { tabId, action: 'mode', mode: pageMode });
    }, field);
    return;
  }
  const key = { 'target-language': 'targetLanguage', 'popup-display': 'displayMode', 'popup-style': 'style' }[field.id];
  if (key) action(() => api('SAVE_PREFS', { prefs: { ...state.prefs, [key]: field.value } }), field);
});
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
    try { await load({ poll: true }); } catch {} finally { polling = false; }
  }, 1100);
})().catch(error => { root.innerHTML = `<div class="empty"><h3>暂时无法打开点译。</h3><p>${esc(error.message)}</p><button class="btn primary" id="retry-popup">重试</button></div>`; document.getElementById('retry-popup').onclick = () => location.reload(); });
