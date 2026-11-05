import { LANGUAGES, STYLES, PROMPTS, DEFAULT_PROFILE, cleanPrefs, cleanProfile, pageOrigin, normalize, digest, VERSION } from '../lib/core.js';
import { api, brand, downloadJSON, esc, icon, languageOptions, notify, requestHost } from './common.js';
import { initialModelDraft, collectModelDraft, changeProvider, changeRegion, useRecommendedModel, updateModelGuidance, modelForm } from './model-setup.js';
import { blacklistSite } from '../lib/site-policy.js';
import { readingSettings, updateReadingColor, defaultReadingColor } from './reading-settings.js';
import { SUMMARY_PRESETS, cleanSummaryProfile, summaryPresetProfile } from '../lib/summary-presets.js';
import { enhanceIntroduction } from './intro.js';
import { modelLibrary, scenarioConnections } from './connections.js';
import { hasUsableConnection } from '../lib/connections.js';
import { mountKnowledge, knowledgePreferences, clearKnowledgeDrafts } from './knowledge.js';

const app = document.getElementById('app'), modal = document.getElementById('modal');
const sections = { library: ['library', '词句库'], trails:['globe','我的轨迹'], reviews:['book','阅读回顾'], translation: ['sliders', '翻译偏好'], model: ['cpu', '模型库'], summary: ['spark', '总结设置'], sites: ['globe', '网站黑名单'], data: ['shield', '数据与隐私'], help: ['help', '使用指南'], about: ['book', '产品介绍'] };
const groups = {
  library: ['词句库', 'library'],
  reading: ['阅读', 'trails', 'reviews'],
  models: ['模型库', 'model'],
  settings: ['设置', 'translation', 'summary', 'sites', 'data'],
  help: ['帮助', 'help', 'about']
};
const groupFor = key => Object.keys(groups).find(group => groups[group].slice(1).includes(key));
const groupRoutes = { summary: '总结与回顾', translation: '翻译', sites: '网站', data: '数据与隐私' };
const settingsDrafts = new Map(), groupLocation = new Map();
let modelPurpose = 'translation';
const kinds = { word: '单词', phrase: '短语', sentence: '句子' };
let state, entries = [], section = 'library', prefsDraft, query = '', filter = 'all', sort = 'new', page = 0, selected = new Set(), actionBusy = false, detailOpened = false, searchTimer;
const pageSize = 50;
let modelDraft, modelEditingId, testedConnection, introDispose, introAbort, knowledgeDispose, modelFormOpen=false;
const savedProfile = () => state.modelLibrary.items.find(item => item.id === modelEditingId)?.profile ||
  { ...(modelPurpose === 'summary' ? summaryPresetProfile() : DEFAULT_PROFILE), connectionId: null, hasKey: false };
function prepareModel() {
  if (modelEditingId === undefined) modelEditingId = null;
  if(!modelDraft){modelDraft=initialModelDraft(savedProfile(), modelEditingId === null && modelPurpose === 'summary' ? 'summary' : 'library');if(modelEditingId===null)modelDraft.rememberKey=true;}
  modelDraft.connectionId = modelEditingId;
}
const date = time => new Date(time).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
const heading = (title, text, actions = '') => `<div class="page-heading"><div><h1>${title}</h1>${text ? `<p>${text}</p>` : ''}</div>${actions}</div>`;
const footer = () => `<footer class="work-footer"><span>保存在此浏览器</span><span>点译 v${esc(state.version)}</span></footer>`;
function rememberSettings() {
  for (const id of ['preferences-form', 'summary-preferences', 'knowledge-preferences']) {
    const form = document.getElementById(id);
    if (!form) continue;
    const fields = [...form.querySelectorAll('input[id], select[id], textarea[id]')];
    settingsDrafts.set(id, {
      values: fields.filter(field => field.tagName === 'SELECT'
        ? !field.selectedOptions[0]?.defaultSelected
        : field.type === 'checkbox' ? field.checked !== field.defaultChecked : field.value !== field.defaultValue
      ).map(field => [field.id, field.type === 'checkbox' ? field.checked : field.value]),
      open: [...form.querySelectorAll('details')].map(details => details.open)
    });
  }
}
function restoreSettings() {
  for (const [id, draft] of settingsDrafts) {
    const form = document.getElementById(id);
    if (!form) continue;
    draft.values.forEach(([key, value]) => {
      const field = form.querySelector(`#${CSS.escape(key)}`);
      if (!field) return;
      if (field.type === 'checkbox') field.checked = value; else field.value = value;
    });
    form.querySelectorAll('details').forEach((details, index) => { details.open = !!draft.open[index]; });
    if (id === 'preferences-form') {
      document.getElementById('reading-preferences-card').style.setProperty('--preview-font-reduction', `${form.querySelector('#bilingual-font-reduction').value}px`);
      for (const theme of ['light', 'dark']) updateReadingColor(form, theme, form.querySelector(`#color-${theme}-hex`).value);
    }
  }
}
function draw() {
  introDispose?.(); introDispose = null; introAbort?.abort(); knowledgeDispose?.(); knowledgeDispose = null;
  document.title = `点译 · ${sections[section][1]}`;
  app.className = 'app-shell';
  const current = groupFor(section);
  const navigation = Object.entries(groups).map(([group, [label, first]]) => `<a class="nav-item ${group === current ? 'active' : ''}" href="#${groupLocation.get(group) || first}" ${group === current ? 'aria-current="location"' : ''}>${label}</a>`).join('');
  const routes = groups[current].slice(1);
  const subnav = routes.length > 1 ? `<nav class="section-nav" aria-label="${groups[current][0]}分类">${routes.map(key => `<a href="#${key}" ${key === section ? 'aria-current="page"' : ''}>${groupRoutes[key] || sections[key][1]}</a>`).join('')}</nav>` : '';
  const content = section === 'library' ? library() : ['trails', 'reviews'].includes(section) ? '<div id="knowledge-root"></div>' : section === 'translation' ? translation() : section === 'model' ? model() : section === 'summary' ? summarySettings() : section === 'sites' ? sites() : section === 'data' ? dataPage() : section === 'about' ? introduction() : help();
  app.innerHTML = `<header class="manager-header"><a class="manager-brand" href="#library" aria-label="点译词句库">${brand()}</a><nav class="manager-nav" aria-label="主导航">${navigation}</nav></header><div class="workspace"><main id="main" class="workspace-main ${current === 'settings' ? 'settings-main' : ''}">${subnav}${content}<input type="file" id="vocabulary-file" accept="application/json,.json" aria-label="选择词库备份文件" hidden>${footer()}</main></div>`;
  if (section === 'library') renderTable();
  if(['trails','reviews'].includes(section))knowledgeDispose=mountKnowledge(document.getElementById('knowledge-root'),{type:section});
  restoreSettings();
  document.getElementById('main').classList.toggle('intro-main', section === 'about');
  if (section === 'about') mountIntroduction();
  if (section === 'model' && document.getElementById('model-key')) document.getElementById('model-key').value = modelDraft.apiKey || '';
}
async function refreshData() {
  const [nextState, library] = await Promise.all([api('UI_STATE'), api('LIBRARY')]);if(nextState.version!==VERSION)throw Object.assign(new Error('安装文件已更新，请重新加载点译完成升级。本地词库会保留。'),{code:'UPGRADE_REQUIRED'});state = nextState; entries = library.entries;
}
async function route() {
  if (section === 'translation' && document.getElementById('preferences-form')) {
    const draft = collectPrefs();
    prefsDraft = Object.keys(state.prefs).some(key => state.prefs[key] !== draft[key]) ? draft : null;
  }
  rememberSettings();
  const route = location.hash.slice(1);
  modelPurpose = route === 'model-summary' ? 'summary' : 'translation';
  section = route === 'model-summary' ? 'model' : Object.hasOwn(sections, route) ? route : 'library';
  groupLocation.set(groupFor(section), route === 'model-summary' ? route : section);
  if (modal.open) modal.close();
  selected.clear(); modelDraft = null; modelEditingId = undefined; testedConnection = null; modelFormOpen = false;
  draw(); window.scrollTo({ top: 0, behavior: 'instant' });
  if (section === 'model' && modelPurpose === 'summary' && !modelFormOpen) document.getElementById('scene-summary-model').closest('section').scrollIntoView({ block: 'start' });
  const id = new URLSearchParams(location.search).get('entry');
  if (section === 'library' && id && !detailOpened) { detailOpened = true; const entry = entries.find(entry => entry.id === id); if (entry) showDetail(entry); }
}

function introduction() { return '<div id="intro-root" class="intro-view"><div class="intro-loading" role="status">正在打开点译介绍…</div></div>'; }
async function mountIntroduction() {
  const host = document.getElementById('intro-root'), controller = new AbortController(); introAbort = controller;
  try {
    const response = await fetch(chrome.runtime.getURL('intro.html'), { signal: controller.signal });
    if (!response.ok) throw new Error('介绍页暂时无法加载。');
    const parsed = new DOMParser().parseFromString(await response.text(), 'text/html');
    if (controller.signal.aborted || !host.isConnected || section !== 'about') return;
    // Resolve the introduction's own assets and document links before adopting
    // its body into the management page. Fragment links stay within the view.
    for (const node of parsed.body.querySelectorAll('[src], [href]')) {
      for (const attribute of ['src', 'href']) {
        const value = node.getAttribute(attribute);
        if (value && !value.startsWith('#')) node.setAttribute(attribute, new URL(value, chrome.runtime.getURL('intro.html')).href);
      }
    }
    // Register the local face for Shadow DOM without changing the manager's
    // system-font styles or its existing frame-ancestor security policy.
    if (![...document.fonts].some(face => face.family === 'Geist')) {
      const face = new FontFace('Geist', `url(${chrome.runtime.getURL('assets/promo/Geist.woff2')})`, { weight: '100 900', style: 'normal' });
      document.fonts.add(face); face.load().catch(() => {});
    }
    const shadow = host.attachShadow({ mode: 'open' }), styles = document.createElement('link'), page = document.createElement('div');
    styles.rel = 'stylesheet'; styles.href = chrome.runtime.getURL('ui/intro.css'); page.className = 'intro-page';
    page.append(...[...parsed.body.childNodes].filter(node => node.nodeName !== 'SCRIPT'));
    const loaded = new Promise((resolve, reject) => {
      styles.addEventListener('load', resolve, { once: true });
      styles.addEventListener('error', reject, { once: true });
    });
    host.replaceChildren(); shadow.append(styles);
    await loaded;
    if (controller.signal.aborted || !host.isConnected) return;
    shadow.append(page);
    introDispose = enhanceIntroduction(shadow, { embedded: true, installed: true, modelURL: location.pathname + '#model' });
  } catch (error) {
    if (controller.signal.aborted || !host.isConnected) return;
    const target = host.shadowRoot || host;
    target.innerHTML = '<div class="empty"><h2>介绍页暂时无法加载</h2><p>请重新加载扩展，或点击下方按钮重试。</p><button class="btn primary">重新打开介绍页</button></div>';
    target.querySelector('button').addEventListener('click', draw);
  }
}
function library() {
  return heading('词句库', '', `<div class="manager-actions"><button class="btn" data-action="export">${icon('download')}导出词库</button><details class="action-details"><summary>更多</summary><button class="btn" data-action="import-vocabulary">从 JSON 恢复</button></details></div>`)
    + `<div class="library-toolbar"><label class="search-field" for="term-search">${icon('search')}<input type="search" id="term-search" placeholder="搜索词句或释义" aria-label="搜索词句或释义" value="${esc(query)}"></label>
      <div class="library-filters"><label class="sr-only" for="term-filter">词句类型</label><select class="sort-select" id="term-filter">${[['all', '全部类型'], ...Object.entries(kinds)].map(([key, name]) => `<option value="${key}" ${filter === key ? 'selected' : ''}>${name}</option>`).join('')}</select>
      <label class="sr-only" for="sort">排序方式</label><select class="sort-select" id="sort"><option value="new" ${sort === 'new' ? 'selected' : ''}>最近收藏</option><option value="alpha" ${sort === 'alpha' ? 'selected' : ''}>按字母排序</option></select></div>
      </div><div id="batch"></div><section class="table-card" id="table" aria-label="词句列表"></section>`;
}
function filteredEntries() {
  const needle = normalize(query);
  return entries.filter(entry => (filter === 'all' || entry.kind === filter) && (!needle || normalize(entry.text + ' ' + entry.translation).includes(needle)))
    .sort((a, b) => sort === 'alpha' ? a.text.localeCompare(b.text) : b.createdAt - a.createdAt);
}
function renderTable() {
  if (section !== 'library') return;
  const all = filteredEntries(), pages = Math.max(1, Math.ceil(all.length / pageSize)); page = Math.min(page, pages - 1);
  const shown = all.slice(page * pageSize, (page + 1) * pageSize), table = document.getElementById('table');
  document.getElementById('batch').innerHTML = selected.size ? `<div class="batch-bar"><span>已选择 ${selected.size} 个词句</span><div><button class="btn small subtle" data-action="cancel-selection">取消选择</button> <button class="btn small danger" data-action="delete-selected">${icon('trash')}删除</button></div></div>` : '';
  if (!all.length) {
    table.innerHTML = `<div class="empty">${icon('library')}<h3>${query ? '没有找到这个词句。' : entries.length ? '没有符合筛选的词句' : '词句库还是空的'}</h3><p>${query ? '换个关键词，也可以搜索中文释义。' : entries.length ? '清除筛选可查看全部词句。' : '在普通网页选中短词句，翻译后可在这里找到释义。'}</p>${query ? '<button class="btn" data-action="clear-search">清空搜索</button>' : entries.length ? '<button class="btn" data-action="clear-filter">清除筛选</button>' : `<a class="btn primary" href="#${hasUsableConnection(state, 'translation') ? 'help' : 'model'}">${hasUsableConnection(state, 'translation') ? '了解如何划词' : '连接我的模型'} ${icon('arrow')}</a>`}</div>`; return;
  }
  table.innerHTML = `<table class="term-table"><thead><tr><th class="check-col"><input type="checkbox" id="select-page" aria-label="选择本页全部词句" ${shown.every(entry => selected.has(entry.id)) ? 'checked' : ''}></th><th class="word-col" scope="col">原文 / 类型</th><th class="meaning-col" scope="col">已存释义</th><th class="source-col" scope="col">遇见于</th><th class="actions-col" scope="col"><span class="sr-only">操作</span></th></tr></thead><tbody>${shown.map(entry => `<tr><td class="check-col"><input type="checkbox" data-select="${esc(entry.id)}" aria-label="选择 ${esc(entry.text)}" ${selected.has(entry.id) ? 'checked' : ''}></td><td><button class="word-link" data-detail="${esc(entry.id)}">${esc(entry.text)}</button><div class="word-sub"><span>${kinds[entry.kind] || '词句'}</span><span>·</span><span>${esc(LANGUAGES[entry.targetLanguage] || entry.targetLanguage)}</span></div></td><td class="meaning-cell">${esc(entry.translation)}</td><td class="source-cell">${esc(entry.source?.domain || '本地收藏')}<small>收藏于 ${date(entry.createdAt)}</small></td><td class="actions-col"><button class="icon-btn" data-detail="${esc(entry.id)}" aria-label="编辑 ${esc(entry.text)}">${icon('edit')}</button><button class="icon-btn delete" data-delete="${esc(entry.id)}" aria-label="删除 ${esc(entry.text)}">${icon('trash')}</button></td></tr>`).join('')}</tbody></table><div class="table-footer"><span>显示 ${page * pageSize + 1}–${page * pageSize + shown.length} / ${all.length} 个词句</span><span><button class="btn small subtle" data-page="${page - 1}" ${page === 0 ? 'disabled' : ''}>上一页</button> <span>${page + 1} / ${pages}</span> <button class="btn small subtle" data-page="${page + 1}" ${page >= pages - 1 ? 'disabled' : ''}>下一页</button></span></div>`;
}
function modeButtons(value) { return `<div class="segmented" role="group" aria-label="释义显示方式">${[['hover', 'hover', '悬浮释义'], ['inline', 'inline', '括号释义']].map(([key, glyph, name]) => `<button type="button" data-mode="${key}" class="${value === key ? 'active' : ''}" aria-pressed="${value === key}">${icon(glyph)}${name}</button>`).join('')}</div>`; }
function translation() {
  const prefs = prefsDraft || (prefsDraft = { ...state.prefs });
  const prompt = prefs.style === 'custom' ? prefs.customPrompt : PROMPTS[prefs.style];
  return heading('翻译偏好', '') +
    `<form id="preferences-form"><section class="card"><div class="section-title">${icon('translate')}<h2>语言与释义</h2></div><div class="form-row"><label for="target-language">目标语言</label><div><select class="input" id="target-language">${languageOptions(LANGUAGES, prefs.targetLanguage)}</select><p class="field-help">默认简体中文。切换后，仅自动匹配对应目标语言的已存词句。</p></div></div><div class="form-row"><span class="form-label" style="margin:0">释义显示方式</span><div>${modeButtons(prefs.displayMode)}<p class="field-help">用于短词句。长选区按段显示，整页翻译可在插件菜单切换双语或仅译文，不使用下划线或括号。</p></div></div><div class="form-row"><span class="form-label" style="margin:0">语境发送</span><div><label class="check-label"><input type="checkbox" id="include-context" ${prefs.includeContext ? 'checked' : ''}><span>附带选中文本附近的一句语境</span></label><p class="field-help">默认关闭，仅用于短词句。开启后会附带相邻语境；按段与整页翻译会发送对应的完整内容块。</p></div></div></section>${readingSettings(prefs)}<section class="card"><div class="section-title">${icon('spark')}<h2>翻译风格</h2></div><div class="style-cards" role="group" aria-label="翻译风格">${[['regular', '常规', '自然、简洁，优先常见表达。'], ['professional', '专业', '术语准确，解释清楚概念与边界。'], ['humorous', '幽默', '先准确解释，再添一点轻松的记忆点。']].map(([key, title, text]) => `<button type="button" data-style="${key}" class="style-card ${prefs.style === key ? 'active' : ''}" aria-pressed="${prefs.style === key}"><strong>${title}${icon(prefs.style === key ? 'check' : key === 'regular' ? 'book' : key === 'professional' ? 'sliders' : 'spark')}</strong><p>${text}</p></button>`).join('')}</div><div class="custom-row"><label class="check-label"><input type="checkbox" id="custom-style" ${prefs.style === 'custom' ? 'checked' : ''}><span>使用我自己的风格提示词</span></label></div><details class="settings-disclosure" id="style-prompt-details" ${prefs.style === 'custom' ? 'open' : ''}><summary>提示词与表达示例</summary><label for="style-prompt" class="form-label">${prefs.style === 'custom' ? '自定义提示词' : '内置风格提示词'}</label><textarea id="style-prompt" class="input" maxlength="4000" ${prefs.style === 'custom' ? '' : 'readonly'}>${esc(prompt)}</textarea><p class="field-help">最多 4000 字符。支持 {{text}} 原文、{{targetLanguage}} 目标语言、{{context}} 可选语境；实际文本以独立资料传给模型。</p><div class="prompt-preview"><span class="tag green">表达示例 · 不消耗模型额度</span><em>less is more</em>${prefs.style === 'professional' ? '通过削减非必要元素，提高信息传达效率。' : prefs.style === 'humorous' ? '少即是多。少一点花里胡哨，脑子就能少加点班。' : prefs.style === 'custom' ? '你写的提示词将在下一次真实翻译时生效。' : '少即是多，保持简洁。'}</div></details></section><div class="save-bar"><span>保存后应用颜色和后续批次；修改语言或风格会还原整页译文。</span><button class="btn primary" type="submit">${icon('check')}保存偏好</button></div></form>`;
}
function model() {
  if (!state.modelLibrary.items.length && modelEditingId === undefined) modelFormOpen = true;
  if(modelFormOpen)prepareModel();
  return `<div class="page-heading"><div><h1>模型库</h1><p>添加一次，本地保存。不同场景直接选择使用。</p></div></div>`+
    modelLibrary(state, modelEditingId)+(modelFormOpen?`<div class="model-editor"><div class="model-editor-heading"><h2>${modelEditingId?'编辑模型':'添加模型'}</h2><button class="btn subtle small" data-action="close-model-editor">收起</button></div><p class="field-help">修改已保存的连接会同步到所有引用它的场景。</p>${modelForm(modelDraft,savedProfile())}</div>`:'')+ `<nav class="model-jumps" aria-label="模型使用场景"><a href="#model" data-model-scene="translation">翻译</a><a href="#model-summary" data-model-scene="summary">总结与回顾</a></nav>` + scenarioConnections(state, 'translation') + scenarioConnections(state, 'summary');
}
function summarySettings() {
  return `<div class="page-heading"><div><h1>总结设置</h1><p>设置总结方式、提示词与回顾计划。</p></div><a class="btn" href="#model-summary">选择总结模型</a></div>` +
    knowledgePreferences(state.knowledgePrefs) + `<section class="card"><div class="section-title">${icon('spark')}<h2>总结场景与提示词</h2></div><p class="section-description">自动模式先识别主题，再应用相应预设。只分析当前网页，不进行额外联网检索。</p><form id="summary-preferences"><label class="form-label" for="default-summary-preset">默认总结方式</label><select class="input" id="default-summary-preset">${Object.entries(SUMMARY_PRESETS).map(([key, value]) => `<option value="${key}" ${state.summaryPrefs.preset === key ? 'selected' : ''}>${value.name}</option>`).join('')}</select><div class="summary-prompts">${Object.entries(SUMMARY_PRESETS).filter(([key]) => key !== 'auto').map(([key, value]) => `<details><summary>${value.name}</summary><label class="sr-only" for="prompt-${key}">${value.name}提示词</label><textarea class="input" id="prompt-${key}" data-summary-prompt="${key}" maxlength="6000" rows="5">${esc(state.summaryPrefs.prompts?.[key] || value.prompt)}</textarea><button type="button" class="link-btn" data-reset-summary-prompt="${key}">恢复预设</button></details>`).join('')}</div><p class="field-help">每个提示词最多 6000 字符。保存后应用于下一次总结，不自动重跑已有结果。</p><button class="btn primary" type="submit">保存总结偏好</button></form></section>`;
}
function sites() {
  return heading('网站黑名单', '普通网页默认开启。可在这里停用指定网站。') +
    `<section class="card"><p class="section-description">黑名单中的网站不显示划词工具、词库标记或整页译文。</p><form id="site-form"><label class="form-label" for="site-input">停用网站</label><div class="domain-add"><input class="input" id="site-input" required placeholder="例如：example.com，或粘贴网页地址" autocomplete="off" spellcheck="false" maxlength="2048"><button class="btn primary" type="submit">加入黑名单</button></div><p class="field-help">域名及其子域名都会停用，覆盖 HTTP、HTTPS 和不同端口；恢复后立即生效。</p><p class="field-error" id="site-error" role="alert"></p></form><div class="domain-list">${state.blacklist.length ? state.blacklist.map(site => `<div class="domain-item"><div><div class="domain-name">${esc(site)}</div><small>该域名及其子域名已停用</small></div><div class="domain-actions"><button class="btn small" data-site-remove="${esc(site)}" aria-label="恢复 ${esc(site)}">恢复使用</button></div></div>`).join('') : `<div class="empty" style="padding:37px 15px 20px">${icon('globe')}<h3>所有普通网页已默认开启。</h3><p>黑名单为空，无需逐站添加或开启。<br>选中文字，点击翻译，或使用鼠标右键菜单。</p></div>`}</div></section><p class="small-text muted">加入黑名单会立即移除标记、还原译文并取消该网站的翻译请求。词库和模型配置保留。</p>`;
}
function pageCacheCard() {
  const cache = state.pageCache || { count: 0, bytes: 0 };
  return `<section class="card"><div class="section-title">${icon('monitor')}<h2>页面译文暂存。</h2></div><p class="section-description">已暂存 ${cache.count} 个页面，约 ${(cache.bytes / 1048576).toFixed(1)} MB。刷新时核对原文后恢复，不会自动请求模型。</p><p class="field-help">最多保留 50 页、7 天；可随时重新翻译，更新本页结果。页面暂存与词句库分开保存。</p><button class="btn small" type="button" data-action="clear-page-cache" ${cache.count ? '' : 'disabled'}>清除页面暂存</button></section>`;
}
function dataPage() {
  return heading('数据与隐私', '') +
    `<section class="card" id="installation-status"><h2>安装与升级</h2><p class="section-description">${chrome.runtime.getManifest().key?'已使用固定插件身份。加载新版目录后，配置和数据仍归属于同一插件；请勿先卸载。':'当前沿用原目录的插件身份。升级时请运行新版安装包中的“升级点译”，选择原安装目录，再重新加载原来的插件。'}</p><p class="field-help">如果换目录后变空，请先回到旧插件查看，原数据可能仍在那里。升级工具只更新程序文件，不读取 Key 或修改浏览器数据库。仅会话保存的 Key 会在重新加载后失效。</p><div class="data-actions"><button class="btn" data-action="manage-extensions">打开扩展管理</button><a class="btn" href="model-library-guide.html" target="_blank" rel="noopener">查看升级与找回说明</a></div></section><section class="card"><div class="section-title">${icon('library')}<h2>本地词句库。</h2></div><div class="data-stat"><div class="data-icon">${icon('library')}</div><div><strong>${state.count} <span style="font-size:13px">个词句</span></strong><p>${new Set(entries.map(entry => entry.source?.domain).filter(Boolean)).size} 个来源网站 · 本地保存</p></div></div><div class="data-actions"><button class="btn" data-action="export">${icon('download')}导出词库 JSON</button><button class="btn" data-action="import-vocabulary">恢复词库 JSON</button><button class="btn danger" data-action="clear-library" ${state.count ? '' : 'disabled'}>${icon('trash')}清空本地词库</button></div><p class="field-help" style="margin-top:16px">卸载扩展、清除扩展数据前，请先导出备份。词库由本地数据库持久保存，并自动更新本机副本；同一安装目录覆盖升级会保留。旧版换目录会成为另一份插件。请通过升级工具保留原身份；卸载前导出 JSON，之后可合并恢复，已有释义不被覆盖。</p><p class="field-help" role="status">${state.vocabularyBackup?.error?esc(state.vocabularyBackup.error):`本地自动副本：${state.vocabularyBackup?.count||0} 个词句${state.vocabularyBackup?.updatedAt?` · ${date(state.vocabularyBackup.updatedAt)} 更新`:""}`}</p><button class="btn small subtle" data-action="backup-vocabulary">更新本地副本</button></section>${pageCacheCard()}<section class="card"><h2>阅读轨迹与回顾</h2><p class="section-description">长期保存在本地，独立于可淘汰的页面译文缓存。清理前请先导出需要保留的知识。</p><div class="data-actions"><a class="btn" href="#trails">查看或导出轨迹</a><a class="btn" href="#reviews">查看阅读回顾</a><button class="btn danger" data-action="clear-knowledge">清空轨迹与回顾</button></div></section><section class="card"><div class="section-title">${icon('shield')}<h2>只发送当前任务需要的内容。</h2></div><ul class="privacy-list"><li>${icon('check')}<div>只发送你确认翻译的文本。<small>划词只发送选区和可选语境；按段发送完整段落；点击整页翻译后分块发送当前页面可读文字。手动发起或开启自动总结后，才读取已加载的主要可见正文，结合少量相关阅读摘要与备注，保存在本地轨迹中；周期回顾使用已保存摘要。输入值、编辑内容和 Cookie 不进入请求。</small></div></li><li>${icon('check')}<div>自动标记直接读取本地词库。<small>再次遇见同词时复用已存释义，不自动请求模型。</small></div></li><li>${icon('check')}<div>密钥与词库分开保存。<small>模型库统一保存；网页脚本无法读取。导出文件不包含 API Key、服务请求头或连接凭据。</small></div></li></ul><button class="btn small" data-action="clear-model-keys">${icon('lock')}清除模型库全部 Key</button></section>`;
}
function help() {
  return heading('使用指南', '') +
    `<section class="card"><div class="section-title">${icon('book')}<h2>开始阅读。</h2></div><ol class="help-steps"><li><div><strong>连接你自己的模型</strong><p>在“模型库”中选择厂家，填入 API Key 后点击“连接并保存”；可保存多个 Key，指定默认和备用。也可选择“本机 Codex”，按指引复用本机登录。</p><a class="link-btn" href="#model">打开模型库 ${icon('arrow')}</a></div></li><li><div><strong>打开网页即可使用</strong><p>普通网页默认开启，无需逐站授权或添加白名单。需要停用时，在插件浮窗或右键菜单关闭此网站，加入黑名单。</p></div></li><li><div><strong>选中文字，点击目标语言翻译</strong><p>胶囊只显示“中文”等目标语言；点击语言即翻译，下拉切换并记住语言，更多中设置语境。短选区成功后自动保存；长选区或跨块选区按完整段落对照，不添加下划线或括号。选区最多 16000 字符。</p></div></li><li><div><strong>回到文字身边，随时查看与修改</strong><p>短词悬浮查看释义，可编辑或删除。长文可点击插件弹窗“翻译整页”，选择双语对照或仅译文；右下角控制条支持切换、停止、继续、重试与恢复原文。</p></div></li></ol></section><section class="card"><div class="section-title">${icon('help')}<h2>常见问题。</h2></div><ul class="privacy-list"><li>${icon('arrow')}<div>为什么新网站没有下划线？<small>确认网站不在黑名单中，且词库已有当前目标语言对应的词句。浏览器扩展详情中的网站访问权限需允许。</small></div></li><li>${icon('arrow')}<div>重新打开浏览器后需要填写密钥？<small>只保留本次会话的密钥不会跨浏览器重启；可勾选“在此浏览器长期记住密钥”。</small></div></li><li>${icon('arrow')}<div>哪些页面暂不支持？<small>浏览器内部页、扩展商店、内置 PDF、图片和 Canvas 文字；iframe 和 Shadow DOM 组件内的内容。代码、输入值与可编辑内容保留。整页翻译覆盖正文、导航及控件标签。</small></div></li><li>${icon('arrow')}<div>如何安装或升级？<small>首次安装可加载已解压的扩展。已有安装请先运行新版安装包中的“升级点译”，选择原安装目录，再到扩展管理页重新加载原来的插件。旧版没有固定身份，直接加载新目录会得到空白的新实例；不要卸载原插件。</small></div></li></ul></section>`;
}
function collectPrefs() {
  const draft = prefsDraft || { ...state.prefs };
  if (document.getElementById('preferences-form')) {
    draft.targetLanguage = document.getElementById('target-language').value;
    draft.includeContext = document.getElementById('include-context').checked;
    draft.batchSize = Number(document.getElementById('batch-size').value);
    draft.bilingualFontReduction = Number(document.getElementById('bilingual-font-reduction').value);
    draft.translationColorLight = document.getElementById('color-light-hex').value;
    draft.translationColorDark = document.getElementById('color-dark-hex').value;
    if (draft.style === 'custom') draft.customPrompt = document.getElementById('style-prompt').value;
  }
  return draft;
}
function readProfile() {
  modelDraft = collectModelDraft(document.getElementById('model-form'), modelDraft);
  return modelDraft.purpose === 'summary' ? cleanSummaryProfile(modelDraft) : cleanProfile(modelDraft);
}
async function connectModel(save) {
  const form = document.getElementById('model-form');
  if (!form.reportValidity()) return;
  const profile = readProfile(), apiKey = modelDraft.apiKey, requestedPurpose = modelDraft.purpose, editingId = modelEditingId;
  const requestedSection = section;
  const current = () => form.isConnected && section === requestedSection && modelEditingId === editingId;
  const result = form.querySelector('#connection-result'), controls = form.querySelector('#model-controls');
  result.classList.remove('error'); result.textContent = '正在验证连接…'; controls.disabled = true;
  try {
    if (!await (profile.provider === 'codex' ? chrome.permissions.request({ permissions: ['nativeMessaging'] }) : requestHost(profile.endpoint))) throw new Error('浏览器未允许访问该连接，未发送测试请求。');
    if (!current()) return;
    const signature = await digest(JSON.stringify([requestedPurpose, profile.provider, profile.endpoint, profile.model, profile.auth, profile.timeoutSeconds, editingId, apiKey]));
    let verified = testedConnection;
    if (!save || !verified || verified.signature !== signature) {
      const response = await api(requestedPurpose === 'summary' ? 'TEST_SUMMARY_MODEL' : 'TEST_MODEL', { profile, apiKey });
      verified = { signature, ...response };
    }
    if (!current()) return;
    testedConnection = verified;
    if (save) {
      const assign = requestedPurpose === 'summary' && modelDraft.makeDefault;
      const saved = await api(assign ? 'SAVE_SUMMARY_PROFILE' : 'MODEL_LIBRARY_SAVE', { profile, apiKey, connectionId: editingId, ...(assign ? { makeDefault: true } : {}) });
      if (!current()) { await refreshData(); notify(`${requestedPurpose === 'summary' ? '总结' : '翻译'}连接已保存`); return; }
      modelEditingId = saved.id; modelDraft = null; testedConnection = null;
      await refreshData(); if (section !== requestedSection) return; draw();
      const savedResult = document.getElementById('connection-result');
      if (savedResult) savedResult.innerHTML = `<strong>${icon('check')} 已连接并保存</strong><span>${requestedPurpose === 'summary' ? '流式测试：' : 'curiosity → '}${esc(verified.translation)}</span>`;
      notify('模型已保存到本地，可在翻译和总结场景直接选择');
    } else {
      result.innerHTML = `<strong>${icon('check')} 连接成功 · ${(verified.elapsedMs / 1000).toFixed(2)} 秒</strong><span>${requestedPurpose === 'summary' ? '流式测试：' : 'curiosity → '}${esc(verified.translation)}</span><p class="field-help">点击“连接并保存”即可开始使用。</p>`;
    }
  } catch (error) { if (current()) { result.classList.add('error'); result.textContent = error.message; testedConnection = null; } }
  finally { if (controls.isConnected) controls.disabled = false; }
}
function openModal(title, body, actions) {
  modal.innerHTML = `<div class="modal-head"><h2 id="modal-title">${title}</h2><button class="icon-btn" type="button" data-action="close-modal" aria-label="关闭对话框">${icon('close')}</button></div><div class="modal-body">${body}</div><div class="modal-foot">${actions}</div>`;
  modal.classList.toggle('term-detail', title === '词句详情');
  modal.showModal();
}
function showDetail(entry) {
  openModal('词句详情', `<div class="modal-word">${esc(entry.text)}</div><span class="tag green">${kinds[entry.kind] || '词句'} · ${esc(LANGUAGES[entry.targetLanguage] || entry.targetLanguage)} · ${STYLES[entry.style] || '已存'}风格</span>${entry.context ? `<div class="context-quote">${esc(entry.context)}</div>` : '<p style="margin-top:16px">收藏时没有保存相邻语境。</p>'}<p>${entry.source?.url && pageOrigin(entry.source.url) ? `<a href="${esc(entry.source.url)}" target="_blank" rel="noopener noreferrer">${esc(entry.source.title || entry.source.domain)} ↗</a>` : esc(entry.source?.domain || '本地收藏')}<br>收藏于 ${date(entry.createdAt)} · ${esc(entry.modelName || '自定义模型')}</p><label class="form-label" for="edit-translation">已存释义</label><textarea class="input" id="edit-translation" maxlength="2000">${esc(entry.translation)}</textarea><p class="field-help">保存后，所有对应网页标记都会使用这个释义。</p><p class="field-error" id="edit-error" role="alert"></p>`, `<button class="btn subtle" type="button" data-action="close-modal">取消</button><button class="btn primary" type="button" data-save-entry="${esc(entry.id)}">保存释义</button>`);
}
async function remove(ids) {
  const result = await api('DELETE', { ids }); selected.clear(); if (modal.open) modal.close(); await refreshData(); draw();
  notify(`已删除 ${result.removed} 个词句，并移除对应网页标记`, async () => { await api('UNDO', { token: result.token }); await refreshData(); draw(); });
}
async function busy(button, work) {
  if (actionBusy) return; actionBusy = true; if (button) button.disabled = true;
  try { await work(); } catch (error) { notify(error.message); }
  finally { actionBusy = false; if (button?.isConnected) button.disabled = false; }
}
async function updateScene(purpose,id,{action,enabled,makeDefault=true}={}) {
  const requested=section,form=document.getElementById('model-form');
  if(form)modelDraft=collectModelDraft(form,modelDraft);
  if(action)await api('CONNECTION_UPDATE',{purpose,id,action,enabled});
  else await api('MODEL_ASSIGN',{purpose,id,makeDefault});
  await refreshData();if(section===requested)draw();notify('场景模型已更新，直接复用已保存的连接与 Key');
}
async function checkCodex() {
  const status = document.getElementById('codex-status'), form = status.closest('form'), draft = modelDraft;
  status.textContent = '正在检测本机助手与 Codex 登录…';
  try {
    if (!await chrome.permissions.request({ permissions: ['nativeMessaging'] })) throw new Error('尚未允许连接本机应用，未进行检测。');
    const result = await api('CODEX_STATUS');
    if (!form.isConnected || modelDraft !== draft) return;
    modelDraft.codexModels = result.models || [];
    document.getElementById('codex-models').replaceChildren(...modelDraft.codexModels.map(item => { const option = document.createElement('option'); option.value = item.id; return option; }));
    status.textContent = result.ready ? `已连接本机 Codex · ${result.authType === 'chatgpt' ? 'ChatGPT 登录' : '本机已配置的认证'} · ${modelDraft.codexModels.length} 个可用型号。点击“连接并保存”可完成测试。` : 'Codex 尚未登录。请在终端运行 codex login，完成登录后再次检测。';
  } catch (error) { status.textContent = error.message; }
}
document.addEventListener('invalid', event => {
  for (let details = event.target.closest('details'); details; details = details.parentElement.closest('details')) details.open = true;
}, true);
document.addEventListener('submit', event => {
  event.preventDefault(); const form = event.target, button = form.querySelector('button[type="submit"]');
  if (form.id === 'preferences-form') busy(button, async () => { await api('SAVE_PREFS', { prefs: cleanPrefs(collectPrefs()) }); prefsDraft = null; rememberSettings(); const draft = settingsDrafts.get('preferences-form'); draft.values = []; await refreshData(); draw(); notify('翻译偏好已保存'); });
  if (form.id === 'model-form') busy(button, () => connectModel(true));
  if (form.id === 'summary-preferences') busy(button, async () => {
    const prompts = Object.fromEntries([...form.querySelectorAll('[data-summary-prompt]')].map(input => [input.dataset.summaryPrompt, input.value]));
    await api('SAVE_SUMMARY_PREFS', { prefs: { preset: document.getElementById('default-summary-preset').value, prompts } });
    rememberSettings(); settingsDrafts.delete(form.id); await refreshData(); draw(); notify('总结偏好已保存');
  });
  if(form.id==='knowledge-preferences')busy(button,async()=>{const prompts=Object.fromEntries([...form.querySelectorAll('[data-knowledge-prompt]')].map(n=>[n.dataset.knowledgePrompt,n.value]));await api('KNOWLEDGE_PREFS',{prefs:{time:document.getElementById('knowledge-time').value,timeZone:document.getElementById('knowledge-zone').value,prompts}});rememberSettings();settingsDrafts.delete(form.id);await refreshData();draw();notify('回顾设置已保存');});
  if (form.id === 'site-form') busy(button, async () => {
    const error = document.getElementById('site-error'); error.textContent = '';
    try {
      const site = blacklistSite(document.getElementById('site-input').value);
      await api('BLACKLIST_SET', { site, blocked: true }); await refreshData(); draw(); notify('已加入黑名单，此网站已停用');
    } catch (failure) { error.textContent = failure.message; }
  });
});
document.addEventListener('click', event => {
  const jump = event.target.closest('[data-model-scene]');
  if (jump && section === 'model' && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
    event.preventDefault();
    const destination = jump.dataset.modelScene;
    const target = destination === 'library' ? document.querySelector('.connection-manager') : document.getElementById(`scene-${destination}-model`).closest('section');
    if (destination !== 'library' && !modelFormOpen) {
      modelPurpose = destination;
      groupLocation.set('models', destination === 'summary' ? 'model-summary' : 'model');
      history.replaceState(null, '', '#' + groupLocation.get('models'));
    }
    target.scrollIntoView({ block: 'start' });
    (target.querySelector('select, button:not(:disabled)') || jump).focus({ preventScroll: true });
    return;
  }
  const button = event.target.closest('button'); if (!button) return;
  if(button.dataset.sceneAction){busy(button,()=>updateScene(button.dataset.purpose,button.dataset.connectionId,{action:button.dataset.sceneAction}));return;}
  if(button.dataset.libraryDelete){
    const item=state.modelLibrary.items.find(item=>item.id===button.dataset.libraryDelete);if(!item)return;
    const uses=['translation','summary'].filter(p=>state.modelConnections[p].items.some(i=>i.id===item.id)).map(p=>p==='translation'?'翻译':'总结与回顾');
    openModal('删除保存的模型？',`<p>将删除「${esc(item.profile.name)}」及其 Key。${uses.length?`当前用于${uses.join('、')}；默认场景会改用已选备用，没有备用时需要重新选择模型。`:'其他模型和本地资料保留。'}</p>`,`<button class="btn subtle" data-action="close-modal">取消</button><button class="btn danger" data-confirm-library-delete="${esc(item.id)}">删除模型</button>`);return;
  }
  if(button.dataset.confirmLibraryDelete){busy(button,async()=>{await api('MODEL_LIBRARY_DELETE',{id:button.dataset.confirmLibraryDelete});modelDraft=null;modelEditingId=undefined;modelFormOpen=false;modal.close();await refreshData();draw();notify('模型及其 Key 已从本地模型库移除');});return;}
  if (button.dataset.editConnection) { if (actionBusy) return; modelFormOpen=true; modelEditingId = button.dataset.editConnection; modelDraft = null; testedConnection = null; draw(); document.getElementById('model-name')?.focus(); return; }
  if (button.dataset.resetSummaryPrompt) { const key = button.dataset.resetSummaryPrompt; document.getElementById(`prompt-${key}`).value = SUMMARY_PRESETS[key].prompt; return; }
  if (button.dataset.colorChoice) { updateReadingColor(document.getElementById('preferences-form'), button.dataset.colorTheme, button.dataset.colorChoice); return; }
  if (button.dataset.resetColor) { updateReadingColor(document.getElementById('preferences-form'), button.dataset.resetColor, defaultReadingColor(button.dataset.resetColor)); return; }
  if (button.dataset.provider) { if (actionBusy || button.dataset.provider === modelDraft.provider) return; modelDraft = changeProvider(collectModelDraft(document.getElementById('model-form'), modelDraft), button.dataset.provider); testedConnection = null; draw(); return; }
  if (button.dataset.mode) { rememberSettings(); prefsDraft = collectPrefs(); prefsDraft.displayMode = button.dataset.mode; draw(); document.querySelector(`[data-mode=${button.dataset.mode}]`)?.focus({ preventScroll: true }); return; }
  if (button.dataset.style) { rememberSettings(); prefsDraft = collectPrefs(); prefsDraft.style = button.dataset.style; settingsDrafts.get('preferences-form').values = settingsDrafts.get('preferences-form').values.filter(([id]) => id !== 'custom-style' && id !== 'style-prompt'); draw(); return; }
  if (button.dataset.page != null) { page = Number(button.dataset.page); selected.clear(); renderTable(); return; }
  if (button.dataset.detail) { const entry = entries.find(entry => entry.id === button.dataset.detail); if (entry) showDetail(entry); return; }
  if (button.dataset.delete) { busy(button, () => remove([button.dataset.delete])); return; }
  if (button.dataset.saveEntry) { busy(button, async () => {
    const translation = document.getElementById('edit-translation').value.trim();
    if (!translation) { document.getElementById('edit-error').textContent = '请填写释义后保存。'; return; }
    const id = button.dataset.saveEntry;
    try { await api('EDIT_ENTRY', { id, translation }); }
    catch (error) { document.getElementById('edit-error').textContent = error.message; return; }
    modal.close(); await refreshData(); draw(); document.querySelector(`.word-link[data-detail="${CSS.escape(id)}"]`)?.focus(); notify('释义已更新，网页标记将同步使用');
  }); return; }
  if (button.dataset.siteRemove) { busy(button, async () => { await api('BLACKLIST_SET', { site: button.dataset.siteRemove, blocked: false }); await refreshData(); draw(); notify('已移出黑名单，恢复使用'); }); return; }
  switch (button.dataset.action) {
    case 'new-connection': if (!actionBusy) { modelFormOpen=true; modelEditingId = null; modelDraft = null; testedConnection = null; draw(); document.getElementById('model-name')?.focus(); } break;
    case 'close-model-editor': modelFormOpen=false;modelDraft=null;modelEditingId=null;testedConnection=null;draw();document.querySelector('[data-action=new-connection]')?.focus();break;
    case 'codex-status': busy(button, checkCodex); break;
    case 'manage-extensions': chrome.tabs.create({url:'chrome://extensions/'}); break;
    case 'copy-codex-install': busy(button, async () => { await navigator.clipboard.writeText(`python3 install.py --extension-id ${chrome.runtime.id}`); notify('安装命令已复制，请在安装包的 native-host 文件夹中运行'); }); break;
    case 'close-modal': modal.close(); break;
    case 'export': busy(button, async () => { downloadJSON(await api('EXPORT')); notify('词库已导出，不包含模型密钥'); }); break;
    case 'cancel-selection': selected.clear(); renderTable(); break;
    case 'clear-filter': filter = 'all'; page = 0; selected.clear(); draw(); document.getElementById('term-filter').focus(); break;
    case 'clear-search': query = ''; page = 0; draw(); document.getElementById('term-search').focus(); break;
    case 'delete-selected': openModal('删除这些词句？', `<p>将删除选中的 ${selected.size} 个词句，并移除它们在已启用网页中的标记。删除后有 8 秒可以撤销。</p>`, `<button class="btn subtle" type="button" data-action="close-modal">取消</button><button class="btn danger" type="button" data-action="confirm-selected">删除 ${selected.size} 个词句</button>`); break;
    case 'confirm-selected': busy(button, () => remove([...selected])); break;
    case 'clear-library': openModal('清空本地词库？', `<p>将删除全部 ${entries.length} 个词句和对应网页标记，网站黑名单与偏好会保留。建议先导出备份。清空后有 8 秒可以撤销。</p>`, `<button class="btn subtle" type="button" data-action="close-modal">取消</button><button class="btn danger" type="button" data-action="confirm-clear">清空 ${entries.length} 个词句</button>`); break;
    case 'confirm-clear': busy(button, () => remove(entries.map(entry => entry.id))); break;
    case 'clear-page-cache': busy(button, async () => { await api('CLEAR_PAGE_CACHE'); await refreshData(); draw(); notify('页面暂存已清除'); }); break;
    case 'clear-knowledge': openModal('清空阅读轨迹与回顾？','<p>将删除本地所有访问记录、原文快照、总结和依赖关系，包括已加入黑名单的历史资料。此操作不可撤销，请先导出备份。</p>','<button class="btn subtle" data-action="close-modal">取消</button><button class="btn danger" data-action="confirm-clear-knowledge">确认清空</button>');break;
    case 'confirm-clear-knowledge': busy(button,async()=>{await api('KNOWLEDGE_CLEAR');clearKnowledgeDrafts();modal.close();await refreshData();draw();notify('阅读轨迹与回顾已清空');});break;
    case 'import-vocabulary':button.closest('details')?.removeAttribute('open');document.getElementById('vocabulary-file').click();break;
    case 'backup-vocabulary':busy(button,async()=>{await api('VOCABULARY_BACKUP');await refreshData();draw();notify('词库本地副本已更新');});break;
    case 'clear-model-keys':openModal('清除模型库全部 Key？','<p>将清除所有已保存连接的 Key，引用这些连接的翻译、总结与回顾都会受到影响。模型配置、词库和阅读资料保留。</p>','<button class="btn subtle" data-action="close-modal">取消</button><button class="btn danger" data-action="confirm-clear-model-keys">清除所有 Key</button>');break;
    case 'confirm-clear-model-keys':busy(button,async()=>{await api('CLEAR_MODEL_KEYS');await refreshData();modal.close();draw();notify('模型库全部 Key 已清除');});break;
    case 'clear-key': busy(button, async () => { await api('CLEAR_KEY'); await refreshData(); draw(); notify('已清除密钥，词句库与模型地址仍保留'); }); break;
    case 'clear-summary-key': busy(button, async () => { await api('CLEAR_SUMMARY_KEY'); await refreshData(); modelDraft = null; draw(); notify('总结密钥已清除'); }); break;
    case 'toggle-key': { const field = document.getElementById('model-key'); field.type = field.type === 'password' ? 'text' : 'password'; break; }
    case 'test-model': busy(button, () => connectModel(false)); break;
    case 'use-recommended-model': modelDraft = useRecommendedModel(collectModelDraft(document.getElementById('model-form'), modelDraft)); testedConnection = null; draw(); break;
  }
});
document.addEventListener('input', event => {
  const color = event.target.id.match(/^color-(light|dark)(?:-hex)?$/);
  if (color) updateReadingColor(document.getElementById('preferences-form'), color[1], event.target.value);
  if (event.target.id === 'term-search' && !event.isComposing) { query = event.target.value; page = 0; selected.clear(); clearTimeout(searchTimer); searchTimer = setTimeout(renderTable, 100); }
  if (event.target.id === 'other-model') { const form = document.getElementById('model-form'); modelDraft = collectModelDraft(form, modelDraft); testedConnection = null; updateModelGuidance(form, modelDraft); }
});
document.addEventListener('compositionend', event => {
  if (event.target.id === 'term-search') event.target.dispatchEvent(new Event('input', { bubbles: true }));
});
document.addEventListener('change', event => {
  const input = event.target;
  if (input.id === 'auto-summary-setting') {
    if (actionBusy) { input.checked = state.knowledgePrefs.autoSummary; return; }
    const enabled = input.checked;
    busy(input, async () => {
      try {
        await api('AUTO_SUMMARY_SET', { enabled });
        input.defaultChecked = enabled;
        await refreshData();
        notify(enabled ? '已开启后台总结与定时回顾' : '已关闭自动总结，手动操作仍可用');
      } catch (error) { input.checked = !enabled; throw error; }
    });
    return;
  }
  if(input.id==='bilingual-font-reduction')document.getElementById('reading-preferences-card').style.setProperty('--preview-font-reduction',`${Number(input.value)}px`);
  if(input.id==='vocabulary-file'){const file=input.files?.[0];input.value='';if(file)busy(null,async()=>{if(file.size>16*1024*1024)throw Error('词库文件超过 16 MB，请分批恢复。');let data;try{data=JSON.parse(await file.text());}catch{throw Error('文件不是有效的词库 JSON，请选择点译导出的备份。');}const result=await api('VOCABULARY_IMPORT',{data});await refreshData();draw();notify(`已恢复 ${result.added} 个词句，保留 ${result.skipped} 个已有词句`);});return;}
  if(input.dataset.sceneDefault){busy(input,()=>updateScene(input.dataset.sceneDefault,input.value));return;}
  if(input.dataset.sceneAdd&&input.value){busy(input,()=>updateScene(input.dataset.sceneAdd,input.value,{makeDefault:false}));return;}
  if(input.dataset.sceneBackup){busy(input,()=>updateScene(input.dataset.sceneBackup,input.dataset.connectionId,{action:'backup',enabled:input.checked}));return;}
  if (input.id === 'sort' || input.id === 'term-filter') {
    if (input.id === 'sort') sort = input.value; else filter = input.value;
    selected.clear(); page = 0; renderTable();
  }
  if (input.id === 'custom-style') { rememberSettings(); prefsDraft = collectPrefs(); prefsDraft.style = input.checked ? 'custom' : 'regular'; const draft = settingsDrafts.get('preferences-form'); draft.values = draft.values.filter(([id]) => id !== 'custom-style' && id !== 'style-prompt'); draft.open[draft.open.length - 1] = input.checked; draw(); }
  if (input.id === 'auth-type') { const key = document.getElementById('model-key'); key.disabled = input.value === 'none'; key.required = input.value !== 'none' && !savedProfile().hasKey; }
  if (input.id === 'provider-region') { modelDraft = changeRegion(collectModelDraft(document.getElementById('model-form'), modelDraft), input.value); testedConnection = null; draw(); }
  if (input.id === 'model-id' && input.tagName === 'SELECT') {
    modelDraft = collectModelDraft(document.getElementById('model-form'), modelDraft); testedConnection = null; draw();
    document.getElementById(modelDraft.manualModel ? 'other-model' : 'model-id')?.focus({ preventScroll: true });
  }
  if (input.dataset.select) { input.checked ? selected.add(input.dataset.select) : selected.delete(input.dataset.select); renderTable(); }
  if (input.id === 'select-page') { filteredEntries().slice(page * pageSize, (page + 1) * pageSize).forEach(entry => input.checked ? selected.add(entry.id) : selected.delete(entry.id)); renderTable(); }
});
document.addEventListener('click', event => {
  for (const details of document.querySelectorAll('.action-details[open]')) {
    if (!details.contains(event.target)) details.open = false;
  }
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  const details = event.target.closest('.action-details[open]');
  if (details) { details.open = false; details.querySelector('summary').focus(); }
});
modal.addEventListener('click', event => { if (event.target === modal) { const rect = modal.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) modal.close(); } });
window.addEventListener('hashchange', () => route().catch(error => notify(error.message)));
chrome.runtime.onMessage.addListener(message => {
  if (message?.type === 'SHIYI/UI_CHANGED') refreshData().then(() => {
    if (section === 'library' && !actionBusy && !modal.open) renderTable();
    const automatic = document.getElementById('auto-summary-setting');
    if (automatic && !automatic.disabled) automatic.defaultChecked = automatic.checked = state.knowledgePrefs.autoSummary;
    if (section === 'sites' && !actionBusy && !document.getElementById('site-input')?.value) {
      const displayed = [...document.querySelectorAll('.domain-item .domain-name')].map(node => node.textContent);
      if (JSON.stringify(displayed) !== JSON.stringify(state.blacklist)) draw();
    }
  }).catch(() => {});
});
refreshData().then(route).catch(error => { app.innerHTML = `<div class="empty"><h3>${error.code==='UPGRADE_REQUIRED'?'完成本次升级':'暂时无法打开阅读空间。'}</h3><p>${esc(error.message)}</p><button class="btn primary" id="retry">${error.code==='UPGRADE_REQUIRED'?'打开扩展管理':'重试'}</button></div>`; document.getElementById('retry').onclick = () => error.code==='UPGRADE_REQUIRED'?chrome.tabs.create({url:'chrome://extensions/'}):location.reload(); });
