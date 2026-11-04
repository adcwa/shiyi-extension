import { LANGUAGES, STYLES, PROMPTS, DEFAULT_PROFILE, cleanPrefs, cleanProfile, pageOrigin, normalize, digest } from '../lib/core.js';
import { api, brand, downloadJSON, esc, icon, languageOptions, notify, requestHost } from './common.js';
import { initialModelDraft, collectModelDraft, changeProvider, changeRegion, useRecommendedModel, updateModelGuidance, modelForm } from './model-setup.js';
import { blacklistSite } from '../lib/site-policy.js';
import { readingSettings, updateReadingColor, defaultReadingColor } from './reading-settings.js';
import { SUMMARY_PRESETS, cleanSummaryProfile, summaryPresetProfile } from '../lib/summary-presets.js';
import { enhanceIntroduction } from './intro.js';
import { connectionManager } from './connections.js';
import { mountKnowledge, knowledgePreferences, clearKnowledgeDrafts } from './knowledge.js';

const app = document.getElementById('app'), modal = document.getElementById('modal');
const sections = { library: ['library', '我的词句库'], trails:['globe','我的轨迹'], reviews:['book','阅读回顾'], translation: ['sliders', '翻译偏好'], model: ['cpu', '模型连接'], summary: ['spark', '总结设置'], sites: ['globe', '网站黑名单'], data: ['shield', '数据与隐私'], help: ['help', '使用指南'], about: ['book', '产品介绍'] };
const kinds = { word: '单词', phrase: '短语', sentence: '句子' };
let state, entries = [], section = 'library', prefsDraft, query = '', filter = 'all', sort = 'new', page = 0, selected = new Set(), actionBusy = false, detailOpened = false, searchTimer;
const pageSize = 50;
let modelDraft, modelEditingId, testedConnection, introDispose, introAbort, knowledgeDispose;
const purpose = () => section === 'summary' ? 'summary' : 'translation';
const modelBank = () => state.modelConnections?.[purpose()] || { defaultId: '', items: [] };
const savedProfile = () => modelBank().items.find(item => item.id === modelEditingId)?.profile || { ...(purpose() === 'summary' ? summaryPresetProfile() : DEFAULT_PROFILE), connectionId: null, hasKey: false };
function prepareModel() {
  const bank = modelBank();
  if (modelEditingId === undefined) modelEditingId = bank.defaultId || null;
  modelDraft ||= initialModelDraft(savedProfile(), purpose());
  modelDraft.connectionId = modelEditingId;
  modelDraft.isDefault = modelEditingId !== null && modelEditingId === bank.defaultId;
  if (modelDraft.isDefault || !bank.items.length) modelDraft.makeDefault = true;
}
const date = time => new Date(time).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
const heading = (eyebrow, title, text, actions = '') => `<div class="page-heading"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${text}</p></div>${actions}</div>`;
const footer = () => `<footer class="work-footer"><span>${icon('lock')}${['trails','reviews'].includes(section)?'阅读资料':'你的词句'}，保存在此浏览器</span><span>点译 v${esc(state.version)} · 让遇见的词，留下来。</span></footer>`;
function draw() {
  introDispose?.(); introDispose = null; introAbort?.abort(); knowledgeDispose?.();knowledgeDispose=null;
  document.title = `点译 · ${sections[section][1]}`;
  app.className = 'app-shell';
  const connectionProfile=['trails','reviews','summary'].includes(section)?state.summaryProfile:state.profile;const connectionSection=['trails','reviews','summary'].includes(section)?'summary':'model';
  app.innerHTML = `<aside class="sidebar" aria-label="主导航">${brand()}<p class="brand-caption">让遇见的词，留下来。</p><div class="nav-caption">我的阅读空间</div><nav>${Object.entries(sections).map(([key, [glyph, title]]) => `<a class="nav-item ${key === section ? 'active' : ''}" href="#${key}" aria-label="${title}" ${key === section ? 'aria-current="page"' : ''}>${icon(glyph)}<span>${title}</span>${key === 'library' ? `<span class="count" id="nav-count">${state.count}</span>` : ''}</a>`).join('')}</nav><div class="sidebar-foot">${icon('leaf')}<h3>从遇见，到记住。</h3><p>让释义回到文字身边，<br>让阅读回到自己的节奏。</p><div class="local-device">${icon('monitor')}本地阅读空间</div></div></aside><div class="workspace"><header class="topbar"><div class="breadcrumbs"><span class="muted">工作空间</span><span class="muted">/</span><span>${sections[section][1]}</span></div><div class="topbar-status">${connectionProfile.endpoint ? `<span class="tag green">${icon('cpu')}${esc(connectionProfile.name)}</span>` : `<a href="#${connectionSection}">连接${connectionSection==='summary'?'总结':'翻译'}模型 ↗</a>`}<span class="status-description">无需账号 · 本地词库</span></div></header><main id="main">${section === 'library' ? library() : ['trails','reviews'].includes(section)?'<div id="knowledge-root"></div>': section === 'translation' ? translation() : section === 'model' ? model() : section === 'summary' ? summarySettings() : section === 'sites' ? sites() : section === 'data' ? dataPage() : section === 'about' ? introduction() : help()}${footer()}</main></div>`;
  if (section === 'library') renderTable();
  if(['trails','reviews'].includes(section))knowledgeDispose=mountKnowledge(document.getElementById('knowledge-root'),{type:section});
  if(section==='summary')document.getElementById('main').insertAdjacentHTML('beforeend',knowledgePreferences(state.knowledgePrefs));
  document.getElementById('main').classList.toggle('intro-main', section === 'about');
  if (section === 'about') mountIntroduction();
  if ((section === 'model' || section === 'summary') && document.getElementById('model-key')) document.getElementById('model-key').value = modelDraft.apiKey || '';
}
async function refreshData() {
  const [nextState, library] = await Promise.all([api('UI_STATE'), api('LIBRARY')]); state = nextState; entries = library.entries;
}
async function route() {
  const route = location.hash.slice(1); section = Object.hasOwn(sections, route) ? route : 'library';
  selected.clear(); prefsDraft = null; modelDraft = null; modelEditingId = undefined; testedConnection = null; draw(); window.scrollTo({ top: 0, behavior: 'instant' });
  const id = new URLSearchParams(location.search).get('entry');
  if (section === 'library' && id && !detailOpened) { detailOpened = true; const entry = entries.find(entry => entry.id === id); if (entry) showDetail(entry); }
}
function layout(content, aside) { return `<div class="settings-layout"><div>${content}</div><aside class="settings-aside">${aside}</aside></div>`; }
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
    host.replaceChildren(); shadow.append(styles, page);
    introDispose = enhanceIntroduction(shadow, { embedded: true, installed: true, modelURL: location.pathname + '#model' });
  } catch (error) {
    if (controller.signal.aborted || !host.isConnected) return;
    host.innerHTML = '<div class="empty"><h2>介绍页暂时无法加载</h2><p>请重新加载扩展，或点击下方按钮重试。</p><button class="btn primary" data-action="reload-introduction">重新打开介绍页</button></div>';
  }
}
function note(glyph, title, text, secondaryTitle = '', secondaryText = '') { return `<div class="aside-note">${icon(glyph)}<h3>${title}</h3><p>${text}</p></div>${secondaryTitle ? `<div class="aside-mini"><h3>${secondaryTitle}</h3><p>${secondaryText}</p><a class="link-btn" href="#help">查看使用指南 ${icon('up')}</a></div>` : ''}`; }
function library() {
  const domains = new Set(entries.map(entry => entry.source?.domain).filter(Boolean));
  return heading('YOUR PERSONAL GLOSSARY', '每一次遇见，都在这里。', `已收藏 ${entries.length} 个词句，${domains.size} 个来源网站。下一次阅读，接着理解。`, `<button class="btn" data-action="export">${icon('download')}导出词库</button>`)
    + `<div class="library-toolbar"><label class="search-field" for="term-search">${icon('search')}<input type="search" id="term-search" placeholder="搜索词句或释义" aria-label="搜索词句或释义" value="${esc(query)}"></label><span class="tag">${icon('monitor')}仅保存在此浏览器</span></div><div class="filter-sort"><div class="filter-tabs" role="group" aria-label="词句类型">${[['all', '全部词句'], ...Object.entries(kinds)].map(([key, name]) => `<button data-filter="${key}" class="${filter === key ? 'active' : ''}" aria-pressed="${filter === key}">${name}<small>${key === 'all' ? entries.length : entries.filter(entry => entry.kind === key).length}</small></button>`).join('')}</div><label class="sr-only" for="sort">排序方式</label><select class="sort-select" id="sort"><option value="new" ${sort === 'new' ? 'selected' : ''}>最近收藏优先</option><option value="alpha" ${sort === 'alpha' ? 'selected' : ''}>按字母排序</option></select></div><div id="batch"></div><section class="table-card" id="table" aria-label="词句列表"></section>`;
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
    table.innerHTML = `<div class="empty">${icon('library')}<h3>${query ? '没有找到这个词句。' : entries.length ? '这里还没有这类词句。' : '把读到的第一个词，留在这里。'}</h3><p>${query ? '换个关键词，也可以搜索中文释义。' : '在网页中点击点译图标，启用后收藏短词句。<br>整页与按段译文保留在阅读模式，不自动进入词库。'}</p>${query ? '<button class="btn" data-action="clear-search">清空搜索</button>' : `<a class="btn primary" href="#${state.profile.endpoint ? 'help' : 'model'}">${state.profile.endpoint ? '了解如何划词' : '连接我的模型'} ${icon('arrow')}</a>`}</div>`; return;
  }
  table.innerHTML = `<table class="term-table"><thead><tr><th class="check-col"><input type="checkbox" id="select-page" aria-label="选择本页全部词句" ${shown.every(entry => selected.has(entry.id)) ? 'checked' : ''}></th><th class="word-col" scope="col">原文 / 类型</th><th class="meaning-col" scope="col">已存释义</th><th class="source-col" scope="col">遇见于</th><th class="actions-col" scope="col"><span class="sr-only">操作</span></th></tr></thead><tbody>${shown.map(entry => `<tr><td class="check-col"><input type="checkbox" data-select="${esc(entry.id)}" aria-label="选择 ${esc(entry.text)}" ${selected.has(entry.id) ? 'checked' : ''}></td><td><button class="word-link" data-detail="${esc(entry.id)}">${esc(entry.text)}</button><div class="word-sub"><span>${kinds[entry.kind] || '词句'}</span><span>·</span><span>${esc(LANGUAGES[entry.targetLanguage] || entry.targetLanguage)}</span></div></td><td class="meaning-cell">${esc(entry.translation)}</td><td class="source-cell">${esc(entry.source?.domain || '本地收藏')}<small>收藏于 ${date(entry.createdAt)}</small></td><td class="actions-col"><button class="icon-btn" data-detail="${esc(entry.id)}" aria-label="编辑 ${esc(entry.text)}">${icon('edit')}</button><button class="icon-btn delete" data-delete="${esc(entry.id)}" aria-label="删除 ${esc(entry.text)}">${icon('trash')}</button></td></tr>`).join('')}</tbody></table><div class="table-footer"><span>显示 ${page * pageSize + 1}–${page * pageSize + shown.length} / ${all.length} 个词句</span><span><button class="btn small subtle" data-page="${page - 1}" ${page === 0 ? 'disabled' : ''}>上一页</button> <span>${page + 1} / ${pages}</span> <button class="btn small subtle" data-page="${page + 1}" ${page >= pages - 1 ? 'disabled' : ''}>下一页</button></span></div>`;
}
function modeButtons(value) { return `<div class="segmented" role="group" aria-label="释义显示方式">${[['hover', 'hover', '悬浮释义'], ['inline', 'inline', '括号释义']].map(([key, glyph, name]) => `<button type="button" data-mode="${key}" class="${value === key ? 'active' : ''}" aria-pressed="${value === key}">${icon(glyph)}${name}</button>`).join('')}</div>`; }
function translation() {
  const prefs = prefsDraft || (prefsDraft = { ...state.prefs });
  const prompt = prefs.style === 'custom' ? prefs.customPrompt : PROMPTS[prefs.style];
  return heading('MAKE IT YOURS', '按你的方式，理解世界。', '设置语言、批次和译文颜色，让阅读更贴近自己的习惯。') + layout(
    `<form id="preferences-form"><section class="card"><div class="section-title">${icon('translate')}<h2>读什么语言，由你决定。</h2></div><p class="section-description">原文语言由模型识别，翻译成你最熟悉的表达。</p><div class="form-row"><label for="target-language">目标语言</label><div><select class="input" id="target-language">${languageOptions(LANGUAGES, prefs.targetLanguage)}</select><p class="field-help">默认简体中文。切换后，仅自动匹配对应目标语言的已存词句。</p></div></div><div class="form-row"><span class="form-label" style="margin:0">释义显示方式</span><div>${modeButtons(prefs.displayMode)}<p class="field-help">用于短词句。长选区按段显示，整页翻译可在插件菜单切换双语或仅译文，不使用下划线或括号。</p></div></div><div class="form-row"><span class="form-label" style="margin:0">语境发送</span><div><label class="check-label"><input type="checkbox" id="include-context" ${prefs.includeContext ? 'checked' : ''}><span>附带选中文本附近的一句语境</span></label><p class="field-help">默认关闭，仅用于短词句。开启后会附带相邻语境；按段与整页翻译会发送对应的完整内容块。</p></div></div></section>${readingSettings(prefs)}<section class="card"><div class="section-title">${icon('spark')}<h2>同一个意思，不同的表达。</h2></div><p class="section-description">风格帮助理解，准确传达原意始终是第一位。</p><div class="style-cards" role="group" aria-label="翻译风格">${[['regular', '常规', '自然、简洁，优先常见表达。'], ['professional', '专业', '术语准确，解释清楚概念与边界。'], ['humorous', '幽默', '先准确解释，再添一点轻松的记忆点。']].map(([key, title, text]) => `<button type="button" data-style="${key}" class="style-card ${prefs.style === key ? 'active' : ''}" aria-pressed="${prefs.style === key}"><strong>${title}${icon(prefs.style === key ? 'check' : key === 'regular' ? 'book' : key === 'professional' ? 'sliders' : 'spark')}</strong><p>${text}</p></button>`).join('')}</div><div class="custom-row"><label class="check-label"><input type="checkbox" id="custom-style" ${prefs.style === 'custom' ? 'checked' : ''}><span>使用我自己的风格提示词</span></label></div><label for="style-prompt" class="form-label">${prefs.style === 'custom' ? '自定义提示词' : '内置风格提示词'}</label><textarea id="style-prompt" class="input" maxlength="4000" ${prefs.style === 'custom' ? '' : 'readonly'}>${esc(prompt)}</textarea><p class="field-help">最多 4000 字符。支持 {{text}} 原文、{{targetLanguage}} 目标语言、{{context}} 可选语境；实际文本以独立资料传给模型。</p><div class="prompt-preview"><span class="tag green">表达示例 · 不消耗模型额度</span><em>less is more</em>${prefs.style === 'professional' ? '通过削减非必要元素，提高信息传达效率。' : prefs.style === 'humorous' ? '少即是多。少一点花里胡哨，脑子就能少加点班。' : prefs.style === 'custom' ? '你写的提示词将在下一次真实翻译时生效。' : '少即是多；保持简洁，效果往往更好。'}</div></section><div class="save-bar"><span>保存后应用颜色和后续批次；修改语言或风格会还原整页译文。</span><button class="btn primary" type="submit">${icon('check')}保存偏好</button></div></form>`,
    note('leaf', '表达可以变，意思要准确。', '无论选择哪种风格，译文都应忠实于原文。专业术语不随意改写，幽默也不喧宾夺主。', '已收藏的释义不会被覆盖', '修改语言、模型或提示词不会自动重译旧词。已有释义可以在词句库中手动编辑。'));
}
function model() {
  prepareModel();
  return heading('YOUR MODELS. YOUR CHOICE.', '选好默认，备好连接。', '保存多个模型或 Key，按需设置默认与备用。') + layout(
    connectionManager(modelBank(), purpose(), modelEditingId) + modelForm(modelDraft, savedProfile()),
    note('spark', '两步就好。', '选择 DeepSeek、通义千问或 OpenAI，粘贴自己的 API Key，点击“连接并保存”。验证成功后即可在普通网页直接划词翻译。', '需要更多选择？', '其他厂家、企业网关和本地模型可使用自定义服务。本机 Codex 可复用已有登录，首次安装本机助手即可。'));
}
function summarySettings() {
  prepareModel();
  return `<div class="page-heading"><div><h1>总结设置</h1><p>为网页归纳与分析单独连接模型，翻译继续使用原来的配置。</p></div></div>` + layout(
    connectionManager(modelBank(), purpose(), modelEditingId) + modelForm(modelDraft, savedProfile()) + `<section class="card"><div class="section-title">${icon('spark')}<h2>总结场景与提示词</h2></div><p class="section-description">自动模式先识别主题，再应用相应预设。只分析当前网页，不进行额外联网检索。</p><form id="summary-preferences"><label class="form-label" for="default-summary-preset">默认总结方式</label><select class="input" id="default-summary-preset">${Object.entries(SUMMARY_PRESETS).map(([key, value]) => `<option value="${key}" ${state.summaryPrefs.preset === key ? 'selected' : ''}>${value.name}</option>`).join('')}</select><div class="summary-prompts">${Object.entries(SUMMARY_PRESETS).filter(([key]) => key !== 'auto').map(([key, value]) => `<details><summary>${value.name}</summary><label class="sr-only" for="prompt-${key}">${value.name}提示词</label><textarea class="input" id="prompt-${key}" data-summary-prompt="${key}" maxlength="6000" rows="5">${esc(state.summaryPrefs.prompts?.[key] || value.prompt)}</textarea><button type="button" class="link-btn" data-reset-summary-prompt="${key}">恢复预设</button></details>`).join('')}</div><p class="field-help">每个提示词最多 6000 字符。保存后应用于下一次总结，不自动重跑已有结果。</p><button class="btn primary" type="submit">保存总结偏好</button></form></section><section class="card"><h2>总结密钥</h2><p>清除此用途的全部主用与备用 Key；翻译连接仍可继续使用。本机 Codex 登录由 Codex 自己管理。</p><button class="btn small" data-action="clear-summary-key">清除全部总结 Key</button></section>`,
    note('book', '侧栏专心展示总结。', '网页在后台自动归纳并存入轨迹。点击弹窗最上方“查看本页总结”或网页右键打开侧栏，直接读取已有结果。侧栏可停止、复制、导出，拖动浏览器分隔线即可调宽。', '选择通用对话模型', '默认推荐 qwen-flash。qwen-mt-* 专用翻译模型不支持总结。生成内容按网页资料归纳，仍需自行核对关键结论。'));
}
function sites() {
  return heading('READY ON EVERY PAGE.', '默认开启，按需停用。', '普通网页可直接划词。把不需要使用点译的网站加入黑名单即可。') + layout(
    `<section class="card"><div class="section-title">${icon('globe')}<h2>网站黑名单。</h2></div><p class="section-description">黑名单中的网站不显示划词工具、词库标记或整页译文。</p><form id="site-form"><label class="form-label" for="site-input">停用网站</label><div class="domain-add"><input class="input" id="site-input" required placeholder="例如：example.com，或粘贴网页地址" autocomplete="off" spellcheck="false" maxlength="2048"><button class="btn primary" type="submit">加入黑名单</button></div><p class="field-help">域名及其子域名都会停用，覆盖 HTTP、HTTPS 和不同端口；恢复后立即生效。</p><p class="field-error" id="site-error" role="alert"></p></form><div class="domain-list">${state.blacklist.length ? state.blacklist.map(site => `<div class="domain-item"><div><div class="domain-name">${esc(site)}</div><small>该域名及其子域名已停用</small></div><div class="domain-actions"><button class="btn small" data-site-remove="${esc(site)}" aria-label="恢复 ${esc(site)}">恢复使用</button></div></div>`).join('') : `<div class="empty" style="padding:37px 15px 20px">${icon('globe')}<h3>所有普通网页已默认开启。</h3><p>黑名单为空，无需逐站添加或开启。<br>选中文字，点击翻译，或使用鼠标右键菜单。</p></div>`}</div></section><p class="small-text muted">加入黑名单会立即移除标记、还原译文并取消该网站的翻译请求。词库和模型配置保留。</p>`,
    note('globe', '右键，一步暂停或恢复。', '在网页中右键打开“点译”，切换“在此网站启用点译”。工具栏浮窗也提供同样的开关。', '默认开启，遵循黑名单', '网页会自动总结并存入本地轨迹，使用独立总结模型。翻译仍由选区或整页入口主动发起。'));
}
function pageCacheCard() {
  const cache = state.pageCache || { count: 0, bytes: 0 };
  return `<section class="card"><div class="section-title">${icon('monitor')}<h2>页面译文暂存。</h2></div><p class="section-description">已暂存 ${cache.count} 个页面，约 ${(cache.bytes / 1048576).toFixed(1)} MB。刷新时核对原文后恢复，不会自动请求模型。</p><p class="field-help">最多保留 50 页、7 天；可随时重新翻译，更新本页结果。页面暂存与词句库分开保存。</p><button class="btn small" type="button" data-action="clear-page-cache" ${cache.count ? '' : 'disabled'}>清除页面暂存</button></section>`;
}
function dataPage() {
  return heading('YOUR WORDS, STAY YOURS.', '你的积累，由你保管。', '无需账号。词库保存在此浏览器，可以随时导出带走。') + layout(
    `<section class="card"><div class="section-title">${icon('library')}<h2>本地词句库。</h2></div><div class="data-stat"><div class="data-icon">${icon('library')}</div><div><strong>${state.count} <span style="font-size:13px">个词句</span></strong><p>${new Set(entries.map(entry => entry.source?.domain).filter(Boolean)).size} 个来源网站 · 本地保存</p></div></div><div class="data-actions"><button class="btn" data-action="export">${icon('download')}导出词库 JSON</button><button class="btn danger" data-action="clear-library" ${state.count ? '' : 'disabled'}>${icon('trash')}清空本地词库</button></div><p class="field-help" style="margin-top:16px">卸载扩展、清除扩展数据前，请先导出备份。当前版本提供导出，暂不支持导入或跨设备同步。</p></section>${pageCacheCard()}<section class="card"><h2>阅读轨迹与回顾</h2><p class="section-description">长期保存在本地，独立于可淘汰的页面译文缓存。清理前请先导出需要保留的知识。</p><div class="data-actions"><a class="btn" href="#trails">查看或导出轨迹</a><a class="btn" href="#reviews">查看阅读回顾</a><button class="btn danger" data-action="clear-knowledge">清空轨迹与回顾</button></div></section><section class="card"><div class="section-title">${icon('shield')}<h2>只发送当前任务需要的内容。</h2></div><ul class="privacy-list"><li>${icon('check')}<div>只发送你确认翻译的文本。<small>划词只发送选区和可选语境；按段发送完整段落；点击整页翻译后分块发送当前页面可读文字。网页总结会自动读取已加载的主要可见正文，结合少量相关阅读摘要与备注，保存在本地轨迹中；周期回顾使用已保存摘要。输入值、编辑内容和 Cookie 不进入请求。</small></div></li><li>${icon('check')}<div>自动标记直接读取本地词库。<small>再次遇见同词时复用已存释义，不自动请求模型。</small></div></li><li>${icon('check')}<div>密钥与词库分开保存。<small>默认会话保存；网页脚本无法读取。导出文件不包含 API Key、服务请求头或连接凭据。</small></div></li></ul><button class="btn small" data-action="clear-key">${icon('lock')}清除全部翻译 Key</button></section>`,
    note('lock', '留在本地，也请记得备份。', '词库没有上传到点译服务器。扩展更新会保留数据；卸载可能删除扩展存储，建议提前导出。', '已存释义的边界', '同词在不同语境可能含义不同。悬浮卡片明确显示“已存释义”，可在词库中编辑；当前版本不自动判断多个义项。'));
}
function help() {
  return heading('A LITTLE HELP. A BETTER READ.', '从一次划词开始。', '连接模型后即可在普通网页划词，也可右键翻译选区或整页。') + layout(
    `<section class="card"><div class="section-title">${icon('book')}<h2>开始阅读。</h2></div><ol class="help-steps"><li><div><strong>连接你自己的模型</strong><p>在“模型连接”中选择厂家，填入 API Key 后点击“连接并保存”；可保存多个 Key，指定默认和备用。也可选择“本机 Codex”，按指引复用本机登录。</p><a class="link-btn" href="#model">打开模型连接 ${icon('arrow')}</a></div></li><li><div><strong>打开网页即可使用</strong><p>普通网页默认开启，无需逐站授权或添加白名单。需要停用时，在插件浮窗或右键菜单关闭此网站，加入黑名单。</p></div></li><li><div><strong>选中文字，点击目标语言翻译</strong><p>胶囊只显示“中文”等目标语言；点击语言即翻译，下拉切换并记住语言，更多中设置语境。短选区成功后自动保存；长选区或跨块选区按完整段落对照，不添加下划线或括号。选区最多 16000 字符。</p></div></li><li><div><strong>回到文字身边，随时查看与修改</strong><p>短词悬浮查看释义，可编辑或删除。长文可点击插件菜单“翻译当前页面”，选择双语对照或仅译文；右下角控制条支持切换、停止、继续、重试与恢复原文。</p></div></li></ol></section><section class="card"><div class="section-title">${icon('help')}<h2>常见问题。</h2></div><ul class="privacy-list"><li>${icon('arrow')}<div>为什么新网站没有下划线？<small>确认网站不在黑名单中，且词库已有当前目标语言对应的词句。浏览器扩展详情中的网站访问权限需允许。</small></div></li><li>${icon('arrow')}<div>重新打开浏览器后需要填写密钥？<small>会话密钥默认不跨浏览器重启保存；需要时可以明确勾选“在此浏览器长期记住密钥”。</small></div></li><li>${icon('arrow')}<div>哪些页面暂不支持？<small>浏览器内部页、扩展商店、内置 PDF、图片和 Canvas 文字；iframe 和 Shadow DOM 组件内的内容。代码、输入值与可编辑内容保留。整页翻译覆盖正文、导航及控件标签。</small></div></li><li>${icon('arrow')}<div>如何安装或升级？<small>把安装包解压，在 Chrome / Edge 的扩展管理页打开开发者模式，选择“加载已解压的扩展”，选择包含 manifest.json 的文件夹。升级时保留原文件夹并在扩展页重新加载；不要卸载重装。</small></div></li></ul></section>`,
    note('leaf', '不打断，是最好的陪伴。', '选区翻译由点击语言、按段或整页入口发起。网页自动总结独立在后台运行，可在轨迹查看，黑名单网站不处理。整页模式期间暂停下划线和括号，普通复制不计入词库。', '遇到无法连接？', '核对地址、模型名称、密钥与额度；服务必须兼容 Chat Completions。没有共享账户或内置付费模型。'));
}
function collectPrefs() {
  const draft = prefsDraft || { ...state.prefs };
  if (document.getElementById('preferences-form')) {
    draft.targetLanguage = document.getElementById('target-language').value;
    draft.includeContext = document.getElementById('include-context').checked;
    draft.batchSize = Number(document.getElementById('batch-size').value);
    draft.translationColorLight = document.getElementById('color-light-hex').value;
    draft.translationColorDark = document.getElementById('color-dark-hex').value;
    if (draft.style === 'custom') draft.customPrompt = document.getElementById('style-prompt').value;
  }
  return draft;
}
function readProfile() {
  modelDraft = collectModelDraft(document.getElementById('model-form'), modelDraft);
  return section === 'summary' ? cleanSummaryProfile(modelDraft) : cleanProfile(modelDraft);
}
async function connectModel(save) {
  const form = document.getElementById('model-form');
  if (!form.reportValidity()) return;
  const profile = readProfile(), apiKey = modelDraft.apiKey, requestedPurpose = purpose(), editingId = modelEditingId;
  const makeDefault = modelDraft.makeDefault === true, requestedSection = section;
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
      const saved = await api(requestedPurpose === 'summary' ? 'SAVE_SUMMARY_PROFILE' : 'SAVE_PROFILE', { profile, apiKey, connectionId: editingId, makeDefault });
      if (!current()) { await refreshData(); notify(`${requestedPurpose === 'summary' ? '总结' : '翻译'}连接已保存`); return; }
      modelEditingId = saved.id; modelDraft = null; testedConnection = null;
      await refreshData(); if (section !== requestedSection) return; draw();
      const savedResult = document.getElementById('connection-result');
      if (savedResult) savedResult.innerHTML = `<strong>${icon('check')} 已连接并保存</strong><span>${requestedPurpose === 'summary' ? '流式测试：' : 'curiosity → '}${esc(verified.translation)}</span>`;
      notify(requestedPurpose === 'summary' ? '总结模型已保存，后台任务会继续处理；侧栏可查看已有结果' : '模型连接已保存；可开始翻译');
    } else {
      result.innerHTML = `<strong>${icon('check')} 连接成功 · ${(verified.elapsedMs / 1000).toFixed(2)} 秒</strong><span>${requestedPurpose === 'summary' ? '流式测试：' : 'curiosity → '}${esc(verified.translation)}</span><p class="field-help">点击“连接并保存”即可开始使用。</p>`;
    }
  } catch (error) { if (current()) { result.classList.add('error'); result.textContent = error.message; testedConnection = null; } }
  finally { if (controls.isConnected) controls.disabled = false; }
}
function openModal(title, body, actions) {
  modal.innerHTML = `<div class="modal-head"><h2 id="modal-title">${title}</h2><button class="icon-btn" type="button" data-action="close-modal" aria-label="关闭对话框">${icon('close')}</button></div><div class="modal-body">${body}</div><div class="modal-foot">${actions}</div>`;
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
async function changeConnection(id, action, enabled) {
  const requestedSection = section;
  await api('CONNECTION_UPDATE', { purpose: purpose(), id, action, enabled });
  if (section !== requestedSection) { await refreshData(); return; }
  if (action === 'default') modelEditingId = id;
  if (action === 'delete' && modelEditingId === id) modelEditingId = undefined;
  await refreshData(); modelDraft = null; testedConnection = null; if (modal.open) modal.close(); draw();
  notify(action === 'default' ? '默认模型已更新；新请求优先使用此连接，已存释义保留' : action === 'delete' ? '连接及此连接的 Key 已移除' : '备用顺序已更新');
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
document.addEventListener('submit', event => {
  event.preventDefault(); const form = event.target, button = form.querySelector('button[type="submit"]');
  if (form.id === 'preferences-form') busy(button, async () => { await api('SAVE_PREFS', { prefs: cleanPrefs(collectPrefs()) }); prefsDraft = null; await refreshData(); draw(); notify('翻译偏好已保存'); });
  if (form.id === 'model-form') busy(button, () => connectModel(true));
  if (form.id === 'summary-preferences') busy(button, async () => {
    const prompts = Object.fromEntries([...form.querySelectorAll('[data-summary-prompt]')].map(input => [input.dataset.summaryPrompt, input.value]));
    await api('SAVE_SUMMARY_PREFS', { prefs: { preset: document.getElementById('default-summary-preset').value, prompts } });
    await refreshData(); notify('总结偏好已保存');
  });
  if(form.id==='knowledge-preferences')busy(button,async()=>{const prompts=Object.fromEntries([...form.querySelectorAll('[data-knowledge-prompt]')].map(n=>[n.dataset.knowledgePrompt,n.value]));await api('KNOWLEDGE_PREFS',{prefs:{time:document.getElementById('knowledge-time').value,timeZone:document.getElementById('knowledge-zone').value,prompts}});await refreshData();notify('回顾设置已保存');});
  if (form.id === 'site-form') busy(button, async () => {
    const error = document.getElementById('site-error'); error.textContent = '';
    try {
      const site = blacklistSite(document.getElementById('site-input').value);
      await api('BLACKLIST_SET', { site, blocked: true }); await refreshData(); draw(); notify('已加入黑名单，此网站已停用');
    } catch (failure) { error.textContent = failure.message; }
  });
});
document.addEventListener('click', event => {
  const button = event.target.closest('button'); if (!button) return;
  if (button.dataset.editConnection) { if (actionBusy) return; modelEditingId = button.dataset.editConnection; modelDraft = null; testedConnection = null; draw(); document.getElementById('model-name')?.focus(); return; }
  if (button.dataset.connectionAction) { busy(button, () => changeConnection(button.dataset.connectionId, button.dataset.connectionAction)); return; }
  if (button.dataset.removeConnection) {
    const item = modelBank().items.find(item => item.id === button.dataset.removeConnection); if (!item) return;
    openModal('移除这个连接？', `<p>将移除「${esc(item.profile.name)}」及此连接的 Key。词库和其他连接保留；如需恢复，需要重新添加。</p>`, `<button class="btn subtle" data-action="close-modal">取消</button><button class="btn danger" data-confirm-remove-connection="${esc(item.id)}">移除连接</button>`); return;
  }
  if (button.dataset.confirmRemoveConnection) { busy(button, () => changeConnection(button.dataset.confirmRemoveConnection, 'delete')); return; }
  if (button.dataset.resetSummaryPrompt) { const key = button.dataset.resetSummaryPrompt; document.getElementById(`prompt-${key}`).value = SUMMARY_PRESETS[key].prompt; return; }
  if (button.dataset.colorChoice) { updateReadingColor(document.getElementById('preferences-form'), button.dataset.colorTheme, button.dataset.colorChoice); return; }
  if (button.dataset.resetColor) { updateReadingColor(document.getElementById('preferences-form'), button.dataset.resetColor, defaultReadingColor(button.dataset.resetColor)); return; }
  if (button.dataset.provider) { if (actionBusy || button.dataset.provider === modelDraft.provider) return; modelDraft = changeProvider(collectModelDraft(document.getElementById('model-form'), modelDraft), button.dataset.provider); testedConnection = null; draw(); return; }
  if (button.dataset.mode) { prefsDraft = collectPrefs(); prefsDraft.displayMode = button.dataset.mode; draw(); return; }
  if (button.dataset.style) { prefsDraft = collectPrefs(); prefsDraft.style = button.dataset.style; draw(); return; }
  if (button.dataset.filter) { filter = button.dataset.filter; page = 0; selected.clear(); draw(); return; }
  if (button.dataset.page != null) { page = Number(button.dataset.page); selected.clear(); renderTable(); return; }
  if (button.dataset.detail) { const entry = entries.find(entry => entry.id === button.dataset.detail); if (entry) showDetail(entry); return; }
  if (button.dataset.delete) { busy(button, () => remove([button.dataset.delete])); return; }
  if (button.dataset.saveEntry) { busy(button, async () => {
    const translation = document.getElementById('edit-translation').value.trim();
    if (!translation) { document.getElementById('edit-error').textContent = '请填写释义后保存。'; return; }
    await api('EDIT_ENTRY', { id: button.dataset.saveEntry, translation }); modal.close(); await refreshData(); draw(); notify('释义已更新，网页标记将同步使用');
  }); return; }
  if (button.dataset.siteRemove) { busy(button, async () => { await api('BLACKLIST_SET', { site: button.dataset.siteRemove, blocked: false }); await refreshData(); draw(); notify('已移出黑名单，恢复使用'); }); return; }
  switch (button.dataset.action) {
    case 'new-connection': if (!actionBusy) { modelEditingId = null; modelDraft = null; testedConnection = null; draw(); document.getElementById('model-name')?.focus(); } break;
    case 'codex-status': busy(button, checkCodex); break;
    case 'copy-codex-install': busy(button, async () => { await navigator.clipboard.writeText(`python3 install.py --extension-id ${chrome.runtime.id}`); notify('安装命令已复制，请在安装包的 native-host 文件夹中运行'); }); break;
    case 'close-modal': modal.close(); break;
    case 'reload-introduction': draw(); break;
    case 'export': busy(button, async () => { downloadJSON(await api('EXPORT')); notify('词库已导出，不包含模型密钥'); }); break;
    case 'cancel-selection': selected.clear(); renderTable(); break;
    case 'clear-search': query = ''; page = 0; draw(); document.getElementById('term-search').focus(); break;
    case 'delete-selected': openModal('删除这些词句？', `<p>将删除选中的 ${selected.size} 个词句，并移除它们在已启用网页中的标记。删除后有 8 秒可以撤销。</p>`, `<button class="btn subtle" type="button" data-action="close-modal">取消</button><button class="btn danger" type="button" data-action="confirm-selected">删除 ${selected.size} 个词句</button>`); break;
    case 'confirm-selected': busy(button, () => remove([...selected])); break;
    case 'clear-library': openModal('清空本地词库？', `<p>将删除全部 ${entries.length} 个词句和对应网页标记，网站黑名单与偏好会保留。建议先导出备份。清空后有 8 秒可以撤销。</p>`, `<button class="btn subtle" type="button" data-action="close-modal">取消</button><button class="btn danger" type="button" data-action="confirm-clear">清空 ${entries.length} 个词句</button>`); break;
    case 'confirm-clear': busy(button, () => remove(entries.map(entry => entry.id))); break;
    case 'clear-page-cache': busy(button, async () => { await api('CLEAR_PAGE_CACHE'); await refreshData(); draw(); notify('页面暂存已清除'); }); break;
    case 'clear-knowledge': openModal('清空阅读轨迹与回顾？','<p>将删除本地所有访问记录、原文快照、总结和依赖关系，包括已加入黑名单的历史资料。此操作不可撤销，请先导出备份。</p>','<button class="btn subtle" data-action="close-modal">取消</button><button class="btn danger" data-action="confirm-clear-knowledge">确认清空</button>');break;
    case 'confirm-clear-knowledge': busy(button,async()=>{await api('KNOWLEDGE_CLEAR');clearKnowledgeDrafts();modal.close();await refreshData();draw();notify('阅读轨迹与回顾已清空');});break;
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
  if (event.target.id === 'term-search') { query = event.target.value; page = 0; selected.clear(); clearTimeout(searchTimer); searchTimer = setTimeout(renderTable, 100); }
  if (event.target.id === 'other-model') { const form = document.getElementById('model-form'); modelDraft = collectModelDraft(form, modelDraft); testedConnection = null; updateModelGuidance(form, modelDraft); }
});
document.addEventListener('change', event => {
  const input = event.target;
  if (input.dataset.connectionBackup) { busy(input, () => changeConnection(input.dataset.connectionBackup, 'backup', input.checked)); return; }
  if (input.id === 'sort') { sort = input.value; page = 0; renderTable(); }
  if (input.id === 'custom-style') { prefsDraft = collectPrefs(); prefsDraft.style = input.checked ? 'custom' : 'regular'; draw(); }
  if (input.id === 'auth-type') { const key = document.getElementById('model-key'); key.disabled = input.value === 'none'; key.required = input.value !== 'none' && !savedProfile().hasKey; }
  if (input.id === 'provider-region') { modelDraft = changeRegion(collectModelDraft(document.getElementById('model-form'), modelDraft), input.value); testedConnection = null; draw(); }
  if (input.id === 'model-id' && input.tagName === 'SELECT') {
    modelDraft = collectModelDraft(document.getElementById('model-form'), modelDraft); testedConnection = null; draw();
    document.getElementById(modelDraft.manualModel ? 'other-model' : 'model-id')?.focus({ preventScroll: true });
  }
  if (input.dataset.select) { input.checked ? selected.add(input.dataset.select) : selected.delete(input.dataset.select); renderTable(); }
  if (input.id === 'select-page') { filteredEntries().slice(page * pageSize, (page + 1) * pageSize).forEach(entry => input.checked ? selected.add(entry.id) : selected.delete(entry.id)); renderTable(); }
});
modal.addEventListener('click', event => { if (event.target === modal) { const rect = modal.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) modal.close(); } });
window.addEventListener('hashchange', () => route().catch(error => notify(error.message)));
chrome.runtime.onMessage.addListener(message => {
  if (message?.type === 'SHIYI/UI_CHANGED') refreshData().then(() => {
    const count = document.getElementById('nav-count'); if (count) count.textContent = state.count;
    if (section === 'library' && !actionBusy && !modal.open) renderTable();
    if (section === 'sites' && !actionBusy && !document.getElementById('site-input')?.value) {
      const displayed = [...document.querySelectorAll('.domain-item .domain-name')].map(node => node.textContent);
      if (JSON.stringify(displayed) !== JSON.stringify(state.blacklist)) draw();
    }
  }).catch(() => {});
});
refreshData().then(route).catch(error => { app.innerHTML = `<div class="empty"><h3>暂时无法打开阅读空间。</h3><p>${esc(error.message)}</p><button class="btn primary" id="retry">重试</button></div>`; document.getElementById('retry').onclick = () => location.reload(); });
