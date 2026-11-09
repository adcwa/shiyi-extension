(() => {
  'use strict';
  if (globalThis.__shiyiContent) { globalThis.__shiyiContent.refresh(); return; }
  if (window !== window.top || !['http:', 'https:'].includes(location.protocol) || document.contentType === 'application/pdf') return;
  const Text = globalThis.ShiyiText, Companion = globalThis.ShiyiCompanion;
  const Reader = globalThis.ShiyiReader, LONG_TEXT = globalThis.ShiyiBlockText.LONG_TEXT;
  const skipSelector = 'script,style,noscript,input,textarea,select,option,button,pre,code,kbd,samp,svg,math,canvas,video,audio,iframe,[contenteditable]:not([contenteditable="false"]),[hidden],[aria-hidden="true"],[data-shiyi-meaning],[data-shiyi-root],[data-shiyi-block-translation]';
  const blockSelector = 'p,li,h1,h2,h3,h4,h5,h6,blockquote,figcaption,td,th,dt,dd,div,section,article,main,body';
  const languages = { 'zh-CN': '简体中文', en: 'English', ja: '日本語', ko: '한국어', fr: 'Français', de: 'Deutsch', es: 'Español' };
  const languageNames = { 'zh-CN': '中文', en: '英语', ja: '日语', ko: '韩语', fr: '法语', de: '德语', es: '西班牙语' };
  let enabled = false, prefs = {}, entries = new Map(), trie = Text.compile([]), snapshot = '', refreshVersion = 0;
  let events, observer, host, shadow, panel, toastNode, closeTimer, toastTimer, currentRequest, lastSelection, keyboardAnchor, suppressFocus = false;
  let scanRoots = new Set(), idleHandle, scanGeneration = 0, dragging = false;
  let readerBar, readerRevision = '', readerLayout = 'auto', longEntries = new Map(), contextSelection, menuReading = false;
  let petVisible = false, petOpen = false, petPosition = {}, modelConfigured = false, pageRestoreKey = '', lastDocumentURL = '', routeWatch;
  let changingToolLanguage = false;
  // Each source text run retains its page-owned first node. Incremental updates
  // may remove an inner decoration before a preceding one; pairwise before/after
  // references cannot restore that case. Only join adjacent pieces of our run.
  const sourceRuns = new WeakMap(), splitRuns = new Set(), meaningAppearance = new WeakMap();
  const legacyOwners = new Map();
  const reader = Reader.create({ send, prefs: () => prefs, signature: () => readerRevision, notice: text => showToast(text),
    mutate: work => { observer?.disconnect(); try { return work(); } finally { observe(); } },
    onEnter: () => {
      scanGeneration++; if (idleHandle) cancelIdle(idleHandle); idleHandle = null; scanRoots.clear();
      if (currentRequest) { send('CANCEL', { requestId: currentRequest.id }).catch(() => {}); currentRequest = null; }
      observer?.disconnect(); clearAnnotations(); hidePanel();
    },
    onExit: () => { if (enabled) { observe(); if (entries.size) queueScan(document.body); } },
    onState: renderReader
  });
  // Isolated-world access only: summary reads source text without changing the
  // page, including when the reader currently replaces it with translations.
  globalThis.ShiyiPageSource = Object.freeze({ text: node => reader.sourceText(node) });
  const paths = {
    logo: ['M4 5.5h6.5L8 13h7l-2.5 5.5M4 20h16M16 4h4v4M20 4l-5 5'],
    chevron: ['m7 10 5 5 5-5'], more: ['M4 12h.01M12 12h.01M20 12h.01'],
    close: ['m6 6 12 12M6 18 18 6'], trash: ['M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7'],
    book: ['M12 6.5C9 4.5 5.5 4 3 4.5v14c3-.5 6 0 9 2 3-2 6-2.5 9-2v-14c-2.5-.5-6 0-9 2ZM12 6.5v14'],
    edit: ['m15 4 5 5M4 20l5-1L21 7l-5-5L4 14v6Z'], check: ['m5 12 4 4L19 6'], arrow: ['M4 12h15m-6-6 6 6-6 6'],
    translate: ['M3 5h12M9 3v2M5 8c2 4 4 6 8 8M13 5c-1 5-4 9-10 12m10 4 4-11 4 11m-6.5-4h5']
  };
  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
    for (const d of paths[name] || paths.book) { const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', d); svg.append(path); }
    return svg;
  }
  function el(tag, attributes = {}, ...children) {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attributes)) {
      if (name === 'class') node.className = value;
      else if (name.startsWith('on')) node.addEventListener(name.slice(2), value);
      else if (value !== false && value != null) node.setAttribute(name, String(value));
    }
    for (const child of children.flat()) if (child != null) node.append(typeof child === 'string' ? document.createTextNode(child) : child);
    return node;
  }
  function button(label, action, className = '', glyph) {
    // The host page can inspect an open ShadowRoot. Synthetic page-script clicks
    // must not spend a user's model quota, edit the glossary or change reading.
    return el('button', { type: 'button', class: className, onclick: event => { if (event.isTrusted) return action(event); } }, ...(glyph ? [icon(glyph)] : []), label);
  }
  async function send(type, payload = {}) {
    let response;
    try { response = await chrome.runtime.sendMessage({ type: `SHIYI/${type}`, ...payload }); }
    catch { throw Object.assign(new Error('点译已更新或暂时无法连接，请刷新网页后重试。'), { code: 'DISCONNECTED' }); }
    if (!response?.ok) throw Object.assign(new Error(response?.error?.message || '操作未完成，请重试。'), { code: response?.error?.code, connectionsExhausted: response?.error?.connectionsExhausted === true });
    return response.data;
  }
  const uiStyle = `:host{all:initial}*{box-sizing:border-box}svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round;flex-shrink:0}button,input{font:inherit}button{cursor:pointer;border:0;background:none;color:inherit}button:focus-visible,input:focus-visible,[tabindex]:focus-visible{outline:2px solid #006665;outline-offset:3px}button:hover{background:#eaf2e9}button:disabled{opacity:.6;cursor:wait}.panel{pointer-events:auto;position:fixed;max-width:calc(100vw - 24px);max-height:calc(100vh - 24px);overflow:auto;background:#fff;color:#263735;border:1px solid #ccdcd0;border-radius:13px;box-shadow:0 12px 44px #1739272b;font:13px/1.75 -apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;text-align:left;letter-spacing:normal;word-break:normal}.tool{display:flex;gap:4px;padding:5px;align-items:center;border-radius:9px;width:max-content;flex-wrap:wrap}.tool button{padding:8px 11px;border-radius:6px;display:flex;align-items:center;gap:6px;white-space:nowrap;font-size:12px}.tool .primary,.primary{background:#006665;color:#fff}.tool .primary:hover,.primary:hover{background:#005251}.tool label{display:flex;align-items:center;gap:4px;font-size:10px;padding:5px 4px;cursor:pointer;white-space:nowrap}.tool input{accent-color:#006665;width:13px;height:13px}.card{width:320px;border-radius:10px;box-shadow:0 6px 26px #17392720}
.inside{padding:16px}
.meaning{font-size:16px;font-weight:500;line-height:1.7;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--shiyi-translation-ink,#263d34)}
.source-text{font-size:12px;font-weight:400;line-height:1.6;color:#657268;margin:8px 0 0;white-space:pre-wrap;overflow-wrap:anywhere;max-height:96px;overflow:auto;scrollbar-width:thin}
.meta{font-size:11px;color:#657268}
.foot{padding:5px 8px 5px 16px;border-top:1px solid #e8ede7;display:flex;align-items:center;justify-content:space-between;gap:8px}
.card-actions{display:flex;align-items:center;gap:2px}
.foot button{min-height:32px;padding:6px 8px;border-radius:6px;display:flex;align-items:center;gap:5px;font-size:11px;color:#506459}
.foot button svg{width:14px;height:14px}
.foot .danger:hover{color:#a84038;background:#fff1ef}
.foot .primary{color:#fff}
.foot .hint{margin:0}
.hint{font-size:11px;line-height:1.9;color:#657662;margin:9px 0 0}.error{color:#9a3932}.primary{padding:8px 12px;border-radius:7px;font-size:12px;display:inline-flex;align-items:center;gap:6px}.close{height:28px;width:28px;display:grid;place-items:center;border-radius:6px}.spinner{display:inline-block;width:13px;height:13px;border:1.5px solid #adc9b6;border-top-color:#006665;border-radius:50%;animation:spin .7s linear infinite;margin-right:7px;vertical-align:middle}.toast{pointer-events:auto;position:fixed;bottom:22px;left:50%;transform:translateX(-50%);max-width:calc(100vw - 24px);padding:12px 15px;border-radius:9px;background:#213e32;color:white;font:12px/1.8 -apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC',sans-serif;box-shadow:0 8px 25px #12382725;display:flex;align-items:center;gap:12px;white-space:normal}.toast button{color:#d3eac8;white-space:nowrap;padding:4px 6px;border-radius:4px}.toast button:hover{background:#3b5945}@keyframes spin{to{transform:rotate(360deg)}}
.tool.selection-tool{display:block;padding:0;border:0;border-radius:0;background:transparent;box-shadow:none;overflow:visible;max-height:none}
.selection-capsule{display:flex;align-items:center;gap:2px;padding:2px;border:1px solid #d3e0d6;border-radius:999px;background:#fff;box-shadow:0 3px 12px #17392718;white-space:nowrap}
.selection-split{display:flex;align-items:center;border-radius:999px;background:#006665;color:white}
.selection-capsule button{height:28px;padding:0;justify-content:center;gap:0;border-radius:999px;font-size:12px;line-height:1.25;flex:none}
.selection-capsule .selection-main{min-width:50px;padding:0 11px;border-radius:999px 0 0 999px;font-weight:500}
.selection-capsule .selection-language{position:relative;width:24px;border-radius:0 999px 999px 0;color:white}
.selection-language:before{content:'';position:absolute;left:0;top:8px;bottom:8px;width:1px;background:#ffffff3d}
.selection-split button:hover{background:#005251}.selection-language svg{width:12px;height:12px}
.selection-capsule .selection-icon{width:28px;color:#5d7267;position:relative}.selection-icon svg{width:14px;height:14px}
.selection-context-on:after{content:'';position:absolute;width:4px;height:4px;border-radius:50%;background:#006665;top:4px;right:5px}
.selection-menu{position:fixed;width:162px;max-width:calc(100vw - 24px);max-height:calc(100vh - 24px);overflow:auto;padding:5px;border:1px solid #d3e0d6;border-radius:12px;background:#fff;color:#263735;box-shadow:0 6px 24px #17392724;z-index:1}
.selection-menu[hidden]{display:none!important}.selection-menu-title{font-size:10px;color:#657268;padding:3px 8px 5px;line-height:1.5}
.tool .selection-option{display:flex;align-items:center;justify-content:space-between;width:100%;min-height:30px;padding:5px 9px;border-radius:6px;font-size:12px;line-height:1.5;gap:8px}
.selection-option[aria-selected="true"]{color:#006665;background:#eef4ee;font-weight:500}.selection-option svg{width:13px;height:13px}
.selection-context-menu{width:236px}.tool .selection-context-label{font-size:12px;min-height:32px;padding:3px 7px;gap:7px}.selection-context-help{font-size:10px;line-height:1.7;color:#657268;padding:0 7px 5px 27px;margin:0}
@media(prefers-reduced-motion:reduce){.spinner{animation:none}}`;
  function ensureUI() {
    if (host?.isConnected) { host.style.setProperty('--shiyi-translation-ink', prefs.translationColorLight || '#245e4d'); return; }
    host = document.createElement('div'); host.id = 'shiyi-extension-root'; host.dataset.shiyiRoot = 'true';
    host.style.cssText = 'all:initial!important;position:fixed!important;top:0!important;left:0!important;width:0!important;height:0!important;z-index:2147483647!important;pointer-events:none!important;';
    host.style.setProperty('--shiyi-translation-ink', prefs.translationColorLight || '#245e4d');
    shadow = host.attachShadow({ mode: 'open' }); const style = document.createElement('style'); style.textContent = uiStyle + readerStyle; shadow.append(style); document.documentElement.append(host);
  }
  const readerStyle = Companion.styles;
  function renderReader(state) {
    if (menuReading !== state.active) { menuReading = state.active; send('MENU_REFRESH').catch(() => {}); }
    if (!enabled || !petVisible) { readerBar?.remove(); readerBar = null; return; }
    ensureUI();
    if (!readerBar?.isConnected) {
      readerBar = el('section', { class: 'companion', 'aria-label': '点译阅读助手' });
      const toggle = button('', () => { petOpen = !petOpen; renderReader(reader.status()); }, 'pet-button');
      toggle.dataset.petToggle = ''; toggle.setAttribute('aria-controls', 'dianyi-pet-menu'); toggle.append(Companion.createSVG());
      Companion.enableDrag(readerBar, toggle, petPosition);
      const details = el('div', { class: 'pet-panel', id: 'dianyi-pet-menu', role: 'region', 'aria-label': '点译阅读控制', hidden: true });
      const close = button('', () => { petVisible = false; petOpen = false; renderReader(reader.status()); }, 'pet-close', 'close'); close.setAttribute('aria-label', '关闭小猫'); close.title = '关闭小猫，再次点击工具栏点译图标可显示';
      const modes = el('div', { class: 'pet-modes', role: 'group', 'aria-label': '页面译文显示方式' });
      for (const [value, label] of [['bilingual', '双语对照'], ['translation', '仅译文']]) { const item = button(label, () => reader.command('mode', value)); item.dataset.readerMode = value; modes.append(item); }
      const primary = button('翻译当前页面', () => {
        const latest = reader.status(); petOpen = false;
        if (!modelConfigured && !latest.cached) send('OPEN_OPTIONS', { section: 'model' }).catch(error => showToast(error.message));
        else Promise.resolve(reader.command(latest.cached ? 'load-local' : 'translate', latest.mode)).catch(error => showToast(error.message));
        renderReader(reader.status());
      }, 'primary pet-main', 'translate'); primary.dataset.readerMain = '';
      const actions = el('div', { class: 'pet-actions' });
      for (const [value, label] of [['stop', '停止翻译'], ['resume', '继续翻译'], ['retry', '重试失败'], ['refresh', '翻译新增内容'], ['retranslate', '重新翻译'], ['restore', '恢复原文']]) {
        const item = button(label, () => {
          if (['retranslate', 'restore', 'resume'].includes(value)) petOpen = false;
          Promise.resolve(reader.command(value, reader.status().mode)).catch(error => showToast(error.message)); renderReader(reader.status());
        }); item.dataset.readerAction = value; actions.append(item);
      }
      const setup = button('配置模型', () => send('OPEN_OPTIONS', { section: 'model' }).catch(error => showToast(error.message))); setup.dataset.readerSetup = ''; actions.append(setup);
      const progress = el('progress', { 'aria-label': '页面翻译进度', max: 1, value: 0 });
      details.append(el('div', { class: 'pet-top' }, el('strong', {}, icon('translate'), '点译'), close), modes, primary,
        el('p', { class: 'pet-status', role: 'status', 'aria-live': 'polite' }), progress,
        el('p', { class: 'pet-cache' }), el('p', { class: 'pet-error' }), actions,
        el('div', { class: 'pet-footer' }, button('我的词库', () => send('OPEN_OPTIONS', { section: 'library' }).catch(error => showToast(error.message))), button('翻译设置', () => send('OPEN_OPTIONS', { section: 'translation' }).catch(error => showToast(error.message)))));
      const strip = el('progress', { class: 'pet-progress', 'aria-label': '页面翻译进度', max: 1, value: 0, hidden: true });
      readerBar.append(toggle, strip, details); shadow.append(readerBar);
      Companion.place(readerBar, petPosition);
    }
    const toggle = readerBar.querySelector('[data-pet-toggle]');
    toggle.setAttribute('aria-label', petOpen ? '点译小猫，收起功能' : '点译小猫，展开功能'); toggle.setAttribute('aria-expanded', String(petOpen));
    readerBar.querySelector('.pet-panel').hidden = !petOpen;
    const strip = readerBar.querySelector('.pet-progress');
    strip.hidden = !state.running || petOpen; strip.max = state.total || 1; strip.value = state.completed;
    readerBar.querySelectorAll('[data-reader-mode]').forEach(item => item.setAttribute('aria-pressed', String(item.dataset.readerMode === state.mode)));
    const primary = readerBar.querySelector('[data-reader-main]'); primary.hidden = state.active;
    primary.lastChild.textContent = state.cached ? '加载本地译文' : modelConfigured ? '翻译当前页面' : '连接翻译模型';
    readerBar.querySelector('.pet-status').textContent = state.localLoading ? '正在读取本页暂存…' : state.phase === 'collecting' ? '正在识别页面内容…' : state.active ? `已翻译 ${state.completed} / ${state.total} 块${state.running ? ' · 进行中' : state.phase === 'paused' ? ' · 已停止' : state.waiting ? ' · 可继续' : ' · 已完成'}` : '点一下，翻译当前页面。';
    const progress = readerBar.querySelector('.pet-panel progress'); progress.hidden = !state.active; progress.max = state.total || 1; progress.value = state.completed;
    readerBar.querySelector('.pet-cache').textContent = state.cacheError || (state.restored ? `已从本地加载 ${state.restored} 块${state.newContent ? '，页面有新内容。' : '，无需重复请求。'}` : state.cached ? '本页译文已暂存在此浏览器。' : '翻译后自动暂存，刷新可直接恢复。');
    readerBar.querySelector('.pet-error').textContent = state.error || '';
    for (const [name, show] of Object.entries({ stop: state.running, resume: state.active && !state.running && state.waiting > 0, retry: state.active && !state.running && state.failed > 0, refresh: state.active && !state.running && state.newContent, retranslate: state.active || state.cached > 0, restore: state.active })) readerBar.querySelector(`[data-reader-action="${name}"]`).hidden = !show;
    readerBar.querySelector('[data-reader-setup]').hidden = !['MODEL_NOT_CONFIGURED', 'MISSING_KEY', 'MODEL_PERMISSION', 'HTTP_401', 'HTTP_403', 'CODEX_UNAVAILABLE', 'CODEX_AUTH', 'CODEX_PERMISSION', 'CODEX_MODEL', 'CODEX_CAPABILITY'].includes(state.errorCode);
    Companion.positionPanel(readerBar);
  }
  function hidePanel() { clearTimeout(closeTimer); panel?.remove(); panel = null; }
  function scheduleHide() {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => { if (!panel?.contains(shadow?.activeElement) && !currentRequest) hidePanel(); }, 230);
  }
  function position(node, rect) {
    const pad = 12, width = node.offsetWidth, height = node.offsetHeight;
    const left = Math.max(pad, Math.min(innerWidth - width - pad, rect.left));
    let top = rect.bottom + 9;
    if (top + height > innerHeight - pad) top = Math.max(pad, rect.top - height - 9);
    node.style.left = `${left}px`; node.style.top = `${top}px`;
  }
  function newPanel(className, rect, label) {
    ensureUI(); hidePanel();
    panel = el('section', { class: `panel ${className}`, role: className === 'tool' ? 'toolbar' : 'dialog', 'aria-label': label, tabindex: '-1' });
    shadow.append(panel); panel.addEventListener('pointerenter', () => clearTimeout(closeTimer));
    return panel;
  }
  function showToast(text, token) {
    ensureUI(); toastNode?.remove(); clearTimeout(toastTimer);
    const node = el('div', { class: 'toast', role: 'status', 'aria-live': 'polite' }, icon('check'), el('span', {}, text));
    if (token) node.append(button('撤销', async () => {
      try { await send('UNDO', { token }); showToast('词句和标记已恢复'); } catch (error) { showToast(error.message); }
    }));
    toastNode = node; shadow.append(node); toastTimer = setTimeout(() => node.remove(), token ? 8000 : 4500);
  }
  function showSaved(entry, anchor, keyboard = false, rectOverride) {
    if (!enabled) return;
    const rect = rectOverride || anchor?.getBoundingClientRect(); if (!rect) return;
    keyboardAnchor = anchor;
    const node = newPanel('card', rect, `${entry.text} 的已存释义`);
    node.append(el('div', { class: 'inside' },
      el('div', { class: 'meaning', lang: entry.targetLanguage }, entry.translation),
      el('div', { class: 'source-text', lang: entry.sourceLanguage || 'und', 'aria-label': '原文' }, entry.text)));
    const remove = button('删除', async () => {
      try { const result = await send('DELETE', { id: entry.id }); hidePanel(); await refresh(); showToast(`已删除 ${result.removed} 个词句并移除对应标记`, result.token); }
      catch (error) { showToast(error.message); }
    }, 'danger', 'trash');
    remove.setAttribute('aria-label', '取消标记并从词库删除'); remove.title = '取消标记并从词库删除';
    const edit = button('编辑', () => send('OPEN_OPTIONS', { section: 'library', entryId: entry.id }).catch(error => showToast(error.message)), '', 'edit');
    node.append(el('div', { class: 'foot' },
      el('span', { class: 'meta', title: `${languages[entry.targetLanguage] || entry.targetLanguage} · 本地词库` }, '已存释义'),
      el('div', { class: 'card-actions' }, edit, remove)));
    node.addEventListener('pointerleave', scheduleHide); position(node, rect); if (keyboard) node.focus({ preventScroll: true });
  }
  function showTool(selection) {
    if (!enabled) return;
    lastSelection = selection;
    const blockMode = !!selection.owners, name = languageNames[prefs.targetLanguage] || '中文';
    const existing = !blockMode && [...entries.values()].find(entry => Text.normalize(entry.text) === Text.normalize(selection.text));
    const node = newPanel('tool selection-tool', selection.rect, blockMode ? '按段翻译操作' : '划词翻译操作');
    const main = button(name, () => {
      if (changingToolLanguage) return;
      if (blockMode) { getSelection()?.removeAllRanges(); reader.start({ owners: selection.owners, mode: 'bilingual' }); }
      else if (existing) { getSelection()?.removeAllRanges(); showSaved(existing, null, true, selection.rect); }
      else translate(selection);
    }, 'primary selection-main');
    const actionName = blockMode ? `按段翻译为${name}` : existing ? `查看${name}释义` : `翻译为${name}`;
    main.setAttribute('aria-label', actionName); main.title = actionName;
    const choose = button('', () => {
      const open = languageMenu.hidden; closeSelectionMenus();
      if (open) { languageMenu.hidden = false; choose.setAttribute('aria-expanded', 'true'); position(languageMenu, choose.getBoundingClientRect()); languageMenu.querySelector('[aria-selected="true"]')?.focus({ preventScroll: true }); }
    }, 'selection-language', 'chevron');
    choose.setAttribute('aria-label', '选择目标语言'); choose.title = '选择目标语言'; choose.setAttribute('aria-haspopup', 'listbox'); choose.setAttribute('aria-expanded', 'false'); choose.setAttribute('aria-controls', 'shiyi-selection-languages');
    const languageMenu = el('div', { class: 'selection-menu', id: 'shiyi-selection-languages', role: 'listbox', 'aria-label': '目标语言', hidden: true }, el('div', { class: 'selection-menu-title', 'aria-hidden': 'true' }, '目标语言'));
    for (const [language, label] of Object.entries(languageNames)) {
      const option = button(language === 'zh-CN' ? '简体中文' : label, async event => {
        closeSelectionMenus();
        if (language === prefs.targetLanguage) { main.focus({ preventScroll: true }); return; }
        if (changingToolLanguage) return;
        changingToolLanguage = true; node.querySelectorAll('button').forEach(control => { control.disabled = true; });
        try { await send('SET_TARGET_LANGUAGE', { targetLanguage: language }); await refresh(); }
        catch (error) { showToast(error.message); }
        finally {
          changingToolLanguage = false;
          if (panel?.classList.contains('selection-tool') && lastSelection === selection) {
            panel.querySelectorAll('button').forEach(control => { control.disabled = false; });
            if (event.detail === 0) panel.querySelector('.selection-main')?.focus({ preventScroll: true });
          }
        }
      }, 'selection-option');
      option.setAttribute('role', 'option'); option.setAttribute('aria-selected', String(language === prefs.targetLanguage));
      if (language === prefs.targetLanguage) option.append(icon('check'));
      languageMenu.append(option);
    }
    languageMenu.addEventListener('keydown', event => {
      if (!event.isTrusted || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      const options = [...languageMenu.querySelectorAll('[role="option"]')], index = options.indexOf(shadow.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
      options[next].focus({ preventScroll: true }); event.preventDefault();
    });
    const capsule = el('div', { class: 'selection-capsule' }, el('div', { class: 'selection-split' }, main, choose));
    node.append(capsule, languageMenu);
    if (!blockMode) {
      const checkbox = el('input', { type: 'checkbox', 'aria-label': '附带相邻一句语境' }); checkbox.checked = prefs.includeContext;
      checkbox.addEventListener('change', async event => {
        if (!event.isTrusted) { checkbox.checked = prefs.includeContext; return; }
        const desired = checkbox.checked; checkbox.disabled = true;
        try { await send('SET_CONTEXT', { enabled: desired }); prefs.includeContext = desired; more.classList.toggle('selection-context-on', desired); }
        catch (error) { checkbox.checked = !desired; showToast(error.message); }
        finally { checkbox.disabled = false; }
      });
      const contextMenu = el('div', { class: 'selection-menu selection-context-menu', id: 'shiyi-selection-context', hidden: true }, el('label', { class: 'selection-context-label' }, checkbox, '附带相邻一句语境'), el('p', { class: 'selection-context-help' }, '开启后，将相邻一句一并发送给模型。'));
      const more = button('', () => {
        const open = contextMenu.hidden; closeSelectionMenus();
        if (open) { contextMenu.hidden = false; more.setAttribute('aria-expanded', 'true'); position(contextMenu, more.getBoundingClientRect()); checkbox.focus({ preventScroll: true }); }
      }, `selection-icon${prefs.includeContext ? ' selection-context-on' : ''}`, 'more');
      more.setAttribute('aria-label', '更多翻译选项'); more.title = '更多选项'; more.setAttribute('aria-expanded', 'false'); more.setAttribute('aria-controls', 'shiyi-selection-context');
      capsule.append(more); node.append(contextMenu);
    }
    const close = button('', hidePanel, 'selection-icon', 'close'); close.setAttribute('aria-label', '关闭划词工具'); close.title = '关闭'; capsule.append(close);
    node.querySelectorAll('button').forEach(control => { control.disabled = changingToolLanguage; });
    position(node, selection.rect);
  }
  function closeSelectionMenus() {
    panel?.querySelectorAll('.selection-menu').forEach(menu => { menu.hidden = true; });
    panel?.querySelectorAll('[aria-controls]').forEach(control => { control.setAttribute('aria-expanded', 'false'); });
  }
  function showLoading(selection) {
    const node = newPanel('card', selection.rect, '正在翻译');
    node.append(el('div', { class: 'inside' },
      el('div', { class: 'meaning', role: 'status' }, el('span', { class: 'spinner', 'aria-hidden': 'true' }), '正在翻译…'),
      el('div', { class: 'source-text', 'aria-label': '原文' }, selection.text)));
    node.append(el('div', { class: 'foot' }, el('span', { class: 'hint' }, prefs.includeContext ? '本次会附带相邻一句语境' : '本次只发送选中的文本'), button('取消', cancelTranslation)));
    position(node, selection.rect);
  }
  function showError(selection, error) {
    const node = newPanel('card', selection.rect, '翻译未完成');
    const needSetup = ['MODEL_NOT_CONFIGURED', 'MISSING_KEY', 'MODEL_PERMISSION', 'HTTP_401', 'HTTP_403', 'CODEX_UNAVAILABLE', 'CODEX_AUTH', 'CODEX_PERMISSION', 'CODEX_MODEL', 'CODEX_CAPABILITY'].includes(error.code);
    node.append(el('div', { class: 'inside' },
      el('div', { class: 'meaning error', role: 'alert' }, error.message),
      el('div', { class: 'source-text', 'aria-label': '原文' }, selection.text)));
    node.append(el('div', { class: 'foot' }, button('关闭', hidePanel), button(needSetup ? '配置模型' : '重试', () => needSetup ? send('OPEN_OPTIONS', { section: 'model' }).catch(e => showToast(e.message)) : translate(selection), 'primary', 'arrow')));
    position(node, selection.rect);
  }
  async function translate(selection) {
    if (currentRequest || !enabled) return;
    const id = crypto.randomUUID(); currentRequest = { id, selection }; showLoading(selection);
    try {
      const result = await send('TRANSLATE', { requestId: id, text: selection.text, ...(prefs.includeContext ? { context: selection.context } : {}), title: document.title.slice(0, 240) });
      if (currentRequest?.id !== id || !enabled) return;
      currentRequest = null; getSelection()?.removeAllRanges(); await refresh();
      showSaved(result.entry, null, true, selection.rect); showToast(result.reused ? '已复用本地释义' : '翻译完成');
    } catch (error) { if (currentRequest?.id === id && enabled) { currentRequest = null; showError(selection, error); } }
  }
  function cancelTranslation() {
    if (!currentRequest) return;
    const request = currentRequest; currentRequest = null;
    send('CANCEL', { requestId: request.id }).catch(() => {}); showTool(request.selection); showToast('已取消本次翻译');
  }
  function clearAnnotations(root = document) {
    for (const [element, owner] of legacyOwners) if (!element.isConnected || root === document || root.contains?.(owner)) { element.remove(); legacyOwners.delete(element); }
    root.querySelectorAll?.('[data-shiyi-legacy]').forEach(node => node.remove());
    root.querySelectorAll?.('[data-shiyi-meaning]').forEach(node => node.remove());
    root.querySelectorAll?.('[data-shiyi-mark]').forEach(mark => unwrapMark(mark));
    compactRuns(splitRuns);
  }
  function unwrapMark(mark, touched) {
    for (const node of mark.childNodes) { const run = sourceRuns.get(node); if (run) touched?.add(run); }
    mark.replaceWith(...mark.childNodes);
  }
  function compactRuns(runs) {
    for (const run of runs) {
      for (const node of [...run]) {
        if (!node.isConnected) { run.delete(node); continue; }
        let next;
        while ((next = node.nextSibling)?.nodeType === Node.TEXT_NODE && sourceRuns.get(next) === run) {
          node.appendData(next.data); run.delete(next); next.remove();
        }
      }
      if (run.size <= 1) splitRuns.delete(run);
    }
  }
  function splitSource(node, start, end) {
    const run = sourceRuns.get(node) || new Set([node]);
    const middle = node.splitText(start), after = middle.splitText(end - start);
    for (const piece of [node, middle, after]) { run.add(piece); sourceRuns.set(piece, run); }
    splitRuns.add(run); return middle;
  }
  function validNode(node, visibility) {
    const parent = node.parentElement;
    if (!parent || !node.textContent || parent.closest(skipSelector)) return false;
    let current = parent;
    while (current && current !== document.documentElement) {
      if (visibility.has(current)) return visibility.get(current);
      const style = getComputedStyle(current);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') { visibility.set(current, false); return false; }
      current = current.parentElement;
    }
    visibility.set(parent, true); return true;
  }
  function observe() { if (enabled && !reader.status().active && document.body) observer?.observe(document.body, { childList: true, characterData: true, subtree: true }); }
  function matchingOperations(nodes, text) {
    const matches = Text.find(text, trie), segments = [], operations = []; let offset = 0, cursor = 0;
    for (const node of nodes) { segments.push({ node, start: offset, end: offset + node.length }); offset += node.length; }
    // Matches and source segments are ordered. Walk both forwards so checking
    // an already decorated paragraph stays linear in its fragment count.
    for (const match of matches) {
      while (cursor < segments.length && segments[cursor].end <= match.start) cursor++;
      const first = operations.length;
      for (let index = cursor; index < segments.length && segments[index].start < match.end; index++) {
        const segment = segments[index];
        operations.push({ node: segment.node, start: Math.max(0, match.start - segment.start), end: Math.min(segment.node.length, match.end - segment.start), entry: match.entry, last: false });
      }
      if (operations.length > first) operations.at(-1).last = true;
    }
    return operations;
  }
  function annotate(nodes, pending) {
    if (reader.status().active || !nodes.length || nodes.length > 600) return;
    const text = nodes.map(node => node.data).join('');
    if (!text.trim() || text.length > 100000) return;
    const marks = new Set(nodes.map(node => node.parentElement?.closest('[data-shiyi-mark]')).filter(Boolean));
    const touched = new Set(), operations = matchingOperations(nodes, text), retained = new Set();
    const long = longEntries.get(Text.normalize(text));
    if (!long) for (const operation of operations) {
      const { node, start, end, entry } = operation, mark = node.parentElement;
      if (mark?.dataset.shiyiMark === entry.id && start === 0 && end === node.length && mark.childNodes.length === 1 && !mark.parentElement.closest('[data-shiyi-mark]')) {
        operation.mark = mark; retained.add(mark);
      }
    }
    observer.disconnect();
    try {
      for (const mark of marks) {
        pending.marks.delete(mark);
        if (!retained.has(mark)) {
          const meaning = mark.nextSibling;
          if (meaning?.nodeType === Node.ELEMENT_NODE && meaning.hasAttribute('data-shiyi-meaning')) { pending.meanings.delete(meaning); meaning.remove(); }
          unwrapMark(mark, touched);
        }
      }
      const owner = Reader.ownerOf(nodes[0]); let existingLong;
      for (const [element, source] of legacyOwners) if (source === owner) {
        pending.legacy.delete(element);
        if (long && element.isConnected && element.dataset.shiyiLegacy === long.id && !existingLong) existingLong = element;
        else { element.remove(); legacyOwners.delete(element); }
      }
      if (long) {
        if (Text.isTargetLanguage(text, prefs.targetLanguage, nodes[0].parentElement?.closest('[lang]')?.getAttribute('lang'))) {
          if (existingLong) { existingLong.remove(); legacyOwners.delete(existingLong); }
        } else if (existingLong) {
          if (existingLong.textContent !== long.translation) existingLong.textContent = long.translation;
          Reader.translationTheme(existingLong, owner, prefs);
        } else {
          const element = Reader.insertion({ owner, slots: nodes.map(node => ({ node })) }, long.translation, prefs.targetLanguage, prefs);
          element.dataset.shiyiLegacy = long.id; legacyOwners.set(element, owner);
        }
        return;
      }
      // Reconcile actual occurrences, not a map keyed only by vocabulary ID.
      // Keep valid marks and their meanings in place. Never clear a block and
      // wait for a later idle callback to reconstruct it.
      for (const operation of operations.reverse()) {
        const { node, start, end, entry, last } = operation;
        let mark = operation.mark;
        if (!mark) {
          if (!node.isConnected || end > node.length || start >= end) continue;
          const middle = splitSource(node, start, end);
          mark = document.createElement('span'); mark.dataset.shiyiMark = entry.id;
          mark.setAttribute('aria-label', `${entry.text}，查看已存释义`); mark.setAttribute('aria-haspopup', 'dialog');
          if (!node.parentElement?.closest('a')) { mark.tabIndex = 0; mark.setAttribute('role', 'button'); }
          middle.replaceWith(mark); mark.append(middle);
        }
        let meaning = mark.nextSibling;
        if (meaning?.nodeType !== Node.ELEMENT_NODE || !meaning.hasAttribute('data-shiyi-meaning')) meaning = null;
        if (prefs.displayMode === 'inline' && last) {
          if (!meaning) { meaning = document.createElement('span'); meaning.setAttribute('aria-label', '释义'); mark.after(meaning); }
          pending.meanings.delete(meaning); meaning.dataset.shiyiMeaning = entry.id;
          const value = `（${entry.translation}）`, appearance = JSON.stringify([prefs.translationColorLight, prefs.translationColorDark]);
          if (meaning.textContent !== value) meaning.textContent = value;
          if (meaningAppearance.get(meaning) !== appearance) { Reader.translationTheme(meaning, mark.parentElement, prefs); meaningAppearance.set(meaning, appearance); }
        } else if (meaning) { pending.meanings.delete(meaning); meaning.remove(); }
      }
    } finally { compactRuns(touched); observe(); }
  }
  function finishScan(pending) {
    const touched = new Set();
    observer.disconnect();
    try {
      for (const meaning of pending.meanings) meaning.remove();
      for (const mark of pending.marks) if (mark.isConnected) unwrapMark(mark, touched);
      for (const element of pending.legacy) { element.remove(); legacyOwners.delete(element); }
      compactRuns(touched);
      for (const run of splitRuns) {
        for (const node of run) if (!node.isConnected) run.delete(node);
        if (!run.size) splitRuns.delete(run);
      }
    } finally { observe(); }
  }
  const requestIdle = callback => window.requestIdleCallback ? requestIdleCallback(callback, { timeout: 180 }) : setTimeout(() => callback({ timeRemaining: () => 8 }), 16);
  const cancelIdle = handle => window.cancelIdleCallback ? cancelIdleCallback(handle) : clearTimeout(handle);
  function queueScan(root) {
    if (!enabled || reader.status().active || !root?.isConnected) return;
    if (root.closest?.('[data-shiyi-root],[data-shiyi-meaning],[data-shiyi-block-translation]')) return;
    for (const pending of scanRoots) { if (pending.contains(root)) return; if (root.contains(pending)) scanRoots.delete(pending); }
    scanRoots.add(root);
    if (!idleHandle) idleHandle = requestIdle(startScan);
  }
  function startScan() {
    idleHandle = null;
    if (!enabled || reader.status().active || !scanRoots.size) return;
    if (dragging || !getSelection()?.isCollapsed) { idleHandle = requestIdle(startScan); return; }
    const root = scanRoots.values().next().value; scanRoots.delete(root);
    if (!root.isConnected) { if (scanRoots.size) idleHandle = requestIdle(startScan); return; }
    const pending = {
      marks: new Set(root.querySelectorAll('[data-shiyi-mark]')),
      meanings: new Set(root.querySelectorAll('[data-shiyi-meaning]')),
      legacy: new Set([...legacyOwners].filter(([element, owner]) => element.isConnected && (root === owner || root.contains(owner))).map(([element]) => element))
    };
    const generation = scanGeneration, walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), visibility = new WeakMap();
    let group = [], block = null;
    function flush() { annotate(group, pending); group = []; }
    function chunk(deadline) {
      idleHandle = null;
      if (!enabled || generation !== scanGeneration || !root.isConnected) return;
      if (dragging || !getSelection()?.isCollapsed) { idleHandle = requestIdle(chunk); return; }
      let node, count = 0; const sliceStarted = performance.now();
      // Background tabs often reach the idle timeout with a zero budget. Make
      // bounded progress there instead of scanning only one node per timeout.
      while ((count < 200 && (deadline.didTimeout || deadline.timeRemaining() > 4) && performance.now() - sliceStarted < 8) || count === 0) {
        node = walker.nextNode(); if (!node) { flush(); finishScan(pending); if (scanRoots.size) idleHandle = requestIdle(startScan); return; }
        count++;
        // splitText may leave empty source nodes after annotations are removed.
        // They do not form a semantic boundary inside an otherwise continuous phrase.
        if (!node.textContent) continue;
        // One canonical source view for matching and reconciliation. Injected
        // meanings are transparent, including while other text is changing.
        if (node.parentElement.closest('[data-shiyi-root],[data-shiyi-meaning],[data-shiyi-block-translation]')) continue;
        if (!validNode(node, visibility)) { flush(); block = null; continue; }
        const currentBlock = node.parentElement.closest(blockSelector) || root;
        if (block && currentBlock !== block) flush();
        block = currentBlock; group.push(node);
        if (group.length > 600) { group = []; block = null; }
      }
      idleHandle = requestIdle(chunk);
    }
    idleHandle = requestIdle(chunk);
  }
  function sourceText(root) {
    const clone = root.cloneNode(true); clone.querySelectorAll?.('[data-shiyi-meaning],[data-shiyi-root],[data-shiyi-block-translation]').forEach(node => node.remove()); return clone.textContent || '';
  }
  function readSelection() {
    if (!enabled || reader.status().active || currentRequest) return;
    const selection = getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return;
    const range = selection.getRangeAt(0), start = range.startContainer.parentElement, end = range.endContainer.parentElement;
    if (!start || !end || !document.body?.contains(start) || !document.body.contains(end) || start.closest(skipSelector) || end.closest(skipSelector)) return;
    const clone = range.cloneContents(); clone.querySelectorAll?.('[data-shiyi-meaning],[data-shiyi-root],[data-shiyi-block-translation]').forEach(node => node.remove());
    const text = clone.textContent.trim(); if (!text) return;
    if (text.length > 16000) { showToast('长文可使用插件菜单中的“翻译当前页面”；单次选区最多 16000 个字符'); return; }
    const owners = Reader.selectedOwners(range), blockMode = text.length > LONG_TEXT || owners.size > 1;
    const ancestor = start.closest('p,li,blockquote,td,div,article,section') || start;
    const fullContext = sourceText(ancestor).replace(/\s+/g, ' ').trim();
    // Word translation only includes this bounded optional context. Page reading
    // is a separate explicit action with a separate block request and cache.
    const index = fullContext.indexOf(text), left = Math.max(0, index - 180), right = Math.min(fullContext.length, Math.max(index, 0) + text.length + 180);
    const context = fullContext.slice(left, right).slice(0, 1200);
    const rect = range.getBoundingClientRect();
    return { text, context, ...(blockMode ? { owners } : {}), rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom } };
  }
  function captureSelection() {
    const selection = readSelection(); if (selection) showTool(selection);
  }
  async function contextTranslate(text) {
    await refresh();
    if (!enabled) return { ok: false, error: { code: 'SITE_DISABLED', message: '此网站已在黑名单中停用。' } };
    if (reader.status().active) { showToast('恢复原文后即可翻译选中文字。'); return { ok: false }; }
    const saved = contextSelection && Date.now() - contextSelection.at < 60000 ? contextSelection.selection : null;
    const selection = saved || readSelection(); contextSelection = null;
    if (!selection || Text.normalize(selection.text) !== Text.normalize(text) || selection.owners && ![...selection.owners].every(owner => owner?.isConnected)) {
      showToast('请在正文中重新选中文字后翻译。'); return { ok: false };
    }
    dragging = false;
    if (selection.owners) { getSelection()?.removeAllRanges(); reader.start({ owners: selection.owners, mode: 'bilingual' }); }
    else translate(selection);
    return { ok: true, started: true };
  }
  function activate() {
    events = new AbortController(); const options = { capture: true, signal: events.signal };
    document.addEventListener('pointerdown', event => {
      if (event.composedPath().includes(host)) return;
      if (document.body?.contains(event.target)) dragging = event.button === 0;
      if (!event.target.closest?.('[data-shiyi-mark]') && !currentRequest) hidePanel();
    }, options);
    document.addEventListener('pointerup', event => {
      dragging = false;
      if (event.button === 0 && !event.composedPath().includes(host)) setTimeout(captureSelection, 0);
    }, options);
    document.addEventListener('contextmenu', event => {
      dragging = false;
      const selection = !event.target.closest?.(skipSelector) && !event.composedPath().includes(host) ? readSelection() : null;
      contextSelection = selection ? { selection, at: Date.now() } : null;
      send('MENU_REFRESH').catch(() => {});
    }, options);
    document.addEventListener('pointercancel', () => { dragging = false; }, options);
    document.addEventListener('mouseover', event => {
      if (currentRequest || dragging || event.buttons !== 0 || !getSelection()?.isCollapsed) return;
      const mark = event.target.closest?.('[data-shiyi-mark]');
      if (mark && !mark.contains(event.relatedTarget)) { const entry = entries.get(mark.dataset.shiyiMark); if (entry) showSaved(entry, mark); }
    }, options);
    document.addEventListener('mouseout', event => {
      const mark = event.target.closest?.('[data-shiyi-mark]');
      if (mark && !mark.contains(event.relatedTarget)) scheduleHide();
    }, options);
    document.addEventListener('focusin', event => {
      const mark = event.target.closest?.('[data-shiyi-mark]');
      if (mark && !suppressFocus && entries.has(mark.dataset.shiyiMark)) showSaved(entries.get(mark.dataset.shiyiMark), mark);
    }, options);
    document.addEventListener('click', event => {
      const mark = event.target.closest?.('[data-shiyi-mark]');
      if (mark && !mark.closest('a') && getSelection()?.isCollapsed && entries.has(mark.dataset.shiyiMark)) { event.preventDefault(); showSaved(entries.get(mark.dataset.shiyiMark), mark, true); }
    }, options);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        const openMenu = panel?.querySelector('.selection-menu:not([hidden])');
        if (openMenu) { const control = panel.querySelector(`[aria-controls="${openMenu.id}"]`); closeSelectionMenus(); control?.focus({ preventScroll: true }); event.preventDefault(); return; }
        if (petOpen) { petOpen = false; renderReader(reader.status()); }
        if (currentRequest) cancelTranslation(); else hidePanel();
        suppressFocus = true; keyboardAnchor?.focus?.({ preventScroll: true }); suppressFocus = false;
      }
      const mark = event.target.closest?.('[data-shiyi-mark]');
      if (mark && !mark.closest('a') && ['Enter', ' '].includes(event.key)) { event.preventDefault(); const entry = entries.get(mark.dataset.shiyiMark); if (entry) showSaved(entry, mark, true); }
    }, options);
    document.addEventListener('keyup', event => { if (event.key === 'Shift' && !event.composedPath().includes(host)) captureSelection(); }, options);
    window.addEventListener('scroll', () => { if (!currentRequest) hidePanel(); }, { capture: true, passive: true, signal: events.signal });
    window.addEventListener('resize', () => {
      if (!currentRequest) hidePanel();
      if (readerBar?.isConnected) Companion.place(readerBar, petPosition);
    }, { signal: events.signal });
    window.addEventListener('pagehide', () => { reader.stop(); if (currentRequest) send('CANCEL', { requestId: currentRequest.id }).catch(() => {}); }, { signal: events.signal });
    observer = new MutationObserver(records => {
      for (const record of records) {
        const element = record.target.nodeType === Node.TEXT_NODE ? record.target.parentElement : record.target;
        if (!element || element.closest?.('[data-shiyi-root],[data-shiyi-meaning],[data-shiyi-block-translation]')) continue;
        queueScan(element.closest?.(blockSelector) || document.body);
      }
    });
    observe();
    routeWatch = setInterval(() => { if (enabled && lastDocumentURL !== location.href) refresh().catch(() => {}); }, 750);
    for (const type of ['popstate', 'hashchange']) window.addEventListener(type, () => refresh().catch(() => {}), { signal: events.signal });
  }
  function deactivate() {
    enabled = false; events?.abort(); observer?.disconnect(); scanGeneration++; clearInterval(routeWatch); petVisible = false; petOpen = false; petPosition = {}; pageRestoreKey = ''; lastDocumentURL = '';
    reader.restore();
    if (idleHandle) cancelIdle(idleHandle); idleHandle = null; scanRoots.clear();
    currentRequest = null; contextSelection = null; dragging = false; clearAnnotations(); hidePanel();
    host?.remove(); host = null; shadow = null; clearTimeout(toastTimer);
  }
  async function refresh() {
    const version = ++refreshVersion; let state;
    try { state = await send('HELLO'); } catch { deactivate(); return; }
    if (version !== refreshVersion) return;
    if (!state.enabled) { if (enabled) deactivate(); snapshot = ''; return; }
    const signature = JSON.stringify([location.href, state.prefs, state.translationSignature, state.entries.map(entry => [entry.id, entry.updatedAt])]);
    if (enabled && signature === snapshot) return;
    const routeChanged = lastDocumentURL && lastDocumentURL !== location.href;
    const activeTool = !routeChanged && panel?.classList.contains('selection-tool') ? lastSelection : null;
    if (routeChanged) { petVisible = false; petOpen = false; petPosition = {}; }
    if (reader.status().active && (routeChanged || readerRevision !== state.translationSignature)) { reader.restore(); if (!routeChanged) showToast('翻译设置已更改，已恢复原文；请重新翻译页面。'); }
    lastDocumentURL = location.href; modelConfigured = state.modelConfigured;
    readerRevision = state.translationSignature;
    const wasEnabled = enabled; enabled = true; prefs = state.prefs; entries = new Map(state.entries.map(entry => [entry.id, entry])); trie = Text.compile(state.entries.filter(entry => entry.text.length <= LONG_TEXT)); longEntries = new Map(state.entries.filter(entry => entry.text.length > LONG_TEXT).map(entry => [Text.normalize(entry.text), entry])); snapshot = signature;
    ensureUI(); reader.refreshAppearance(); renderReader(reader.status());
    if (reader.status().active) return;
    scanGeneration++; if (idleHandle) cancelIdle(idleHandle); idleHandle = null; scanRoots.clear();
    if (!wasEnabled) activate();
    if (activeTool) showTool(activeTool); else hidePanel();
    ensureUI();
    const cacheKey = JSON.stringify([location.href, readerRevision]);
    if (pageRestoreKey !== cacheKey) {
      pageRestoreKey = cacheKey;
      // An explicit word/paragraph selection takes precedence over automatic
      // page-cache restoration when its target language is changed in place.
      if (!activeTool) await reader.restoreCached();
      // Identical broadcasts may arrive while IndexedDB is loading. The newer
      // refresh returns early for the same snapshot, so this one must finish the
      // initial glossary scan. Only a genuinely changed snapshot supersedes it.
      if (!enabled || snapshot !== signature) return;
    }
    renderReader(reader.status());
    if (!reader.status().active && (entries.size || document.querySelector('[data-shiyi-mark],[data-shiyi-meaning],[data-shiyi-legacy]'))) queueScan(document.body);
  }
  globalThis.__shiyiContent = Object.freeze({ refresh });
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id) return false;
    if (message?.type === 'SHIYI/PING') { respond({ alive: true }); return false; }
    if (message?.type === 'SHIYI/PAGE_STATUS') { respond(reader.status()); return false; }
    if (message?.type === 'SHIYI/CONTEXT_TRANSLATE') { contextTranslate(message.text).then(respond, () => respond({ ok: false })); return true; }
    if (message?.type === 'SHIYI/NOTICE') { if (enabled) showToast(String(message.text || '操作未完成，请重试。').slice(0, 240)); respond({ received: true }); return false; }
    if (message?.type === 'SHIYI/PAGE_CONTROL') {
      refresh().then(async () => {
        if (!enabled) respond({ ok: false, error: { code: 'SITE_DISABLED', message: '当前网站已在黑名单中停用，或浏览器未允许网站访问。' } });
        else if (message.action === 'show-companion') { petVisible = true; petOpen = false; renderReader(reader.status()); respond({ ok: true, data: { visible: true } }); }
        else {
          if (message.showProgress) { petVisible = true; petOpen = false; renderReader(reader.status()); }
          respond({ ok: true, data: await reader.command(message.action, message.mode) });
        }
      }).catch(() => respond({ ok: false, error: { code: 'PAGE_CHANGED', message: '页面尚未就绪，请刷新后重试。' } }));
      return true;
    }
    if (message?.type === 'SHIYI/PAGE_CACHE_CLEARED') { reader.clearSaved(); respond({ received: true }); return false; }
    if (message?.type === 'SHIYI/CHANGED') { refresh().catch(() => {}); respond({ received: true }); return false; }
    return false;
  });
  refresh().catch(() => {});
})();
