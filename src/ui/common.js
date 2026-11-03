export const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const paths = {
  logo: 'M5 10 4 3l6 4h4l6-4-1 7c5 8 0 11-7 11S0 18 5 10ZM8 13h.01M16 13h.01m-6 3 2 1 2-1m-2 1v2',
  book: 'M12 6.5C9 4.5 5.5 4 3 4.5v14c3-.5 6 0 9 2 3-2 6-2.5 9-2v-14c-2.5-.5-6 0-9 2ZM12 6.5v14',
  library: 'M3 4h4v16H3V4ZM11 4v16M15.5 4.5l5 14.5-3 1-5-14.5 3-1ZM3 8h4M3 16h4',
  settings: 'm9 3-.6 2-2 .9-1.9-.4-2 3.5L4 10.5v3l-1.5 1.5 2 3.5 1.9-.4 2 .9L9 21h6l.6-2 2-.9 1.9.4 2-3.5-1.5-1.5v-3L21.5 9l-2-3.5-1.9.4-2-.9L15 3ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  arrow: 'M4 12h15m-6-6 6 6-6 6', up: 'M6 18 18 6M6 6h12v12', globe: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z',
  lock: 'M5 10h14v11H5V10ZM8 10V7a4 4 0 0 1 8 0v3M12 14v3', hover: 'm6 3 12 9-6 1-3 6L6 3ZM14 16l3 5', inline: 'M7 4C2 8 2 16 7 20M17 4c5 4 5 12 0 16M10 9h4M10 15h4',
  search: 'M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Zm-1 5.5 5 5', trash: 'M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7', edit: 'm15 4 5 5M4 20l5-1L21 7l-5-5L4 14v6Z',
  close: 'm6 6 12 12M6 18 18 6', check: 'm5 12 4 4L19 6', download: 'M12 3v13m-5-5 5 5 5-5M4 16v5h16v-5', spark: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3ZM20 2v4M18 4h4',
  help: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM9.5 9a2.5 2.5 0 1 1 4 2c-1.5 1-1.5 1.5-1.5 3M12 17h.01',
  monitor: 'M3 3h18v13H3V3ZM8 21h8M12 16v5', translate: 'M3 5h12M9 3v2M5 8c2 4 4 6 8 8M13 5c-1 5-4 9-10 12m10 4 4-11 4 11m-6.5-4h5',
  sliders: 'M4 7h8m4 0h4M4 17h3m4 0h9M16 7a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM11 17a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z',
  cpu: 'M6 6h12v12H6V6ZM9 9h6v6H9V9ZM9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3',
  shield: 'm12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm-4 9 3 3 5-6', eye: 'M2 12S6 5 12 5s10 7 10 7-4 7-10 7S2 12 2 12ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z', leaf: 'M20 3C6 1 1 10 6 16c6 6 15 1 14-13ZM4 21 16 8M8 17v-6m3 3h5'
};
export const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name] || paths.book}"/></svg>`;
export const brand = () => `<div class="brand"><span class="brand-mark">${icon('logo')}</span><div><strong>点译</strong><small>DIANYI</small></div></div>`;
export async function api(type, data = {}) {
  let reply;
  try { reply = await chrome.runtime.sendMessage({ type: `SHIYI/${type}`, ...data }); }
  catch { throw new Error('无法连接点译后台，请在扩展管理页重新加载插件后重试。'); }
  if (!reply?.ok) throw Object.assign(new Error(reply?.error?.message || '操作未完成，请重试。'), { code: reply?.error?.code });
  return reply.data;
}
export function requestHost(url) {
  const parsed = new URL(url);
  const origins = [`${parsed.protocol}//${parsed.hostname}/*`];
  return chrome.permissions.contains({ origins }).then(granted => granted || chrome.permissions.request({ origins }));
}
let noticeTimer;
export function notify(message, undo) {
  clearTimeout(noticeTimer); const root = document.getElementById('notice');
  if (!root) return;
  root.innerHTML = `<div class="notice-toast">${icon('check')}<span>${esc(message)}</span>${undo ? '<button id="undo-action" type="button">撤销</button>' : ''}</div>`;
  if (undo) document.getElementById('undo-action').onclick = async () => { try { await undo(); root.innerHTML = ''; } catch (error) { notify(error.message); } };
  noticeTimer = setTimeout(() => { root.innerHTML = ''; }, undo ? 8000 : 4500);
}
export const languageOptions = (languages, value) => Object.entries(languages).map(([key, label]) => `<option value="${key}"${key === value ? ' selected' : ''}>${esc(label)}</option>`).join('');
export function downloadJSON(payload) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `dianyi-vocabulary-${new Date().toISOString().slice(0, 10)}.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
}
