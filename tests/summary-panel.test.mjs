import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createSummaryManager } from '../src/lib/summary-manager.js';
import { createSummaryPanel, summaryPanelPath, summaryPanelTab } from '../src/lib/summary-panel.js';
import { DEFAULT_SUMMARY_PREFS } from '../src/lib/summary-presets.js';
import { blockingSite } from '../src/lib/site-policy.js';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) {
  const deadline = Date.now() + 3500;
  while (Date.now() < deadline) { if (await check()) return; await delay(10); }
  assert.fail('Expected summary state was not reached');
}
function event() {
  const listeners = new Set();
  return { addListener: fn => listeners.add(fn), emit: (...args) => { for (const fn of listeners) fn(...args); } };
}
async function fixture(t, { modern = true } = {}) {
  const calls = [], options = new Map(), opened = [], data = {}, tabs = new Map([
    [1, { id: 1, windowId: 10, url: 'https://article.example/first', title: 'First article', active: true, status: 'complete', text: 'FIRST_PAGE: visible original article content with enough evidence.' }],
    [2, { id: 2, windowId: 10, url: 'https://other.example/second', title: 'Second article', active: false, status: 'complete', text: 'SECOND_PAGE: independent original article content and details.' }]
  ]);
  let mode = 'ok', globalOptions = { enabled: true, path: 'summary.html' };
  const server = http.createServer(async (request, response) => {
    let raw = ''; for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw); calls.push(body);
    if (mode === '403') { response.writeHead(403); response.end('{"error":{"code":"PermissionDenied"}}'); return; }
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '## 自动总结\n\n本页的重点。' } }] })}\n\n`);
    if (mode === 'slow') { response.once('close', () => {}); return; }
    response.end('data: [DONE]\n\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const profile = { provider: 'custom', endpoint: `http://127.0.0.1:${server.address().port}/v1/chat/completions`, model: 'local-summary-fixture', name: 'Local fixture', auth: 'none', timeoutSeconds: 5 };
  const value = { blacklist: [], summaryConfigured: true, summaryProfile: profile, summaryPrefs: { ...DEFAULT_SUMMARY_PREFS, preset: 'general' }, modelConnections: { summary: { defaultId: 's1', items: [{ id: 's1', profile, backup: false }] } } };
  const chromeApi = {
    storage: { session: { get: async key => ({ [key]: data[key] }), set: async next => Object.assign(data, structuredClone(next)) } },
    runtime: { getPlatformInfo: async () => ({}) },
    tabs: {
      get: async id => { if (!tabs.has(id)) throw Error('No tab'); return { ...tabs.get(id) }; },
      query: async () => [...tabs.values()].map(tab => ({ ...tab })),
      onActivated: event(), onUpdated: event(), onRemoved: event()
    },
    scripting: { executeScript: async ({ target }) => { const tab = tabs.get(target.tabId); return [{ result: { url: tab.url, title: tab.title, text: tab.text, chars: tab.text.length, scope: 'main' } }]; } },
    sidePanel: {
      getOptions: async ({ tabId }) => ({ ...(options.get(tabId) || globalOptions) }),
      setOptions: async next => {
        if (next.tabId === undefined) globalOptions = { ...globalOptions, ...next };
        else {
          options.set(next.tabId, { ...next });
          if (!next.enabled) chromeApi.sidePanel.onClosed?.emit({ tabId: next.tabId, path: next.path });
        }
      },
      open: async ({ tabId, ...rest }) => {
        assert.deepEqual(rest, {}, 'Never open a window-global panel');
        assert.equal(options.get(tabId)?.enabled, true, 'Blacklisted or unsupported panels cannot open');
        opened.push(tabId); chromeApi.sidePanel.onOpened?.emit({ tabId, path: options.get(tabId).path });
      },
      ...(modern ? { onOpened: event(), onClosed: event() } : {})
    }
  };
  const settings = { config: async () => value, resolveSummaryProfile: async profile => ({ profile, apiKey: '' }) };
  const tabState = async id => { const tab = tabs.get(id), blocked = !!blockingSite(tab?.url, value.blacklist); return { supported: !!tab, enabled: !!tab && !blocked, blocked }; };
  const summaries = createSummaryManager({ chromeApi, settings, tabState, permissionGranted: async () => true });
  const panels = createSummaryPanel({ chromeApi, settings, tabState, summaries, whenReady: async () => {} });
  await panels.initialize();
  const ports = [];
  function connect(tabId, visible = true) {
    const port = { sender: { url: `chrome-extension://fixture/${summaryPanelPath(tabId)}` }, onMessage: event(), onDisconnect: event(), messages: [], postMessage(message) { this.messages.push(message); }, disconnect() { this.onDisconnect.emit(); } };
    panels.connect(port); ports.push(port);
    port.onMessage.emit({ type: 'bind', tabId, visible });
    return port;
  }
  function navigate(tabId, url, { complete = true } = {}) {
    const tab = tabs.get(tabId); Object.assign(tab, { url, status: 'loading', text: `NEW_PAGE ${url}: replacement article with enough original text for a summary.` });
    chromeApi.tabs.onUpdated.emit(tabId, { status: 'loading', url }, { ...tab });
    if (complete) finish(tabId);
  }
  function finish(tabId) { const tab = tabs.get(tabId); tab.status = 'complete'; chromeApi.tabs.onUpdated.emit(tabId, { status: 'complete' }, { ...tab }); }
  function activate(tabId) { for (const tab of tabs.values()) tab.active = tab.id === tabId; chromeApi.tabs.onActivated.emit({ tabId, windowId: 10 }); }
  const complete = id => until(async () => { const state = await summaries.snapshot(id); assert.notEqual(state?.phase, 'error', state?.error); return state?.phase === 'complete'; });
  t.after(async () => { for (const port of ports) port.disconnect(); summaries.cancelAll(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return { calls, options, opened, value, chromeApi, summaries, panels, tabs, connect, navigate, finish, activate, complete, mode: next => { mode = next; }, global: () => globalOptions };
}

test('summary paths bind one valid tab and reject missing, negative and unsafe IDs', () => {
  assert.equal(summaryPanelTab(summaryPanelPath(42)), 42);
  assert.equal(summaryPanelTab('chrome-extension://fixture/summary.html?tabId=3'), 3);
  for (const path of ['summary.html', 'options.html?tabId=1', 'summary.html?tabId=-1', 'summary.html?tabId=1e3', 'summary.html?tabId=9007199254740993']) assert.equal(summaryPanelTab(path), null);
});
test('initialization disables the legacy global panel and never generates on other tabs', async t => {
  const f = await fixture(t);
  assert.equal(f.global().enabled, false);
  assert.equal(f.options.get(1).path, 'summary.html?tabId=1');
  assert.equal(f.options.get(2).path, 'summary.html?tabId=2');
  f.value.blacklist = ['other.example']; await f.panels.syncAll();
  assert.equal(f.options.get(2).enabled, false); assert.equal(f.options.get(1).enabled, true);
  await delay(350); assert.equal(f.calls.length, 0);
  await assert.rejects(f.panels.open(2)); assert.equal(f.calls.length, 0);
});
test('native panel binding starts one real SSE request and reconnecting reuses its result', async t => {
  const f = await fixture(t), port = f.connect(1);
  port.onMessage.emit({ type: 'bind', tabId: 1, visible: true });
  await f.complete(1); assert.equal(f.calls.length, 1); assert(f.calls[0].messages.at(-1).content.includes('FIRST_PAGE'));
  port.disconnect(); f.connect(1); await delay(400);
  assert.equal(f.calls.length, 1); assert.equal((await f.summaries.snapshot(2)), null);
  assert(port.messages.filter(m => m.type === 'state').every(m => m.tabId === 1));
});
test('popup open preserves the synchronous tab gesture and deduplicates native open and bind', async t => {
  const f = await fixture(t);
  const opening = f.panels.open(1, 'technical');
  assert.deepEqual(f.opened, [1]);
  f.connect(1); await opening; await f.complete(1); await delay(400);
  assert.equal(f.calls.length, 1); assert.equal((await f.summaries.snapshot(1)).preset, 'technical');
});
test('switching tabs never rebinds an existing panel or auto-summarizes an unopened page', async t => {
  const f = await fixture(t), port = f.connect(1); await f.complete(1);
  f.activate(2); await delay(450); assert.equal(f.calls.length, 1); assert.equal(await f.summaries.snapshot(2), null);
  port.onMessage.emit({ type: 'bind', tabId: 2, visible: true });
  await delay(50); assert.equal(port.summaryTab, 1);
  f.activate(1); await delay(450); assert.equal(f.calls.length, 1);
  assert(port.messages.filter(m => m.type === 'state').every(m => m.tabId === 1));
});
test('visible panel waits for page load and summarizes navigation or same-URL refresh once', async t => {
  const f = await fixture(t); f.connect(1); await f.complete(1);
  f.navigate(1, 'https://article.example/next', { complete: false });
  await delay(400); assert.equal(f.calls.length, 1);
  f.finish(1); await until(() => f.calls.length === 2); await f.complete(1);
  assert(f.calls[1].messages.at(-1).content.includes('NEW_PAGE https://article.example/next'));
  f.navigate(1, 'https://article.example/next'); await until(() => f.calls.length === 3); await f.complete(1);
  assert.equal((await f.summaries.snapshot(1)).stale, false);
});
test('hidden and disconnected panels never auto-request after navigation', async t => {
  const f = await fixture(t), port = f.connect(1); await f.complete(1);
  port.onMessage.emit({ type: 'visibility', tabId: 1, visible: false });
  f.navigate(1, 'https://article.example/hidden'); await delay(450); assert.equal(f.calls.length, 1);
  port.onMessage.emit({ type: 'visibility', tabId: 1, visible: true });
  await until(() => f.calls.length === 2); await f.complete(1);
  port.disconnect(); f.navigate(1, 'https://article.example/closed'); await delay(450); assert.equal(f.calls.length, 2);
});
test('blacklisting closes and cancels only the affected page, then prevents all new requests', async t => {
  const f = await fixture(t); f.mode('slow');
  f.tabs.get(2).active = true; f.connect(1); f.connect(2);
  await until(() => f.calls.length === 2);
  f.value.blacklist = ['article.example']; await f.panels.syncAll();
  await until(async () => (await f.summaries.snapshot(1))?.phase === 'stopped');
  assert.equal(f.options.get(1).enabled, false); assert.equal(f.options.get(2).enabled, true);
  assert.equal((await f.summaries.snapshot(2)).phase, 'streaming');
  f.navigate(1, 'https://sub.article.example/blocked'); await delay(450); assert.equal(f.calls.length, 2);
});
test('errors and stopped partial output are not retried by visibility or native reopen events', async t => {
  const f = await fixture(t); f.mode('403'); const port = f.connect(1);
  await until(async () => (await f.summaries.snapshot(1))?.phase === 'error');
  port.onMessage.emit({ type: 'visibility', tabId: 1, visible: true }); await f.panels.open(1); await delay(400);
  assert.equal(f.calls.length, 1);
  f.mode('slow'); await f.summaries.start(1, 'general'); await until(() => f.calls.length === 2);
  f.summaries.stop(1); port.onMessage.emit({ type: 'visibility', tabId: 1, visible: true }); await delay(400);
  assert.equal(f.calls.length, 2);
  f.mode('ok'); await f.summaries.start(1, 'general'); await f.complete(1); assert.equal(f.calls.length, 3);
});
test('blacklisting an inactive tab cancels it immediately and defers native disabling to preserve the foreground panel', async t => {
  const f = await fixture(t); f.mode('slow'); f.connect(1); await until(() => f.calls.length === 1);
  f.activate(2); f.connect(2); await until(() => f.calls.length === 2);
  f.value.blacklist = ['article.example']; await f.panels.syncAll();
  assert.equal((await f.summaries.snapshot(1)).phase, 'stopped');
  assert.equal((await f.summaries.snapshot(2)).phase, 'streaming');
  // Native Chrome closes the foreground container if a background entry is
  // disabled. The denied page is disabled on activation, before it is usable.
  assert.equal(f.options.get(1).enabled, true);
  f.activate(1); await until(() => f.options.get(1).enabled === false);
  assert.equal(f.calls.length, 2); assert.equal((await f.summaries.snapshot(2)).phase, 'streaming');
});
test('navigation invalidates an old in-flight stream without stale results replacing the new page', async t => {
  const f = await fixture(t); f.mode('slow'); f.connect(1); await until(() => f.calls.length === 1);
  const old = (await f.summaries.snapshot(1)).id;
  f.mode('ok'); f.navigate(1, 'https://article.example/newest');
  await until(() => f.calls.length === 2); await f.complete(1);
  const latest = await f.summaries.snapshot(1);
  assert.notEqual(latest.id, old); assert.equal(latest.stale, false); assert.equal(latest.source.url, 'https://article.example/newest');
});
test('older supported browsers use port visibility without requiring newer opened/closed APIs', async t => {
  const f = await fixture(t, { modern: false }), port = f.connect(1); await f.complete(1);
  port.onMessage.emit({ type: 'visibility', tabId: 1, visible: false });
  f.navigate(1, 'https://article.example/background'); await delay(400); assert.equal(f.calls.length, 1);
  port.onMessage.emit({ type: 'visibility', tabId: 1, visible: true });
  await until(() => f.calls.length === 2); await f.complete(1);
});
