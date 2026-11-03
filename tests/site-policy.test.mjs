import test from 'node:test';
import assert from 'node:assert/strict';
import { blacklistSite, cleanBlacklist, blockingSite, changeBlacklist, migrateSitePolicy } from '../src/lib/site-policy.js';
import { createContextMenus, MENU, menuItems } from '../src/lib/context-menu.js';

test('normal webpages default on and blacklist matches a domain and its subdomains across schemes and ports', () => {
  assert.equal(blockingSite('https://new.example/read', []), null);
  for (const url of ['https://example.com/read', 'http://example.com:8080/', 'https://docs.example.com/']) assert.equal(blockingSite(url, ['example.com']), 'example.com');
  for (const url of ['https://notexample.com/', 'https://example.com.evil.test/', 'https://other.test/', 'chrome://extensions/']) assert.equal(blockingSite(url, ['example.com']), null);
});
test('blacklist input accepts domains and full page URLs, strips paths and normalizes IDNs, without accepting credentials or browser pages', () => {
  assert.equal(blacklistSite('HTTPS://Example.COM:8443/article?query=x#part'), 'example.com');
  assert.equal(blacklistSite('localhost:8123/path'), 'localhost');
  assert.equal(blacklistSite('https://[::1]:8123/'), '[::1]');
  assert.equal(blacklistSite('https://例子.测试/'), new URL('https://例子.测试/').hostname);
  for (const value of ['chrome://settings', 'file:///secret', 'https://user:password@example.com', 'https://chromewebstore.google.com/', '', 'not a domain']) assert.throws(() => blacklistSite(value));
});
test('redundant rules are merged and removing the matching rule restores a subdomain in one step', () => {
  const values = cleanBlacklist(['docs.example.com', 'example.com', 'EXAMPLE.com', 'bad domain', 'other.test']);
  assert.deepEqual(values, ['other.test', 'example.com']);
  assert.deepEqual(changeBlacklist(values, 'deep.docs.example.com', true), values);
  assert.equal(blockingSite('https://docs.example.com/', changeBlacklist(values, 'example.com', false)), null);
});
test('upgrade preserves model and preference data, carries explicit disabled sites into blacklist and drops enabled whitelist rules', () => {
  const previous = { version: 1, profile: { endpoint: 'https://gateway.example/v1', model: 'my-model' }, prefs: { targetLanguage: 'ja' }, sites: [{ origin: 'https://enabled.example', enabled: true }, { origin: 'https://paused.example:9000', enabled: false }] };
  const next = migrateSitePolicy(previous);
  assert.equal(next.version, 2); assert.equal(next.sitePolicy, 'blacklist'); assert.deepEqual(next.blacklist, ['paused.example']);
  assert.deepEqual(next.profile, previous.profile); assert.deepEqual(next.prefs, previous.prefs); assert.equal(next.sites, undefined);
  assert.deepEqual(migrateSitePolicy(next), next); assert.deepEqual(migrateSitePolicy().blacklist, []);
});
function fixture(state = { supported: true, permitted: true, enabled: true, blocked: false, page: { active: false } }) {
  const events = [], chrome = { runtime: {}, contextMenus: {} };
  for (const method of ['create', 'update', 'removeAll']) chrome.contextMenus[method] = (...args) => { const callback = args.pop(); events.push({ method, args }); callback(); };
  const actions = { state: async () => state };
  for (const name of ['settings', 'toggle', 'selection', 'page']) actions[name] = async (...args) => { events.push({ action: name, args }); };
  return { menus: createContextMenus(chrome, actions), events, state };
}
test('native menu registration provides selection, page, restore and a persistent site checkbox only on ordinary webpages', async () => {
  const { menus, events } = fixture(); await menus.install();
  assert.equal(events[0].method, 'removeAll'); assert.equal(events.filter(item => item.method === 'create').length, menuItems().length);
  assert.deepEqual(events[1].args[0].documentUrlPatterns, ['http://*/*', 'https://*/*']);
  assert.equal(menuItems().find(item => item.id === MENU.site).type, 'checkbox');
});
test('native selection commands only translate top-document body selections, without editor or blocked-site bypasses', async () => {
  const { menus, events, state } = fixture();
  await menus.click({ menuItemId: MENU.selection, selectionText: 'curiosity', frameId: 0, editable: false }, { id: 9 });
  assert.deepEqual(events, [{ action: 'selection', args: [9, 'curiosity'] }]);
  for (const change of [{ editable: true }, { frameId: 2 }, { selectionText: '' }]) await menus.click({ menuItemId: MENU.selection, selectionText: 'private', frameId: 0, ...change }, { id: 9 });
  state.enabled = false; state.blocked = true;
  await menus.click({ menuItemId: MENU.selection, selectionText: 'blocked' }, { id: 9 });
  await menus.click({ menuItemId: MENU.page }, { id: 9 });
  assert.equal(events.length, 1);
  await menus.click({ menuItemId: MENU.site, checked: true }, { id: 9 });
  assert.equal(events.find(item => item.action === 'toggle').args[0], state);
});
test('page actions and menu state follow the current blacklist and reading state', async () => {
  const { menus, events, state } = fixture();
  await menus.click({ menuItemId: MENU.page }, { id: 4 }); assert.deepEqual(events[0], { action: 'page', args: [4, 'translate'] });
  state.page.active = true; await menus.update(4);
  assert.deepEqual(events.find(item => item.method === 'update' && item.args[0] === MENU.restore).args[1], { enabled: true });
  assert.deepEqual(events.find(item => item.method === 'update' && item.args[0] === MENU.selection).args[1], { enabled: false });
});
test('withheld browser permission cannot turn a website-on click into an unintended blacklist addition', async () => {
  const { menus, events } = fixture({ supported: true, permitted: false, enabled: false, blocked: false });
  await menus.update(4); await menus.click({ menuItemId: MENU.site, checked: true }, { id: 4 });
  assert.equal(events.find(item => item.method === 'update' && item.args[0] === MENU.site).args[1].enabled, false);
  assert.equal(events.some(item => item.action === 'toggle'), false);
});
