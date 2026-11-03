import { assert, digest, pageOrigin, safeSource, friendlyError } from './core.js';
import { SUMMARY_PRESETS } from './summary-presets.js';
import { runSummaryModel } from './summary-model.js';
import { extractSummaryPage } from './summary-extract.js';
import { runConnections } from './connections.js';

const activePhases = new Set(['extracting', 'classifying', 'streaming']);
export function createSummaryManager({ chromeApi, settings, tabState, permissionGranted }) {
  const states = new Map(), jobs = new Map(), ports = new Set(), launches = new Map(), notifications = new Map(); let persistTail = Promise.resolve(), saveTimer;
  const loaded = chromeApi.storage.session.get('summaryResults').then(async ({ summaryResults = [] }) => {
    for (const saved of summaryResults.slice(-8)) if (Number.isInteger(saved.tabId)) {
      const { sourceURL, ...value } = saved;
      const tab = await chromeApi.tabs.get(value.tabId).catch(() => null); if (!tab) continue;
      if (!value.sourceIdentity || value.sourceIdentity !== await digest(tab.url || '')) value.stale = true;
      states.set(value.tabId, activePhases.has(value.phase) ? { ...value, phase: 'interrupted', error: '后台已重启，已保留收到的总结。点击重新总结可再次生成。' } : value);
    }
  });
  function send(port, value) { try { port.postMessage(value); } catch {} }
  function publicState(state) { if (!state) return null; const { sourceIdentity, ...value } = state; return value; }
  function publish(tabId) { const state = publicState(states.get(tabId)); for (const port of ports) if (port.summaryTab === tabId) send(port, { type: 'state', state, tabId }); }
  function persist() {
    clearTimeout(saveTimer); saveTimer = null;
    persistTail = persistTail.catch(() => {}).then(() => chromeApi.storage.session.set({ summaryResults: [...states.values()].sort((a, b) => a.updatedAt - b.updatedAt).slice(-8) }));
    return persistTail;
  }
  function update(tabId, patch, immediate = false) {
    states.set(tabId, { ...states.get(tabId), ...patch, updatedAt: Date.now() });
    if (Object.keys(patch).length === 1 && typeof patch.text === 'string') {
      if (!notifications.has(tabId)) notifications.set(tabId, setTimeout(() => { notifications.delete(tabId); publish(tabId); }, 80));
    } else { clearTimeout(notifications.get(tabId)); notifications.delete(tabId); publish(tabId); }
    if (immediate) persist().catch(() => {}); else if (!saveTimer) saveTimer = setTimeout(() => { saveTimer = null; persist().catch(() => {}); }, 700);
  }
  async function snapshot(tabId) { await loaded; return publicState(states.get(tabId)); }
  function stop(tabId, reason = '生成已停止，已保留收到的内容。', keepLaunch = false) {
    if (!keepLaunch) launches.delete(tabId);
    const job = jobs.get(tabId); if (!job) return;
    jobs.delete(tabId); job.controller.abort(); update(tabId, { phase: 'stopped', error: reason }, true);
  }
  async function start(tabId, requestedPreset) {
    const launch = crypto.randomUUID(); launches.set(tabId, launch);
    await loaded;
    assert(Number.isInteger(tabId), 'INVALID_INPUT', '请选择需要总结的网页。');
    stop(tabId, undefined, true);
    const value = await settings.config(), tab = await chromeApi.tabs.get(tabId), state = await tabState(tabId, value);
    if (launches.get(tabId) !== launch) return { started: false };
    const preset = requestedPreset || value.summaryPrefs.preset;
    assert(Object.hasOwn(SUMMARY_PRESETS, preset), 'INVALID_INPUT', '请选择有效的总结场景。');
    const id = crypto.randomUUID(), source = safeSource(tab.url, tab.title), sourceIdentity = await digest(tab.url || '');
    if (launches.get(tabId) !== launch) return { started: false };
    update(tabId, { id, tabId, source, sourceIdentity, preset, chosen: '', topic: '', text: '', error: '', phase: 'extracting', chars: 0, model: value.summaryProfile.model, truncated: false, stale: false, fallback: false }, true);
    const controller = new AbortController(), job = { id, controller, origin: pageOrigin(tab.url) }; jobs.set(tabId, job);
    const current = () => jobs.get(tabId) === job && !controller.signal.aborted;
    // A bounded streaming fetch can outlive MV3's idle timer. Keep it alive only
    // while this explicit request runs, and always release it on completion.
    const heartbeat = setInterval(() => chromeApi.runtime.getPlatformInfo().catch(() => {}), 20000);
    const deadline = setTimeout(() => { if (current()) stop(tabId, '本次总结已超过 3 分钟，已停止并保留现有内容。'); }, 180000);
    (async () => {
      try {
        assert(state?.supported, 'UNSUPPORTED_PAGE', '当前页面不支持总结，请打开普通网页后重试。');
        assert(state.enabled, 'SITE_DISABLED', state.blocked ? '此网站已加入黑名单。请从插件原有网站开关恢复后重试。' : '请在浏览器扩展详情中允许点译访问此网站。');
        assert(value.summaryConfigured, 'SUMMARY_NOT_CONFIGURED', '尚未连接总结模型。请在插件弹窗的“总结设置”中完成连接，再回到网页重试。');
        if (!current()) return;
        const [result] = await chromeApi.scripting.executeScript({ target: { tabId, frameIds: [0] }, func: extractSummaryPage });
        if (!current()) return;
        const page = result?.result, latest = await chromeApi.tabs.get(tabId);
        assert(page && page.url === tab.url && latest.url === tab.url, 'PAGE_CHANGED', '网页已切换，请对当前网页重新总结。');
        assert(!page.error && page.text?.length >= 20, 'EMPTY_PAGE', page?.error || '没有找到足够的可读文字，请等待正文加载后重试。');
        update(tabId, { chars: page.chars, scope: page.scope, truncated: page.truncated, source: safeSource(page.url, page.title) });
        let emitted = false;
        await runConnections({ value, purpose: 'summary', signal: controller.signal, allowBackup: () => !emitted,
          resolve: async profile => { const connection = await settings.resolveSummaryProfile(profile); assert(await permissionGranted(profile), profile.provider === 'codex' ? 'CODEX_PERMISSION' : 'MODEL_PERMISSION', '请在总结设置中重新授权这个连接。'); return connection; },
          onSelected: ({ profile, backup }) => { if (current()) update(tabId, { model: profile.model, connectionName: profile.name, connectionFallback: backup }); },
          run: connection => runSummaryModel({ ...connection, text: page.text, preset, prefs: value.summaryPrefs, signal: controller.signal,
            onPhase: patch => { if (current()) update(tabId, patch); },
            onDelta: chunk => { if (chunk) emitted = true; if (current()) update(tabId, { text: states.get(tabId).text + chunk }); }
          })
        });
        if (current()) update(tabId, { phase: 'complete', error: '' }, true);
      } catch (error) { if (current()) update(tabId, { phase: 'error', error: friendlyError(error).message }, true); }
      finally { clearInterval(heartbeat); clearTimeout(deadline); if (jobs.get(tabId) === job) jobs.delete(tabId); }
    })();
    return { started: true, id };
  }
  function connect(port) {
    ports.add(port);
    port.onMessage.addListener(async message => {
      if (message?.type === 'bind' && Number.isInteger(message.tabId)) { port.summaryTab = message.tabId; await loaded; publish(message.tabId); }
    });
    port.onDisconnect.addListener(() => ports.delete(port));
  }
  function cancelAll(reason) { launches.clear(); for (const tabId of jobs.keys()) stop(tabId, reason); }
  function invalidate(tabId) {
    const changedAt = Date.now(); launches.delete(tabId); stop(tabId, '来源网页已刷新或切换，旧任务已停止。请对当前网页重新总结。');
    loaded.then(() => { const state = states.get(tabId); if (state && state.updatedAt <= changedAt) update(tabId, { stale: true }, true); }).catch(() => {});
  }
  function remove(tabId) { launches.delete(tabId); stop(tabId); states.delete(tabId); publish(tabId); persist().catch(() => {}); }
  return { start, stop, connect, snapshot, cancelAll, invalidate, remove };
}
