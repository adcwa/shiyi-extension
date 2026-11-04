import { assert } from './core.js';

export const summaryPanelPath = tabId => `summary.html?tabId=${tabId}`;
export function summaryPanelTab(path) {
  try {
    const url = new URL(path, 'https://extension.invalid/'), id = url.searchParams.get('tabId');
    if (url.pathname !== '/summary.html' || !/^\d+$/.test(id || '')) return null;
    const tabId = Number(id);
    return Number.isSafeInteger(tabId) ? tabId : null;
  } catch { return null; }
}

// Explicit open gestures can request a manual summary. Visibility and navigation
// use the automatic policy; merely restoring a panel must not spend model quota.
export function createSummaryPanel({ chromeApi, settings, tabState, summaries, whenReady }) {
  const ports = new Set(), timers = new Map(), selections = new Map(), revisions = new Map();
  const visible = tabId => [...ports].some(port => port.summaryPanelTab === tabId && port.summaryVisible);
  const cancelTimer = tabId => { clearTimeout(timers.get(tabId)); timers.delete(tabId); };

  async function sync(tabId) {
    const revision = (revisions.get(tabId) || 0) + 1; revisions.set(tabId, revision);
    const value = await settings.config(), state = await tabState(tabId, value);
    if (revisions.get(tabId) !== revision) return null;
    const enabled = !!state?.enabled;
    if (!enabled) summaries.invalidate(tabId, state?.blocked ? '此网站已加入黑名单，生成已停止。' : '网页访问权限已变更，生成已停止。');
    const desired = { tabId, path: summaryPanelPath(tabId), enabled };
    const current = await chromeApi.sidePanel.getOptions({ tabId });
    if (revisions.get(tabId) !== revision) return null;
    // Chrome closes the visible window panel when an open background entry is
    // disabled (even with a tabId). Stop its job immediately, but apply native
    // disabling when that tab becomes active, preserving the foreground panel.
    if (!enabled && current.enabled && [...ports].some(port => port.summaryPanelTab !== tabId && port.summaryVisible) && !(await chromeApi.tabs.get(tabId)).active) return null;
    if (revisions.get(tabId) !== revision) return null;
    if (current.path !== desired.path || current.enabled !== desired.enabled) await chromeApi.sidePanel.setOptions(desired);
    return enabled ? chromeApi.tabs.get(tabId) : null;
  }
  async function syncAll() {
    const tabs = await chromeApi.tabs.query({});
    await Promise.allSettled(tabs.map(tab => sync(tab.id)));
  }
  async function summarize(tabId, explicit = false) {
    await whenReady();
    let tab = await sync(tabId);
    // Native binding may supersede sync while a click is opening the panel.
    // Recheck permission for the explicitly chosen tab instead of dropping the
    // user's request because focus or the sync revision changed in the meantime.
    if(explicit&&!tab){const state=await tabState(tabId,await settings.config());if(state?.enabled)tab=await chromeApi.tabs.get(tabId);}
    if (!tab || tab.status === 'loading' || (!explicit && (!tab.active || !visible(tabId)))) return { started: false };
    return summaries.ensure(tabId, selections.get(tabId),{manual:explicit});
  }
  function schedule(tabId) {
    cancelTimer(tabId);
    if (!visible(tabId)) return;
    timers.set(tabId, setTimeout(() => {
      timers.delete(tabId); summarize(tabId).catch(() => {});
    }, 300));
  }
  function open(tabId, preset) {
    assert(Number.isInteger(tabId) && tabId >= 0, 'INVALID_INPUT', '请选择需要总结的网页。');
    if (preset) selections.set(tabId, preset);
    // Must be the first browser API call in the gesture; awaiting setup here
    // loses Chrome's user activation and can close the popup without opening.
    return chromeApi.sidePanel.open({ tabId }).then(() => summarize(tabId, true));
  }
  function connect(port) {
    const tabId = summaryPanelTab(port.sender.url);
    if (tabId === null) { port.disconnect(); return; }
    port.summaryPanelTab = tabId; port.summaryVisible = false; ports.add(port);
    summaries.connect(port, tabId);
    port.onMessage.addListener(message => {
      if (message?.tabId !== tabId || !['bind', 'visibility'].includes(message.type)) return;
      port.summaryVisible = message.visible === true;
      if (port.summaryVisible) summarize(tabId).catch(() => {});
      else if (!visible(tabId)) cancelTimer(tabId);
    });
    port.onDisconnect.addListener(() => { ports.delete(port); if (!visible(tabId)) cancelTimer(tabId); });
  }
  chromeApi.tabs.onActivated.addListener(({ tabId }) => {
    whenReady().then(() => sync(tabId)).then(() => schedule(tabId)).catch(() => {});
  });
  chromeApi.tabs.onUpdated.addListener((tabId, change) => {
    if (change.status === 'loading' || change.url) { cancelTimer(tabId); summaries.invalidate(tabId); }
    if (change.url || change.status === 'loading' || change.status === 'complete') {
      whenReady().then(() => sync(tabId)).then(() => { if (change.status !== 'loading') schedule(tabId); }).catch(() => {});
    }
  });
  chromeApi.tabs.onRemoved.addListener(tabId => {
    cancelTimer(tabId); selections.delete(tabId); revisions.delete(tabId); summaries.remove(tabId);
    for (const port of ports) if (port.summaryPanelTab === tabId) port.summaryVisible = false;
  });
  // Newer browsers retain panel documents when hidden. Older supported builds
  // use the same bind/visibility protocol, without requiring these newer APIs.
  chromeApi.sidePanel.onOpened?.addListener(info => {
    if (info.tabId !== summaryPanelTab(info.path)) return;
    for (const port of ports) if (port.summaryPanelTab === info.tabId) port.summaryVisible = true;
    schedule(info.tabId);
  });
  chromeApi.sidePanel.onClosed?.addListener(info => {
    if (info.tabId !== summaryPanelTab(info.path)) return;
    for (const port of ports) if (port.summaryPanelTab === info.tabId) port.summaryVisible = false;
    cancelTimer(info.tabId);
  });
  async function initialize() {
    // A manifest default_path creates a global panel, even with open({tabId}).
    // Disable that legacy fallback before registering tab-specific entries.
    if ((await chromeApi.sidePanel.getOptions({})).enabled !== false) await chromeApi.sidePanel.setOptions({ enabled: false });
    await syncAll();
  }
  return { initialize, syncAll, open, connect };
}
