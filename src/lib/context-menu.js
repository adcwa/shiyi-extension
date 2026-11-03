import { PAGE_MATCHES } from './site-policy.js';

export const MENU = Object.freeze({ root: 'shiyi', selection: 'shiyi-selection', page: 'shiyi-page', restore: 'shiyi-restore', site: 'shiyi-site', settings: 'shiyi-settings' });
export const menuItems = () => [
  { id: MENU.root, title: '点译', contexts: ['page', 'selection'], documentUrlPatterns: [...PAGE_MATCHES] },
  { id: MENU.selection, parentId: MENU.root, title: '翻译选中文字', contexts: ['selection'] },
  { id: MENU.page, parentId: MENU.root, title: '翻译当前页面', contexts: ['page', 'selection'] },
  { id: MENU.restore, parentId: MENU.root, title: '恢复原文', contexts: ['page', 'selection'] },
  { id: 'shiyi-separator', parentId: MENU.root, type: 'separator', contexts: ['page', 'selection'] },
  { id: MENU.site, parentId: MENU.root, type: 'checkbox', title: '在此网站启用点译', checked: true, contexts: ['page', 'selection'] },
  { id: MENU.settings, parentId: MENU.root, title: '模型设置', contexts: ['page', 'selection'] }
];
export function createContextMenus(chromeApi, actions) {
  let tail = Promise.resolve();
  const call = (method, ...args) => new Promise((resolve, reject) => {
    chromeApi.contextMenus[method](...args, () => { const error = chromeApi.runtime.lastError; if (error) reject(new Error(error.message)); else resolve(); });
  });
  function install() {
    const run = tail.then(async () => { await call('removeAll'); for (const item of menuItems()) await call('create', item); });
    tail = run.catch(() => {}); return run;
  }
  async function update(tabId) {
    await tail;
    const state = await actions.state(tabId), enabled = !!state?.enabled;
    await Promise.all([
      call('update', MENU.site, { checked: enabled, enabled: !!state?.supported && (!!state.permitted || !!state.blocked) }),
      call('update', MENU.selection, { enabled: enabled && !state.page?.active }),
      call('update', MENU.page, { enabled }),
      call('update', MENU.restore, { enabled: enabled && !!state.page?.active })
    ]);
  }
  async function click(info, tab) {
    if (!Number.isInteger(tab?.id)) return;
    if (info.menuItemId === MENU.settings) return actions.settings();
    const state = await actions.state(tab.id);
    if (!state?.supported) return;
    if (info.menuItemId === MENU.site) { if (!state.permitted && !state.blocked) return; await actions.toggle(state); await update(tab.id); return; }
    if (!state.enabled || info.frameId && info.frameId !== 0) return;
    if (info.menuItemId === MENU.selection && !info.editable && !state.page?.active && typeof info.selectionText === 'string' && info.selectionText.trim()) return actions.selection(tab.id, info.selectionText);
    if (info.menuItemId === MENU.page) return actions.page(tab.id, 'translate');
    if (info.menuItemId === MENU.restore) return actions.page(tab.id, 'restore');
  }
  return Object.freeze({ install, update, click });
}
