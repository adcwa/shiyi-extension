import { AppError, assert, boundedText, cleanPrefs, cleanProfile, digest, exportEntry, friendlyError, pageOrigin, permissionPattern, publicEntry, safeSource, VERSION } from './lib/core.js';
import * as store from './lib/db.js';
import * as settings from './lib/settings.js';
import { callModel } from './lib/model.js';
import { cleanParts, cleanBlocks } from './lib/block-model.js';
import { blacklistSite, blockingSite, changeBlacklist, domainMatches } from './lib/site-policy.js';
import { createContextMenus } from './lib/context-menu.js';
import { cleanPageInfo, cleanPageBlocks } from './lib/page-cache.js';
import { createSummaryManager } from './lib/summary-manager.js';
import { cleanSummaryProfile } from './lib/summary-presets.js';
import { runSummaryModel } from './lib/summary-model.js';
import { runConnections } from './lib/connections.js';
import { connectionPermission, nativeCodex } from './lib/codex.js';

const pending = new Map();
const backupNotices = new Set();
const contentFiles = ['lib/text.js', 'lib/block-text.js', 'lib/page-map.js', 'content/inline-structure.js', 'content/companion.js', 'content/reader.js', 'content/content.js'];
const uiPaths = new Set(['popup.html', 'options.html', 'summary.html']);
function trusted(sender) {
  if (sender.id !== chrome.runtime.id || sender.tab?.url && !sender.url?.startsWith(chrome.runtime.getURL(''))) return false;
  try { const url = new URL(sender.url); return url.origin === new URL(chrome.runtime.getURL('')).origin && uiPaths.has(url.pathname.slice(1)); } catch { return false; }
}
const uiOnly = sender => assert(trusted(sender), 'FORBIDDEN', '这个操作只能在点译设置或浮窗中完成。');
const scope = sender => trusted(sender) ? 'extension-ui' : `${sender.tab?.id}:${sender.documentId}`;
const translationSignature = value => digest(JSON.stringify([value.prefs.targetLanguage, value.prefs.style, value.prefs.customPrompt, value.profile.endpoint, value.profile.model, value.profile.provider, value.profile.region]));
async function pageIdentity(sender, value, requestedURL) {
  const tab = await chrome.tabs.get(sender.tab.id), url = new URL(requestedURL);
  assert(url.href === tab.url && url.origin === new URL(sender.url).origin, 'CANCELLED', '页面已切换，旧任务不会覆盖当前页面暂存。');
  url.username = ''; url.password = '';
  return digest(JSON.stringify(['page-v1', url.href, await translationSignature(value)]));
}

async function permissionGranted(origin) { return chrome.permissions.contains({ origins: [permissionPattern(origin)] }); }
async function resolveConnection(profile, purpose = 'translation') {
  const connection = purpose === 'summary' ? await settings.resolveSummaryProfile(profile) : await settings.resolveProfile(profile);
  assert(await connectionPermission(profile), profile.provider === 'codex' ? 'CODEX_PERMISSION' : 'MODEL_PERMISSION', profile.provider === 'codex' ? '请在模型连接中允许点译连接本机 Codex。' : '模型服务权限已失效，请到模型连接中重新授权。');
  return connection;
}
const translateConnected = (value, args) => runConnections({ value, purpose: 'translation', resolve: profile => resolveConnection(profile), run: connection => callModel({ ...args, ...connection }), signal: args.signal });
function reportBackup(sender, result) {
  if (!result?.backup) return;
  const key = `${sender.tab.id}:${sender.documentId}:${result.profile.connectionId}`;
  if (backupNotices.has(key)) return;
  backupNotices.add(key); if (backupNotices.size > 200) backupNotices.delete(backupNotices.values().next().value);
  chrome.tabs.sendMessage(sender.tab.id, { type: 'SHIYI/NOTICE', text: `本次翻译已使用备用连接：${result.profile.name}` }, { documentId: sender.documentId }).catch(() => {});
}
async function enabledSender(sender, value) {
  if (sender.id !== chrome.runtime.id || !Number.isInteger(sender.tab?.id) || sender.frameId !== 0 || !sender.documentId) return false;
  if (sender.documentLifecycle && sender.documentLifecycle !== 'active') return false;
  const origin = pageOrigin(sender.url);
  if (!origin) return false;
  return !blockingSite(origin, value.blacklist) && await permissionGranted(origin);
}
async function requireContent(sender) {
  const value = await settings.config();
  assert(await enabledSender(sender, value), 'SITE_DISABLED', '当前网站已在黑名单中停用，或浏览器网站权限已失效。');
  return value;
}
function abortRequests(test) { for (const item of pending.values()) if (!test || test(item)) item.controller.abort(); }
async function broadcast() {
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(tabs.map(tab => chrome.tabs.sendMessage(tab.id, { type: 'SHIYI/CHANGED' }, { frameId: 0 })));
  await chrome.runtime.sendMessage({ type: 'SHIYI/UI_CHANGED' }).catch(() => {});
}
async function setBadge(tabId, enabled) {
  if (!Number.isInteger(tabId)) return;
  await chrome.action.setBadgeText({ tabId, text: enabled ? 'ON' : '' }).catch(() => {});
}
async function syncScripts() {
  // v0.3 uses one manifest-defined HTTP(S) script. Remove old whitelist
  // registrations so an upgrade cannot leave duplicate legacy injections.
  const current = await chrome.scripting.getRegisteredContentScripts();
  const obsolete = current.filter(script => script.id.startsWith('shiyi-')).map(script => script.id);
  if (obsolete.length) await chrome.scripting.unregisterContentScripts({ ids: obsolete });
}
async function inject(tabId) {
  await chrome.scripting.insertCSS({ target: { tabId, frameIds: [0] }, files: ['content/content.css'] });
  await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: contentFiles });
  await chrome.tabs.sendMessage(tabId, { type: 'SHIYI/CHANGED' }, { frameId: 0 }).catch(() => {});
}
async function injectExisting(site) {
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(tabs.filter(tab => pageOrigin(tab.url) && (!site || domainMatches(new URL(tab.url).hostname, site))).map(tab => inject(tab.id)));
}
async function tabState(tabId, value) {
  if (!Number.isInteger(tabId)) return null;
  try {
    const tab = await chrome.tabs.get(tabId), origin = pageOrigin(tab.url), blockedBy = blockingSite(tab.url, value.blacklist);
    const granted = origin ? await permissionGranted(origin) : false;
    const page = await chrome.tabs.sendMessage(tabId, { type: 'SHIYI/PAGE_STATUS' }, { frameId: 0 }).catch(() => null);
    return { id: tabId, origin, title: tab.title || '', supported: !!origin, permitted: granted, page,
      blocked: !!blockedBy, blockingSite: blockedBy, enabled: !!origin && granted && !blockedBy };
  } catch { return null; }
}
async function pageCommand(tabId, action, mode) {
  const state = await tabState(tabId, await settings.config());
  assert(state?.supported, 'UNSUPPORTED_PAGE', '请在普通网页中使用点译。');
  assert(state.enabled, 'SITE_DISABLED', state.blocked ? '当前网站已加入黑名单，恢复此网站后即可翻译。' : '请在浏览器扩展详情中允许点译访问网站。');
  const message = { type: 'SHIYI/PAGE_CONTROL', action, mode };
  let result;
  try { result = await chrome.tabs.sendMessage(tabId, message, { frameId: 0 }); }
  catch { await inject(tabId); result = await chrome.tabs.sendMessage(tabId, message, { frameId: 0 }); }
  assert(result?.ok, result?.error?.code || 'PAGE_CHANGED', result?.error?.message || '请刷新当前页面后重试。');
  await menus.update(tabId).catch(() => {});
  return result.data;
}
async function setSiteBlocked(input, blocked) {
  const site = blacklistSite(input);
  abortRequests(item => item.origin && domainMatches(new URL(item.origin).hostname, site));
  if (blocked) summaries.cancelAll('网站黑名单已更新，生成已停止。请确认来源网站后重新总结。');
  await settings.changeConfig(value => { value.blacklist = changeBlacklist(value.blacklist, site, blocked); });
  await broadcast();
  if (!blocked) await injectExisting(site);
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active) await menus.update(active.id).catch(() => {});
  return { blacklist: (await settings.config()).blacklist };
}
const summaries = createSummaryManager({ chromeApi: chrome, settings, tabState, permissionGranted: connectionPermission });
const menus = createContextMenus(chrome, {
  state: async tabId => tabState(tabId, await settings.config()),
  settings: () => chrome.tabs.create({ url: chrome.runtime.getURL('options.html#model') }),
  summary: tab => {
    // Must run before any await: native sidePanel.open requires this gesture.
    return chrome.sidePanel.open({ windowId: tab.windowId }).then(() => ready).then(() => summaries.start(tab.id));
  },
  toggle: state => setSiteBlocked(state.blockingSite || state.origin, !state.blocked),
  selection: async (tabId, text) => {
    const message = { type: 'SHIYI/CONTEXT_TRANSLATE', text: boundedText(text, 16000, '选区') };
    try { return await chrome.tabs.sendMessage(tabId, message, { frameId: 0 }); }
    catch { await inject(tabId); return chrome.tabs.sendMessage(tabId, message, { frameId: 0 }); }
  },
  page: async (tabId, action) => { const { readerMode } = await chrome.storage.local.get('readerMode'); return pageCommand(tabId, action, readerMode === 'translation' ? 'translation' : 'bilingual'); }
});
const ready = settings.initializeStorage().then(async () => {
  await chrome.action.setBadgeBackgroundColor({ color: '#006665' });
  await store.purgeExpiredTrash();
  await syncScripts();
  await menus.install();
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active) await menus.update(active.id).catch(() => {});
});

async function handle(message, sender) {
  await ready;
  assert(message && typeof message.type === 'string', 'INVALID_INPUT', '消息格式不正确。');
  switch (message.type) {
    case 'SHIYI/HELLO': {
      const value = await settings.config(), enabled = await enabledSender(sender, value);
      await setBadge(sender.tab?.id, enabled);
      if (!enabled) return { enabled: false };
      return { enabled: true, prefs: value.prefs, modelConfigured: !!value.profile.endpoint && !!value.profile.model, translationSignature: await translationSignature(value), entries: (await store.listEntries(value.prefs.targetLanguage)).map(publicEntry) };
    }
    case 'SHIYI/PAGE_CACHE_LOAD': {
      const value = await requireContent(sender), id = await pageIdentity(sender, value, message.url);
      return { id, page: await store.pageRead(id) };
    }
    case 'SHIYI/PAGE_CACHE_OPEN': {
      const value = await requireContent(sender), id = await pageIdentity(sender, value, message.url), info = cleanPageInfo(message.info);
      assert(message.signature === await translationSignature(value), 'CANCELLED', '翻译设置已变化，旧任务不会覆盖页面暂存。');
      return store.pageOpen(id, { ...info, url: safeSource(message.url).url }, message.fresh === true);
    }
    case 'SHIYI/PAGE_CACHE_SAVE': {
      const value = await requireContent(sender), id = await pageIdentity(sender, value, message.url);
      assert(message.id === id && typeof message.revision === 'string' && message.revision.length <= 80, 'CANCELLED', '页面或翻译设置已变化，旧暂存不会覆盖新结果。');
      return store.pagePatch(id, message.revision, cleanPageInfo(message.info), cleanPageBlocks(message.blocks));
    }
    case 'SHIYI/PAGE_CACHE_STATE': {
      const value = await requireContent(sender), id = await pageIdentity(sender, value, message.url);
      assert(message.id === id && typeof message.revision === 'string' && ['bilingual', 'translation'].includes(message.mode), 'CANCELLED', '页面暂存已变化。');
      return store.pageState(id, message.revision, message.enabled === true, message.mode);
    }
    case 'SHIYI/CLEAR_PAGE_CACHE': {
      uiOnly(sender); const output = await store.clearPageCache();
      const tabs = await chrome.tabs.query({});
      await Promise.allSettled(tabs.map(tab => chrome.tabs.sendMessage(tab.id, { type: 'SHIYI/PAGE_CACHE_CLEARED' }, { frameId: 0 })));
      await broadcast(); return output;
    }
    case 'SHIYI/TRANSLATE': {
      const value = await requireContent(sender), text = boundedText(message.text, 1000, '待译文本');
      const requestId = boundedText(message.requestId, 80, '请求标识');
      const identity = `${sender.tab.id}:${sender.documentId}:${requestId}`;
      assert(!pending.has(identity), 'BUSY', '这条翻译正在进行，请等待结果或取消。');
      const found = await store.findEntry(text, value.prefs.targetLanguage);
      if (found) return { entry: publicEntry(found), saved: true, reused: true };
      assert(value.profile.endpoint && value.profile.model, 'MODEL_NOT_CONFIGURED', '先配置你自己的翻译模型，再开始翻译。');
      const profile = cleanProfile(value.profile);
      const epoch = await store.getEpoch();
      const context = value.prefs.includeContext ? boundedText(message.context || '', 1200, '相邻语境', { optional: true }) : '';
      const controller = new AbortController();
      pending.set(identity, { controller, tabId: sender.tab.id, documentId: sender.documentId, origin: pageOrigin(sender.url) });
      try {
        const prompt = value.prefs.style === 'custom' ? value.prefs.customPrompt : value.prefs.style;
        const cacheId = await digest(JSON.stringify([text, value.prefs.targetLanguage, value.prefs.style, prompt, profile.endpoint, profile.model, profile.provider, profile.region, context]));
        const cached = await store.cacheRead(cacheId);
        const connected = cached ? null : await translateConnected(value, { prefs: value.prefs, text, context, signal: controller.signal });
        const output = cached || connected.output;
        const modelName = cached?.modelName || connected?.profile.name || profile.name || profile.model;
        assert(!controller.signal.aborted && await enabledSender(sender, await settings.config()), 'CANCELLED', '本次翻译已取消，或当前页面已经关闭。');
        // A real document-bound receiver must still exist for this document.
        await chrome.tabs.sendMessage(sender.tab.id, { type: 'SHIYI/PING' }, { documentId: sender.documentId }).catch(() => { throw new AppError('PAGE_CHANGED', '网页已经切换，请在当前页面重新选择。'); });
        const now = Date.now();
        const entry = await store.commitTranslation({ id: crypto.randomUUID(), text, ...output, targetLanguage: value.prefs.targetLanguage,
          style: value.prefs.style, customPromptVersion: await digest(prompt), modelName,
          source: safeSource(sender.url, message.title || ''), context, createdAt: now, updatedAt: now }, epoch);
        if (!cached) await store.cacheWrite(cacheId, { ...output, modelName }, epoch).catch(() => {});
        reportBackup(sender, connected);
        await broadcast();
        return { entry: publicEntry(entry), saved: true, reused: !!cached };
      } finally { pending.delete(identity); }
    }
    case 'SHIYI/TRANSLATE_BLOCK':
    case 'SHIYI/TRANSLATE_BLOCKS': {
      const value = await requireContent(sender), batched = message.type === 'SHIYI/TRANSLATE_BLOCKS';
      const blocks = batched ? cleanBlocks(message.blocks) : [{ id: 'b0', parts: cleanParts(message.parts) }];
      const requestId = boundedText(message.requestId, 80, '请求标识');
      const identity = `${sender.tab.id}:${sender.documentId}:${requestId}`;
      assert(!pending.has(identity), 'BUSY', '这些段落正在翻译。');
      assert(value.profile.endpoint && value.profile.model, 'MODEL_NOT_CONFIGURED', '请先连接翻译模型，再翻译页面。');
      const profile = cleanProfile(value.profile);
      const controller = new AbortController();
      pending.set(identity, { controller, tabId: sender.tab.id, documentId: sender.documentId, origin: pageOrigin(sender.url) });
      try {
        const epoch = await store.getEpoch();
        const items = await Promise.all(blocks.map(async block => {
          // Keep the existing per-block cache identity across batch boundaries
          // and upgrades. Only cache misses are sent to the model.
          const cacheId = await digest(JSON.stringify(['block-v1', block.parts, value.prefs.targetLanguage, value.prefs.style, value.prefs.style === 'custom' ? value.prefs.customPrompt : '', profile.endpoint, profile.model, profile.provider, profile.region]));
          return { ...block, cacheId, cached: message.fresh === true ? null : await store.cacheRead(cacheId) };
        }));
        const missing = [...new Map(items.filter(item => !item.cached).map(item => [item.cacheId, item])).values()];
        let results = [], connected;
        if (missing.length === 1) { connected = await translateConnected(value, { prefs: value.prefs, parts: missing[0].parts, signal: controller.signal }); results = [{ id: missing[0].id, output: connected.output }]; }
        else if (missing.length > 1) { connected = await translateConnected(value, { prefs: value.prefs, blocks: missing.map(({ id, parts }) => ({ id, parts })), signal: controller.signal }); ({ results } = connected.output); }
        assert(!controller.signal.aborted && await enabledSender(sender, await settings.config()), 'CANCELLED', '本次段落翻译已取消。');
        await chrome.tabs.sendMessage(sender.tab.id, { type: 'SHIYI/PING' }, { documentId: sender.documentId }).catch(() => { throw new AppError('PAGE_CHANGED', '页面已切换，请重新翻译。'); });
        const byId = new Map(results.map(result => [result.id, result]));
        reportBackup(sender, connected);
        const byCache = new Map(missing.map(item => [item.cacheId, byId.get(item.id)]));
        await Promise.all(missing.map(item => {
          const result = byId.get(item.id);
          if (result?.output && !controller.signal.aborted) return store.cacheWrite(item.cacheId, result.output, epoch).catch(() => {});
        }));
        const completed = items.map(item => ({ id: item.id, ...(item.cached ? { output: item.cached, reused: true } : { ...byCache.get(item.cacheId), id: item.id, reused: false }) }));
        // Reading results remain separate from the vocabulary, including partial
        // batch successes. Failed items can retry alone without billing successes.
        if (batched) return { results: completed };
        assert(completed[0].output, completed[0].error?.code || 'BLOCK_ALIGNMENT', completed[0].error?.message || '段落译文缺失，原文已保留。');
        return { ...completed[0].output, reused: completed[0].reused };
      } finally { pending.delete(identity); }
    }
    case 'SHIYI/PAGE_COMMAND': {
      uiOnly(sender);
      assert(Number.isInteger(message.tabId), 'INVALID_INPUT', '没有找到当前页面。');
      assert(['translate', 'retranslate', 'load-local', 'mode', 'restore', 'stop', 'resume', 'refresh', 'retry', 'show-companion'].includes(message.action), 'INVALID_INPUT', '不支持的页面操作。');
      assert(message.mode === undefined || ['bilingual', 'translation'].includes(message.mode), 'INVALID_INPUT', '请选择双语对照或仅译文。');
      return pageCommand(message.tabId, message.action, message.mode);
    }
    case 'SHIYI/CANCEL': {
      await requireContent(sender);
      pending.get(`${sender.tab.id}:${sender.documentId}:${message.requestId}`)?.controller.abort();
      return { cancelled: true };
    }
    case 'SHIYI/SET_CONTEXT': {
      await requireContent(sender);
      await settings.changeConfig(value => { value.prefs.includeContext = message.enabled === true; });
      return { includeContext: message.enabled === true };
    }
    case 'SHIYI/SET_TARGET_LANGUAGE': {
      await requireContent(sender);
      let changed = false, targetLanguage;
      await settings.changeConfig(value => {
        const next = cleanPrefs({ ...value.prefs, targetLanguage: message.targetLanguage });
        changed = next.targetLanguage !== value.prefs.targetLanguage;
        if (changed) abortRequests();
        value.prefs = next; targetLanguage = next.targetLanguage;
      });
      if (changed) await broadcast();
      return { targetLanguage };
    }
    case 'SHIYI/DELETE': {
      let ids;
      if (trusted(sender)) {
        assert(Array.isArray(message.ids) && message.ids.length > 0 && message.ids.length <= 20000 && message.ids.every(x => typeof x === 'string' && x.length <= 80), 'INVALID_INPUT', '请选择需要删除的词句。');
        ids = [...new Set(message.ids)];
      } else {
        const value = await requireContent(sender), entry = await store.getEntry(message.id);
        assert(entry && entry.targetLanguage === value.prefs.targetLanguage, 'NOT_FOUND', '这个词句已经被删除或属于另一个目标语言。'); ids = [entry.id];
      }
      abortRequests();
      const result = await store.removeEntries(ids, scope(sender));
      setTimeout(() => store.purgeExpiredTrash().catch(() => {}), 8200);
      await broadcast(); return result;
    }
    case 'SHIYI/UNDO': {
      if (!trusted(sender)) await requireContent(sender);
      const result = await store.undoDelete(boundedText(message.token, 80, '撤销标识'), scope(sender)); await broadcast(); return result;
    }
    case 'SHIYI/OPEN_OPTIONS': {
      if (!trusted(sender)) await requireContent(sender);
      const section = ['library', 'translation', 'model', 'summary', 'sites', 'data', 'help', 'about'].includes(message.section) ? message.section : 'library';
      const query = typeof message.entryId === 'string' ? `?entry=${encodeURIComponent(message.entryId.slice(0, 80))}` : '';
      await chrome.tabs.create({ url: chrome.runtime.getURL(`options.html${query}#${section}`) }); return {};
    }
    case 'SHIYI/UI_STATE': {
      uiOnly(sender); const value = await settings.publicConfig();
      return { ...value, count: await store.countEntries(), pageCache: await store.pageCacheSummary(), tab: await tabState(message.tabId, value), version: VERSION };
    }
    case 'SHIYI/LIBRARY': uiOnly(sender); return { entries: await store.listEntries() };
    case 'SHIYI/EDIT_ENTRY': {
      uiOnly(sender); abortRequests();
      const entry = await store.editEntry(boundedText(message.id, 80, '词句标识'), boundedText(message.translation, 2000, '释义'));
      await broadcast(); return { entry };
    }
    case 'SHIYI/EXPORT': {
      uiOnly(sender); return { format: 'shiyi-vocabulary', version: 1, exportedAt: new Date().toISOString(), entries: (await store.listEntries()).map(exportEntry) };
    }
    case 'SHIYI/SAVE_PREFS': {
      uiOnly(sender);
      const next = cleanPrefs(message.prefs), previous = (await settings.config()).prefs;
      if (['targetLanguage', 'style', 'customPrompt', 'includeContext'].some(key => next[key] !== previous[key])) abortRequests();
      // Local appearance and scheduling preferences preserve in-flight work,
      // completed translations, and the per-block cache identity.
      await settings.savePrefs(next); await broadcast(); return {};
    }
    case 'SHIYI/SAVE_PROFILE': {
      uiOnly(sender); const profile = cleanProfile(message.profile);
      assert(await connectionPermission(profile), 'MODEL_PERMISSION', '请先允许访问这个模型连接。');
      abortRequests(); const output = await settings.saveProfile(profile, message.apiKey, { ...(Object.hasOwn(message, 'connectionId') ? { id: message.connectionId } : {}), makeDefault: message.makeDefault === true }); await broadcast(); return output;
    }
    case 'SHIYI/CONNECTION_UPDATE': {
      uiOnly(sender);
      if (message.purpose === 'summary') summaries.cancelAll('总结连接已更新，请重新总结。'); else abortRequests();
      await settings.updateConnection(message.purpose, boundedText(message.id, 80, '连接标识'), message.action, message.enabled);
      await broadcast(); return {};
    }
    case 'SHIYI/CODEX_STATUS': {
      uiOnly(sender); assert(await chrome.permissions.contains({ permissions: ['nativeMessaging'] }), 'CODEX_PERMISSION', '请先允许点译连接本机应用。');
      return nativeCodex({ action: 'status' });
    }
    case 'SHIYI/CLEAR_KEY': uiOnly(sender); abortRequests(); await settings.clearCredential(); await broadcast(); return {};
    case 'SHIYI/SUMMARY_START': uiOnly(sender); return summaries.start(message.tabId, message.preset);
    case 'SHIYI/SUMMARY_STOP': uiOnly(sender); summaries.stop(message.tabId); return {};
    case 'SHIYI/SAVE_SUMMARY_PREFS': uiOnly(sender); await settings.saveSummaryPrefs(message.prefs); await broadcast(); return {};
    case 'SHIYI/SAVE_SUMMARY_PROFILE': {
      uiOnly(sender); const profile = cleanSummaryProfile(message.profile);
      assert(await connectionPermission(profile), 'MODEL_PERMISSION', '请先允许访问这个总结连接。');
      summaries.cancelAll('总结模型已变更，旧任务已停止。');
      const output = await settings.saveSummaryProfile(profile, message.apiKey, { ...(Object.hasOwn(message, 'connectionId') ? { id: message.connectionId } : {}), makeDefault: message.makeDefault === true }); await broadcast(); return output;
    }
    case 'SHIYI/CLEAR_SUMMARY_KEY': uiOnly(sender); summaries.cancelAll('总结密钥已清除，生成已停止。'); await settings.clearSummaryCredential(); await broadcast(); return {};
    case 'SHIYI/TEST_SUMMARY_MODEL': {
      uiOnly(sender); const connection = await settings.resolveSummaryProfile(message.profile, message.apiKey);
      assert(await connectionPermission(connection.profile), 'MODEL_PERMISSION', '请先允许访问这个总结连接。');
      const start = Date.now(); let output = '';
      await runSummaryModel({ ...connection, text: '这是一段连接测试资料：浏览器插件支持在侧栏总结当前网页，结果以流式方式显示。请用一句话概括。', preset: 'general', onDelta: chunk => { output += chunk; } });
      return { translation: output, elapsedMs: Date.now() - start, model: connection.profile.model };
    }
    case 'SHIYI/TEST_MODEL': {
      uiOnly(sender); const { profile, apiKey } = await settings.resolveProfile(message.profile, message.apiKey);
      assert(await connectionPermission(profile), 'MODEL_PERMISSION', '请先允许访问这个模型连接。');
      const value = await settings.config(), start = Date.now();
      const output = await callModel({ profile, apiKey, prefs: { ...value.prefs, style: 'regular', includeContext: false }, text: 'curiosity' });
      return { translation: output.translation, elapsedMs: Date.now() - start, model: profile.model };
    }
    case 'SHIYI/BLACKLIST_SET': {
      uiOnly(sender);
      assert(typeof message.blocked === 'boolean', 'INVALID_INPUT', '请选择停用或恢复网站。');
      return setSiteBlocked(message.site, message.blocked);
    }
    case 'SHIYI/MENU_REFRESH': {
      await requireContent(sender); await menus.update(sender.tab.id); return {};
    }
    default: throw new AppError('UNKNOWN_MESSAGE', '不支持的操作。');
  }
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!message?.type?.startsWith('SHIYI/') || message.type === 'SHIYI/UI_CHANGED') return false;
  let task;
  try {
    if (message.type === 'SHIYI/SUMMARY_OPEN') {
      uiOnly(sender); assert(Number.isInteger(message.tabId), 'INVALID_INPUT', '请选择需要总结的网页。');
      // Opening a native panel closes Chrome's action popup. Own the entire
      // open -> start chain here so destroying that popup cannot drop the job.
      // This call must precede ready/other awaits to retain the click gesture.
      task = chrome.sidePanel.open({ tabId: message.tabId }).then(() => ready).then(() => summaries.start(message.tabId, message.preset));
    } else task = handle(message, sender);
  } catch (error) { respond({ ok: false, error: friendlyError(error) }); return false; }
  task.then(data => respond({ ok: true, data }), error => respond({ ok: false, error: friendlyError(error) }));
  return true;
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
  menus.click(info, tab).catch(async error => {
    if (Number.isInteger(tab?.id)) await chrome.tabs.sendMessage(tab.id, { type: 'SHIYI/NOTICE', text: friendlyError(error).message }, { frameId: 0 }).catch(() => {});
  });
});
chrome.runtime.onInstalled.addListener(details => {
  ready.then(async () => {
    await injectExisting();
    if (details.reason === 'install') await chrome.tabs.create({ url: chrome.runtime.getURL('options.html#model') });
  }).catch(() => {});
});
chrome.runtime.onStartup.addListener(() => ready.then(syncScripts).catch(() => {}));
chrome.permissions.onRemoved.addListener(() => ready.then(async () => { abortRequests(); summaries.cancelAll('浏览器权限已变更，生成已停止。'); await broadcast(); }).catch(() => {}));
chrome.permissions.onAdded.addListener(() => ready.then(async () => { await injectExisting(); await broadcast(); }).catch(() => {}));
chrome.tabs.onActivated.addListener(({ tabId }) => ready.then(() => menus.update(tabId)).catch(() => {}));
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.status === 'loading' || change.url) summaries.invalidate(tabId);
  if (change.status === 'loading') { abortRequests(item => item.tabId === tabId); setBadge(tabId, false).catch(() => {}); }
  if (tab.active && (change.status === 'complete' || change.url)) ready.then(() => menus.update(tabId)).catch(() => {});
});
chrome.tabs.onRemoved.addListener(tabId => { abortRequests(item => item.tabId === tabId); summaries.remove(tabId); });
chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'SHIYI_SUMMARY' || !trusted(port.sender) || new URL(port.sender.url).pathname !== '/summary.html') { port.disconnect(); return; }
  summaries.connect(port);
});
