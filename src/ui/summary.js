import { api } from './common.js';
import { SUMMARY_PRESETS } from '../lib/summary-presets.js';

const $ = selector => document.querySelector(selector), R = globalThis.DianyiDocs;
let tabId, port, result, view = 'content', follow = true, frame, toastTimer, exportTarget, retryBusy = false, unloading = false;
const artifacts = new Map(), sourceViews = new Set(), positions = new Map();
const active = () => ['queued','extracting', 'classifying', 'streaming'].includes(result?.phase);
const scroller = $('#summary-scroller'), doc = $('#summary-doc');
const statusLabels = { queued:'已保存 · 排队总结中',waiting:'已保存 · 等待模型连接', extracting: '正在读取网页…', classifying: '正在识别主题…', streaming: '正在生成总结…', complete: '总结完成', stopped: '已停止 · 内容已保留', interrupted: '生成已中断', error: '生成未完成' };
function toast(text) { clearTimeout(toastTimer); $('#notice').textContent = text; $('#notice').hidden = false; toastTimer = setTimeout(() => { $('#notice').hidden = true; }, 4000); }
function remember() {
  if (!scroller.clientHeight || !scroller.dataset.resultId) return;
  const top = scroller.getBoundingClientRect().top, children = [...doc.children], index = children.findIndex(node => node.getBoundingClientRect().bottom > top + 4);
  positions.set(`${scroller.dataset.resultId}:${scroller.dataset.resultView}`, { top: scroller.scrollTop, index, offset: index < 0 ? 0 : children[index].getBoundingClientRect().top - top });
  if (positions.size > 16) positions.delete(positions.keys().next().value);
}
function restore() {
  const position = positions.get(`${result?.id}:${view}`); if (!position) return;
  const anchor = doc.children[position.index];
  if (anchor) scroller.scrollTop += anchor.getBoundingClientRect().top - scroller.getBoundingClientRect().top - position.offset;
  else scroller.scrollTop = position.top;
}
function patch(parent, fresh) {
  const before = [...parent.childNodes], after = [...fresh.childNodes];
  after.forEach((node, index) => {
    const old = before[index];
    if (old?.nodeType === 1 && node.nodeType === 1 && old.dataset.artifact && old.dataset.artifact === node.dataset.artifact) return;
    if (old?.isEqualNode(node)) return;
    if (old && old.nodeType === 1 && node.nodeType === 1 && old.nodeName === node.nodeName) {
      for (const attr of [...old.attributes]) if (!node.hasAttribute(attr.name)) old.removeAttribute(attr.name);
      for (const attr of node.attributes) old.setAttribute(attr.name, attr.value);
      patch(old, node);
    } else if (old) old.replaceWith(node); else parent.append(node);
  });
  before.slice(after.length).forEach(node => node.remove());
}
function render() {
  frame = null; remember();
  const s = result, hasText = !!s?.text;
  $('#source-title').textContent = s?.source?.title || '当前网页';
  $('#source-detail').textContent = s ? [s.source?.domain, SUMMARY_PRESETS[s.chosen || s.preset]?.name, s.model].filter(Boolean).join(' · ') : '当前标签页 · 优先读取本地总结';
  $('#summary-status').textContent = s?.automaticDisabled&&!hasText?'自动总结已关闭':s ? statusLabels[s.phase] || '正在准备总结…' : '正在准备总结…';
  $('#summary-stop').hidden = !active(); $('#summary-retry').hidden = active(); $('#summary-retry').disabled = retryBusy;
  $('#summary-retry').textContent = hasText?'重新总结':'总结当前网页';
  const warnings = [];
  if (s?.stale) warnings.push('网页已变化，正在等待当前页加载后自动总结。');
  if (s?.truncated) warnings.push('本页较长，本次仅纳入前 60,000 字符以内的已加载正文。');
  if (s?.fallback) warnings.push('主题识别结果不完整，已改用通用总结。');
  $('#scope-note').textContent = warnings.join(' '); $('#scope-note').hidden = !warnings.length;
  const message = $('#summary-message'); message.classList.toggle('error', !!s?.error);
  if (s?.automaticDisabled&&!hasText) {message.classList.remove('error');message.innerHTML='<p>点击“总结当前网页”手动生成，不会开启自动总结。</p>';}
  else if (s?.error) { message.replaceChildren(); const title = document.createElement('h2'); title.textContent = s.phase === 'stopped' ? '生成已停止' : '这次总结未完成'; const text = document.createElement('p'); text.textContent = s.error; message.append(title, text); }
  else if (!hasText) { message.innerHTML = '<p>总结完成后会保存在本地，再次打开即可阅读。</p>'; }
  else message.replaceChildren();
  const parsed = R.parse(s?.text || '', { streaming: s?.phase !== 'complete' });
  artifacts.clear(); parsed.artifacts.forEach(item => artifacts.set(item.id, item));
  const template = document.createElement('template'); template.innerHTML = parsed.html;
  if (view === 'artifacts') {
    const only = document.createDocumentFragment(); [...template.content.querySelectorAll('.artifact')].forEach(node => only.append(node));
    if (!only.children.length) { const text = document.createElement('p'); text.className = 'muted'; text.textContent = '完整的代码、表格、图形或公式生成后，会显示在这里。'; only.append(text); }
    patch(doc, only);
  } else patch(doc, template.content);
  scroller.dataset.resultId = s?.id || ''; scroller.dataset.resultView = view;
  $('.output-tabs').hidden = !hasText; $('#artifact-count').textContent = parsed.artifacts.length;
  document.querySelectorAll('[data-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === view)));
  for (const el of doc.querySelectorAll('.artifact')) {
    const source = el.querySelector('.artifact-source'), preview = el.querySelector('.artifact-preview'), toggle = el.querySelector('[data-artifact-action="source"]');
    if (source && preview) { source.hidden = !sourceViews.has(el.dataset.artifact); preview.hidden = !source.hidden; if (toggle) toggle.textContent = source.hidden ? '源码' : '预览'; }
    if (el.dataset.kind === 'mermaid' && !el.dataset.mounted) {
      el.dataset.mounted = 'true'; const item = artifacts.get(el.dataset.artifact);
      R.diagram(item.source).then(svg => { if (!el.isConnected) return; remember(); el.querySelector('.artifact-preview').innerHTML = svg; if (follow && active()) scroller.scrollTop = scroller.scrollHeight; else restore(); }).catch(() => { if (el.isConnected) el.querySelector('.artifact-preview').textContent = '图形未能预览，仍可复制或导出源码。'; });
    }
  }
  $('#copy-summary').disabled = !hasText; $('#export-summary').disabled = !hasText;
  $('#output-note').textContent = s?.chars ? `${s.chars.toLocaleString()} 字符 · ${s.phase === 'complete' ? '仅基于本页' : '部分结果'}` : '仅基于当前网页';
  if (hasText && follow && ['streaming', 'complete'].includes(s.phase)) scroller.scrollTop = scroller.scrollHeight; else restore();
  $('#new-output').hidden = !hasText || !active() || follow;
}
function schedule() { if (!frame) frame = requestAnimationFrame(render); }
function accept(next) {
  if (next?.id !== result?.id) { remember(); doc.replaceChildren(); scroller.dataset.resultId = ''; sourceViews.clear(); view = 'content'; follow = true; scroller.scrollTop = 0; }
  result = next; schedule();
}
function panelMessage(type) { try { port?.postMessage({ type, tabId, visible: document.visibilityState === 'visible' }); } catch {} }
function connect() {
  port = chrome.runtime.connect({ name: 'SHIYI_SUMMARY' });
  port.onMessage.addListener(message => { if (message.type === 'state' && message.tabId === tabId) accept(message.state); });
  port.onDisconnect.addListener(() => { if (unloading) return; if (chrome.runtime.lastError) toast('后台连接已断开，正在重新连接…'); setTimeout(connect, 800); });
  panelMessage('bind');
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); }
  catch { const input = document.createElement('textarea'); input.value = text; input.style.cssText = 'position:fixed;left:-10000px'; document.body.append(input); input.select(); const ok = document.execCommand('copy'); input.remove(); if (!ok) throw new Error('浏览器未允许复制，请选择文本后手动复制。'); }
  toast('已复制');
}
function download(text, name, type = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type })), anchor = document.createElement('a'); anchor.href = url; anchor.download = name; document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function markdown() { return `# ${result.source?.title || '网页总结'}\n\n> 来源：${result.source?.url || ''}\n> 总结方式：${SUMMARY_PRESETS[result.chosen || result.preset]?.name || '通用总结'}\n> ${result.phase === 'complete' ? '已完成' : '部分结果'}${result.truncated ? '；资料已截取' : ''}\n\n${result.text}`; }
async function html() {
  const parsed = R.parse(markdown(), { streaming: result.phase !== 'complete' }), holder = document.createElement('div'); holder.innerHTML = parsed.html;
  for (const item of parsed.artifacts) {
    const el = holder.querySelector(`[data-artifact="${item.id}"]`); el?.querySelector('.artifact-head')?.remove(); el?.querySelector('.artifact-source[hidden]')?.remove();
    if (item.kind === 'mermaid') try { el.querySelector('.artifact-preview').innerHTML = await R.diagram(item.source); } catch { el.querySelector('.artifact-preview').textContent = item.source; }
  }
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'"><title>点译 · 网页总结</title><style>body{max-width:780px;margin:40px auto;padding:0 24px;font:16px/1.85 system-ui;color:#263735}h1{font-size:26px}h2{font-size:21px;margin-top:32px}pre{padding:16px;background:#f4f6f2;overflow:auto;white-space:pre-wrap;font-size:13px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #dce4df;padding:9px;text-align:left}svg{max-width:100%;height:auto}math{font-size:21px}a{color:#006665}</style>${holder.innerHTML}</html>`;
}
const codeExtension = item => ({ javascript: 'js', typescript: 'ts', python: 'py', json: 'json', css: 'css', bash: 'sh', sh: 'sh', html: 'txt' })[item.lang] || 'txt';
function exportMenu(button, item) {
  exportTarget = item || null;
  const formats = !item ? [['md', 'Markdown（.md）'], ['html', '可阅读文档（.html）']] : item.kind === 'mermaid' ? [['mmd', 'Mermaid 源码（.mmd）'], ['svg', '图形（.svg）']] : item.kind === 'table' ? [['csv', '表格（.csv）'], ['md', '表格源码（.md）']] : item.kind === 'math' ? [['tex', '公式源码（.tex）']] : [['code', `代码（.${codeExtension(item)}）`]];
  const menu = $('#export-menu'); menu.replaceChildren();
  for (const [format, text] of formats) { const choice = document.createElement('button'); choice.type = 'button'; choice.dataset.format = format; choice.textContent = text; menu.append(choice); }
  const rect = button.getBoundingClientRect(); menu.style.left = `${Math.max(8, Math.min(innerWidth - 195, rect.right - 190))}px`; menu.style.top = `${Math.max(8, rect.top - formats.length * 38 - 16)}px`; menu.showPopover();
}
async function exportFile(format) {
  $('#export-menu').hidePopover(); const item = exportTarget;
  if (!item) { if (format === 'html') download(await html(), '点译-网页总结.html', 'text/html;charset=utf-8'); else download(markdown(), '点译-网页总结.md', 'text/markdown;charset=utf-8'); }
  else if (format === 'svg') download(await R.diagram(item.source), '点译-图形.svg', 'image/svg+xml;charset=utf-8');
  else if (format === 'csv') download(R.csv(item.source), '点译-表格.csv', 'text/csv;charset=utf-8');
  else download(item.source, `点译-制品.${format === 'code' ? codeExtension(item) : format}`);
  toast('已导出');
}
document.addEventListener('click', event => {
  const button = event.target.closest('button'); if (!button) return;
  (async () => {
    if (button.dataset.view) { remember(); view = button.dataset.view; follow = false; render(); }
    else if (button.dataset.format) await exportFile(button.dataset.format);
    else if (button.dataset.artifactAction) {
      const item = artifacts.get(button.dataset.id); if (!item) return;
      if (button.dataset.artifactAction === 'copy') await copy(item.source);
      else if (button.dataset.artifactAction === 'download') exportMenu(button, item);
      else { sourceViews.has(item.id) ? sourceViews.delete(item.id) : sourceViews.add(item.id); render(); }
    } else if (button.id === 'summary-stop') await api('SUMMARY_STOP', { tabId });
    else if (button.id === 'summary-retry') { if (retryBusy) return; retryBusy = true; button.disabled = true; try { await api('SUMMARY_START', { tabId, preset: result?.preset }); } finally { retryBusy = false; schedule(); } }
    else if (button.id === 'copy-summary') await copy(markdown());
    else if (button.id === 'export-summary') exportMenu(button);
    else if (button.id === 'new-output') { follow = true; scroller.scrollTop = scroller.scrollHeight; button.hidden = true; }
  })().catch(error => toast(error.message));
});
scroller.addEventListener('scroll', () => { follow = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 70; remember(); $('#new-output').hidden = follow || !active(); });
document.addEventListener('visibilitychange', () => panelMessage('visibility'));
window.addEventListener('pagehide', () => { unloading = true; port?.disconnect(); });
try {
  const id = new URL(location.href).searchParams.get('tabId');
  if (!/^\d+$/.test(id || '') || !Number.isSafeInteger(Number(id))) throw new Error('请从当前网页的插件弹窗或右键菜单打开总结。');
  tabId = Number(id); connect(); render();
} catch (error) { $('#summary-status').textContent = '无法读取当前网页'; $('#summary-message').textContent = error.message; }
