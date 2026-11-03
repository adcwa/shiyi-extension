(() => {
  'use strict';
  if (globalThis.ShiyiReader) return;
  const Text = globalThis.ShiyiBlockText;
  const PageMap = globalThis.ShiyiPageMap;
  const Inline = globalThis.ShiyiInline;
  const excluded = 'script,style,noscript,input,textarea,select,option,pre,svg,canvas,video,audio,iframe,[contenteditable]:not([contenteditable="false"]),[hidden],[aria-hidden="true"],[translate="no"],.notranslate,[data-shiyi-root],[data-shiyi-meaning],[data-shiyi-block-translation]';
  const semantic = 'p,li,h1,h2,h3,h4,h5,h6,blockquote,figcaption,td,th,dt,dd,button,label,summary,legend';
  const own = '[data-shiyi-root],[data-shiyi-block-translation]';
  let serial = 0;
  const nativeSlot = (slot, language) => !slot.locked && globalThis.ShiyiText.isTargetLanguage(slot.source, language, slot.node.parentElement?.closest('[lang]')?.getAttribute('lang'));
  function nativeRecord(record, language) {
    const slots = record.slots.filter(slot => !slot.locked && /[\p{L}]/u.test(slot.source));
    return slots.length > 0 && slots.every(slot => nativeSlot(slot, language));
  }
  function ownerOf(node) {
    let parent = node.parentElement;
    while (parent?.hasAttribute('data-shiyi-source-wrap')) parent = parent.parentElement;
    if (!parent) return null;
    // Inline links remain part of their paragraph. Standalone navigation links
    // and controls form their own units, rather than one flattened navigation bar.
    const container = parent.closest(semantic), link = parent.closest('a');
    if (link && (!container || link.contains(container))) return link;
    if (container) return container;
    for (let item = parent; item && item !== document.documentElement; item = item.parentElement) {
      if (!['inline', 'contents'].includes(getComputedStyle(item).display)) return item;
    }
    return parent;
  }
  function visible(node, cache) {
    const parent = node.parentElement;
    if (!parent || parent.closest(excluded) || !node.data) return false;
    for (let item = parent; item; item = item.parentElement) {
      if (cache.has(item)) return cache.get(item);
      const style = getComputedStyle(item);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.contentVisibility === 'hidden') { cache.set(item, false); return false; }
    }
    cache.set(parent, true); return true;
  }
  function selectedOwners(range) {
    const owners = new Set(), root = range.commonAncestorContainer;
    if (root.nodeType === Node.TEXT_NODE) { const owner = ownerOf(root); if (owner) owners.add(owner); return owners; }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) if (node.data.trim() && !node.parentElement?.closest(excluded) && range.intersectsNode(node)) owners.add(ownerOf(node));
    return owners;
  }
  function coversOwner(owner, slots) {
    const nodes = new Set(slots.map(slot => slot.node)), walker = document.createTreeWalker(owner, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) if (node.data.trim() && !node.parentElement.closest(excluded) && !nodes.has(node)) return false;
    return true;
  }
  function translationTheme(element, owner, appearance = {}) {
    const layers = [];
    for (let node = owner; node; node = node.parentElement) {
      const rgba = getComputedStyle(node).backgroundColor.match(/[\d.]+/g)?.map(Number);
      if (rgba?.length >= 3) { layers.push(rgba); if ((rgba[3] ?? 1) >= 1) break; }
    }
    let color = [255, 255, 255];
    for (const rgba of layers.reverse()) { const alpha = rgba[3] ?? 1; color = color.map((channel, index) => rgba[index] * alpha + channel * (1 - alpha)); }
    element.dataset.shiyiTone = color[0] * .2126 + color[1] * .7152 + color[2] * .0722 < 140 ? 'dark' : 'light';
    const ink = element.dataset.shiyiTone === 'dark' ? appearance.translationColorDark : appearance.translationColorLight;
    if (typeof ink === 'string' && /^#[a-f\d]{6}$/i.test(ink)) element.style.setProperty('--shiyi-translation-ink', ink);
    else element.style.removeProperty('--shiyi-translation-ink');
  }
  function translationElement(owner, text, language, appearance, style) {
    const element = document.createElement('span');
    element.dataset.shiyiBlockTranslation = `block-${++serial}`;
    element.lang = language; element.setAttribute('aria-label', '译文');
    element.textContent = text; translationTheme(element, owner, appearance);
    translationType(element, style); return element;
  }
  function insertion(record, text, language, appearance, rich) {
    const owner = record.owner, whole = record.whole ?? coversOwner(owner, record.slots);
    const style = getComputedStyle(whole ? owner : record.slots[0]?.node.parentElement || owner);
    const element = translationElement(owner, text, language, appearance, style);
    if (rich) element.replaceChildren(rich.fragment);
    const parentLayout = owner.parentElement ? getComputedStyle(owner.parentElement).display : '';
    const beside = whole && !owner.matches('li,td,th,dt,dd,button,a,label,summary,legend,body') && !/flex|grid|table/.test(parentLayout) && !['inline', 'contents'].includes(style.display);
    if (beside) owner.after(element);
    else {
      const last = record.slots.at(-1)?.node;
      if (whole) owner.append(element);
      else if (last?.isConnected) last.after(element);
      else owner.append(element);
    }
    return element;
  }
  function translationType(element, style) {
    for (const name of ['font-family', 'font-weight', 'letter-spacing', 'text-align']) element.style.setProperty(name, style.getPropertyValue(name));
    const sourceSize = parseFloat(style.fontSize) || 16, size = Math.max(1, sourceSize - 2), line = parseFloat(style.lineHeight);
    element.style.setProperty('font-size', `${size}px`, 'important');
    element.style.setProperty('line-height', Number.isFinite(line) ? `${line * size / sourceSize}px` : 'normal');
  }
  function compactControl(record) {
    if (record.slots.reduce((size, slot) => size + slot.source.length, 0) > 160) return false;
    return record.owner.matches('a,button,label,summary,legend,td,th,[role="button"],[role="link"],[role="menuitem"],[role="tab"]') || !!record.owner.closest('nav,[role="navigation"],[role="menu"],[role="menubar"],[role="tablist"]');
  }
  function compactPlacement(element) {
    element.dataset.shiyiLayout = 'compact';
    const target = element.parentElement;
    // A site's nowrap/ellipsis label cannot naturally wrap between the source
    // and translation. Give only our text a second line, not a new grid item.
    if (['nowrap', 'pre'].includes(getComputedStyle(target).whiteSpace) && target.clientWidth > 0 && target.scrollWidth > target.clientWidth + 1) element.dataset.shiyiLayout = 'compact-stack';
  }
  function insertCompact(record, language, appearance) {
    const groups = new Map(), elements = [], wraps = [];
    record.slots.forEach((slot, index) => {
      // A badge/counter already has its own live source node. Repeating its
      // translated value in a label both duplicates it and changes the grid.
      if (slot.locked || !/[\p{L}]/u.test(slot.source) || nativeSlot(slot, language)) return;
      let target = slot.node.parentElement;
      while (target !== record.owner && target.parentElement !== record.owner && ['inline', 'contents'].includes(getComputedStyle(target).display)) target = target.parentElement;
      const anonymousItem = /flex|grid/.test(getComputedStyle(target).display), key = anonymousItem ? slot.node : target;
      if (!groups.has(key)) groups.set(key, { target, anonymousItem, slots: [], values: [] });
      groups.get(key).slots.push(slot); groups.get(key).values.push(Inline.value(slot, record.values[index]));
    });
    const bindings = [];
    for (const group of groups.values()) {
      const text = group.values.join('').trim(), source = group.slots.map(slot => slot.source).join('').trim();
      if (!text || text === source) continue;
      let target = group.target;
      if (group.anonymousItem) {
        // Reify only the anonymous text item. The icon and badge remain in
        // their existing flex/grid slots, and original nodes retain identity.
        target = document.createElement('span'); target.dataset.shiyiSourceWrap = '';
        const node = group.slots[0].node; node.before(target); target.append(node); wraps.push(target);
      }
      const element = translationElement(target, text, language, appearance, getComputedStyle(target));
      const mapping = Inline.capture(group.target, group.slots);
      const rich = Inline.render(mapping, group.values);
      if (mapping) { element.replaceChildren(rich.fragment); bindings.push(...rich.bindings); }
      target.append(element); compactPlacement(element); elements.push(element);
    }
    return { elements, wraps, inlineBindings: bindings };
  }
  function create(bridge) {
    let active = false, mode = 'bilingual', phase = 'idle', records = [], generation = 0, selected = null, pageUrl = '', newContent = false, lastError = '', lastCode = '';
    let collecting = false, running = false, paused = false, allowance = 400, charAllowance = 120000, observer, routeTimer, themeObserver;
    let pageHandle = null, writerReady = false, freshRead = false, cachedCount = 0, restoredCount = 0, cacheError = '', localLoading = false, lookupRevision = 0;
    const themeMedia = matchMedia('(prefers-color-scheme: dark)');
    const requests = new Set(), originals = new WeakMap();
    const valid = record => record.owner.isConnected && record.slots.every(slot => slot.node.isConnected && slot.node.data === (slot.applied ?? slot.source)) && (!record.inline || Inline.current(record.inline));
    function status() {
      const completed = records.filter(record => record.status === 'done').length, failed = records.filter(record => record.status === 'error').length, waiting = records.filter(record => ['queued', 'pending'].includes(record.status)).length;
      return { active, mode, scope: selected ? 'selection' : 'page', phase, total: records.length, completed, failed, waiting, newContent, error: lastError, errorCode: lastCode, cached: cachedCount, restored: restoredCount, cacheError, localLoading, limited: waiting > 0 && !running && !paused && !collecting, running: running || collecting };
    }
    function emit() { bridge.onState(status()); }
    function observe() { if (active && document.body) observer?.observe(document.body, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['href', 'target', 'rel', 'download', 'face', 'size', 'color', 'title', 'dir'] }); }
    function write(work) {
      observer?.disconnect();
      try { return bridge.mutate(work); } finally { observe(); }
    }
    function restoreRecord(record) {
      for (const element of record.elements || [record.element]) element?.remove();
      for (const wrap of record.wraps || []) if (wrap.parentNode) wrap.replaceWith(...wrap.childNodes);
      record.element = null; record.elements = []; record.wraps = []; record.inlineBindings = []; record.painted = false;
      for (const slot of record.slots) {
        if (slot.applied !== undefined && slot.node.isConnected && slot.node.data === slot.applied) slot.node.data = slot.source;
        slot.applied = undefined;
      }
    }
    function anchor() {
      const record = records.find(item => { const rect = item.owner.getBoundingClientRect(); return rect.top >= 0 && rect.top < innerHeight && rect.bottom > 0; });
      return record ? { element: record.owner, top: record.owner.getBoundingClientRect().top } : null;
    }
    function anchored(work) {
      const point = anchor(); write(work);
      if (point?.element.isConnected) {
        const delta = point.element.getBoundingClientRect().top - point.top;
        if (Math.abs(delta) > 1) window.scrollBy({ top: delta, behavior: 'instant' });
      }
    }
    function render(record) {
      if (!valid(record)) { restoreRecord(record); record.status = 'stale'; newContent = true; return; }
      restoreRecord(record);
      if (record.status !== 'done') return;
      const source = record.slots.filter(slot => !slot.locked).map(slot => slot.source).join('');
      if (nativeRecord(record, bridge.prefs().targetLanguage) || globalThis.ShiyiText.normalize(source) === globalThis.ShiyiText.normalize(record.translation)) { record.painted = true; return; }
      record.compact = compactControl(record);
      if (mode === 'bilingual') {
        if (record.compact) Object.assign(record, insertCompact(record, bridge.prefs().targetLanguage, bridge.prefs()));
        else {
          const rich = Inline.render(record.inline, record.values, { slots: record.slots, skip: index => nativeSlot(record.slots[index], bridge.prefs().targetLanguage), onStale: () => {
            write(() => restoreRecord(record)); record.status = 'stale'; newContent = true; emit(); bridge.notice('原链接已变化，请翻译新增内容后再打开。');
          } });
          const text = rich.fragment.textContent.trim();
          record.elements = text ? [insertion(record, text, bridge.prefs().targetLanguage, bridge.prefs(), rich)] : [];
          record.inlineBindings = rich.bindings;
        }
        record.element = record.elements[0] || null;
      }
      else record.slots.forEach((slot, index) => {
        if (!slot.locked && !nativeSlot(slot, bridge.prefs().targetLanguage) && (!record.compact || /[\p{L}]/u.test(slot.source))) { slot.applied = Inline.value(slot, record.values[index]); slot.node.data = slot.applied; }
      });
      record.painted = true;
    }
    async function collect(token) {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT), visibility = new WeakMap(), groups = [];
      let node, group, count = 0;
      while ((node = walker.nextNode())) {
        if (!active || token !== generation) return [];
        if (++count % 250 === 0) await new Promise(resolve => setTimeout(resolve, 0));
        if (!visible(node, visibility)) { group = null; continue; }
        const owner = ownerOf(node);
        if (!owner || selected && !selected.has(owner)) { group = null; continue; }
        if (!group || group.owner !== owner) { group = { id: `r${(++serial).toString(36)}`, owner, slots: [], status: 'queued', outputs: [], element: null }; groups.push(group); }
        const previous = originals.get(node), source = previous?.applied !== undefined && node.data === previous.applied ? previous.source : node.data;
        const slot = { node, source, locked: !!node.parentElement.closest('code,kbd,samp,var,tt,math'), applied: previous?.applied };
        group.slots.push(slot);
      }
      const usable = groups.filter(item => {
        const source = item.slots.filter(slot => !slot.locked).map(slot => slot.source).join('');
        return /[\p{L}]/u.test(source) && !nativeRecord(item, bridge.prefs().targetLanguage);
      });
      const counts = new Map(); for (const item of usable) counts.set(item.owner, (counts.get(item.owner) || 0) + 1);
      for (const item of usable) {
        item.whole = counts.get(item.owner) === 1 && coversOwner(item.owner, item.slots);
        item.inline = Inline.capture(item.owner, item.slots, item.whole);
        item.parts = item.slots.map((slot, index) => ({ text: slot.locked ? `⟦SHIYI_${index}⟧` : slot.source }));
        item.chunks = Text.chunks(item.parts); item.characters = item.slots.reduce((sum, slot) => sum + (slot.locked ? 0 : slot.source.length), 0);
        item.mapping = PageMap.describe(item);
      }
      return usable;
    }
    function preserveSpace(source, text) {
      if (!source.trim()) return source;
      return (source.match(/^\s*/)?.[0] || '') + text.trim() + (source.match(/\s*$/)?.[0] || '');
    }
    const current = token => active && token === generation && pageUrl === location.href;
    function cacheInfo() { return { mode, scope: selected ? 'selection' : 'page', selectionPaths: selected ? [...selected].filter(owner => owner.isConnected).map(owner => PageMap.path(owner)) : [], fresh: freshRead, title: document.title.slice(0, 240) }; }
    async function checkpoint(batch, token) {
      if (!current(token) || !pageHandle) return;
      const handle = pageHandle, info = cacheInfo(), blocks = batch.filter(valid).map(PageMap.snapshot).filter(Boolean);
      try {
        const result = await bridge.send('PAGE_CACHE_SAVE', { url: pageUrl, id: handle.id, revision: handle.revision, info, blocks });
        if (!current(token) || pageHandle !== handle) return;
        if (result.saved) { cachedCount = result.blocks; cacheError = ''; }
        else { writerReady = false; cacheError = '本页暂存已更新，当前译文可继续阅读。'; }
      } catch (error) { if (current(token)) cacheError = error.code === 'CANCELLED' ? '' : '本次译文未能暂存，刷新后可重新翻译。'; }
    }
    async function translateRecord(record, token) {
      record.status = 'pending'; emit();
      try {
        for (let index = 0; index < record.chunks.length; index++) {
          if (!active || token !== generation || paused) return;
          if (!valid(record)) { record.status = 'stale'; newContent = true; return; }
          if (record.outputs[index]) continue;
          const parts = record.chunks[index].map(({ id, text }) => ({ id, text }));
          if (!/[\p{L}]/u.test(parts.map(part => part.text.replace(/⟦SHIYI_\d+⟧/g, '')).join(''))) { record.outputs[index] = { parts, translation: parts.map(part => part.text).join('') }; continue; }
          const requestId = crypto.randomUUID(); requests.add(requestId);
          try { record.outputs[index] = await bridge.send('TRANSLATE_BLOCK', { requestId, parts, fresh: freshRead }); }
          finally { requests.delete(requestId); }
          if (!active || token !== generation || paused) return;
          // An independent background event handles each bounded chunk, allowing
          // MV3's worker to suspend between requests without losing page state.
          const output = record.outputs[index];
          output.parts = output.parts.map(part => ({ ...part, text: preserveSpace(parts.find(item => item.id === part.id).text, part.text) }));
        }
        if (!active || token !== generation || paused) return;
        if (!valid(record)) { record.status = 'stale'; newContent = true; return; }
        record.values = Text.assemble(record.parts, record.chunks, record.outputs);
        const locked = record.slots.some(slot => slot.locked);
        record.translation = locked ? record.values.map((text, index) => record.slots[index].locked ? record.slots[index].source : text).join('') : record.outputs.map(output => output.translation).join('\n');
        record.status = 'done'; await checkpoint([record], token);
        if (current(token) && !paused) anchored(() => render(record));
      } catch (error) {
        if (!active || token !== generation) return;
        record.status = paused || error.code === 'CANCELLED' ? 'queued' : 'error';
        if (error.code !== 'CANCELLED') { lastError = error.message; lastCode = error.code || ''; }
        if (['MODEL_NOT_CONFIGURED', 'MISSING_KEY', 'MODEL_PERMISSION', 'HTTP_401', 'HTTP_403', 'HTTP_429', 'SITE_DISABLED', 'DISCONNECTED'].includes(error.code)) { paused = true; cancelRequests(); }
      } finally { if (active && token === generation) emit(); }
    }
    async function translateRecords(batch, token) {
      batch.forEach(record => { record.status = 'pending'; }); emit();
      const requestId = crypto.randomUUID(); requests.add(requestId);
      try {
        const { results } = await bridge.send('TRANSLATE_BLOCKS', { requestId, fresh: freshRead, blocks: batch.map(record => ({ id: record.id, parts: record.chunks[0].map(({ id, text }) => ({ id, text })) })) });
        if (!active || token !== generation || paused) return;
        const outputs = new Map(results.map(result => [result.id, result]));
        const ready = [];
        batch.forEach(record => {
          if (!valid(record)) { record.status = 'stale'; newContent = true; return; }
          const result = outputs.get(record.id);
          if (!result?.output) {
            record.status = 'error'; record.singleOnly = true;
            lastError = result?.error?.message || '这个段落没有返回译文；重试时将逐段翻译。'; lastCode = result?.error?.code || 'BLOCK_ALIGNMENT'; return;
          }
          const source = new Map(record.chunks[0].map(part => [part.id, part.text]));
          record.outputs[0] = { ...result.output, parts: result.output.parts.map(part => ({ ...part, text: preserveSpace(source.get(part.id), part.text) })) };
          record.values = Text.assemble(record.parts, record.chunks, record.outputs);
          record.translation = record.slots.some(slot => slot.locked) ? record.values.map((text, part) => record.slots[part].locked ? record.slots[part].source : text).join('') : record.outputs[0].translation;
          record.status = 'done'; ready.push(record);
        });
        if (ready.length) { await checkpoint(ready, token); if (current(token) && !paused) anchored(() => ready.forEach(render)); }
      } catch (error) {
        if (!active || token !== generation) return;
        batch.forEach(record => {
          record.status = paused || error.code === 'CANCELLED' ? 'queued' : 'error';
          if (['BLOCK_BATCH_FORMAT', 'BLOCK_ALIGNMENT', 'INVALID_RESULT', 'EMPTY_RESULT', 'RESULT_TOO_LARGE', 'TIMEOUT'].includes(error.code)) record.singleOnly = true;
        });
        if (error.code !== 'CANCELLED') { lastError = error.message; lastCode = error.code || ''; }
        if (['MODEL_NOT_CONFIGURED', 'MISSING_KEY', 'MODEL_PERMISSION', 'HTTP_401', 'HTTP_403', 'HTTP_429', 'SITE_DISABLED', 'DISCONNECTED'].includes(error.code)) { paused = true; cancelRequests(); }
      } finally { requests.delete(requestId); if (active && token === generation) emit(); }
    }
    function cancelRequests() { for (const requestId of requests) bridge.send('CANCEL', { requestId }).catch(() => {}); requests.clear(); }
    async function run(retry = false, more = false) {
      if (!active || running || collecting) return;
      if (more) { allowance += 400; charAllowance += 120000; }
      if (retry) records.forEach(record => { if (record.status === 'error') record.status = 'queued'; });
      paused = false; running = true; phase = 'translating'; lastError = ''; lastCode = ''; const token = generation;
      if (!writerReady) {
        try { const page = await bridge.send('PAGE_CACHE_OPEN', { url: pageUrl, info: cacheInfo(), signature: bridge.signature() }); if (!current(token)) return; pageHandle = page; writerReady = true; }
        catch { cacheError = '本次译文暂存不可用。'; }
      }
      if (!current(token)) return;
      const unpainted = records.filter(record => record.status === 'done' && !record.painted);
      if (unpainted.length) anchored(() => unpainted.forEach(render));
      function prioritize(queue) {
        const priority = new Map(queue.map((record, index) => {
          const rect = record.owner.getBoundingClientRect(), visible = rect.bottom > 0 && rect.top < innerHeight;
          const chrome = !!record.owner.closest('nav,header,footer,aside');
          return [record, [visible ? 0 : 1, visible && chrome ? 1 : 0, visible ? Math.max(0, rect.top) : Math.min(Math.abs(rect.top), Math.abs(rect.top - innerHeight)), index]];
        }));
        queue.sort((a, b) => { const x = priority.get(a), y = priority.get(b); for (let index = 0; index < x.length; index++) if (x[index] !== y[index]) return x[index] - y[index]; return 0; });
      }
      const counted = records.filter(record => ['done', 'error'].includes(record.status));
      const candidates = records.filter(record => ['queued', 'pending'].includes(record.status));
      // Choose the initial budget around the current viewport, even on a feed
      // longer than 400 blocks. Continue still controls any additional budget.
      prioritize(candidates);
      const queue = []; let chars = counted.reduce((sum, record) => sum + record.characters, 0), budget = allowance - counted.length;
      for (const record of candidates) {
        if (budget-- <= 0 || chars >= charAllowance) break;
        chars += record.characters; queue.push(record);
      }
      let firstBatch = true;
      function nextBatch() {
        // Re-evaluate scrolling between bounded batches. A single first block
        // avoids delaying the first useful text behind a larger response.
        prioritize(queue);
        const batch = Text.takeBatch(queue, firstBatch ? 1 : bridge.prefs().batchSize); firstBatch = false; return batch;
      }
      async function worker() {
        while (queue.length && active && token === generation && !paused) {
          const batch = nextBatch();
          if (batch.length === 1) await translateRecord(batch[0], token);
          else await translateRecords(batch, token);
        }
      }
      await Promise.allSettled([worker(), worker()]);
      if (!active || token !== generation) return;
      running = false; records.forEach(record => { if (record.status === 'pending') record.status = 'queued'; });
      phase = paused ? 'paused' : 'complete';
      if (!paused && !newContent && records.every(record => record.status === 'done')) { freshRead = false; await checkpoint([], token); }
      emit();
    }
    function updateTheme() { if (active) anchored(() => records.forEach(record => { for (const element of record.elements || []) { const source = record.compact ? element.parentElement : record.whole ? record.owner : record.slots[0]?.node.parentElement || record.owner; translationTheme(element, source, bridge.prefs()); translationType(element, getComputedStyle(source)); if (record.compact) compactPlacement(element); } Inline.appearance(record.inlineBindings || []); })); }
    function monitor() {
      themeMedia.addEventListener('change', updateTheme);
      window.addEventListener('resize', updateTheme);
      themeObserver = new MutationObserver(updateTheme);
      for (const element of [document.documentElement, document.body]) if (element) themeObserver.observe(element, { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-color-mode'] });
      observer = new MutationObserver(changes => {
        const external = changes.some(change => {
          if (change.target.parentElement?.closest(own) || change.target.closest?.(own)) return false;
          if (change.type === 'attributes') return ['href', 'target', 'rel', 'download'].includes(change.attributeName);
          if (change.type === 'characterData') return true;
          return [...change.addedNodes, ...change.removedNodes].some(node => node.nodeType !== Node.COMMENT_NODE && !(node.nodeType === Node.ELEMENT_NODE && node.matches(own)));
        });
        if (!external) { if (changes.some(change => change.type === 'attributes' && !change.target.closest?.(own))) updateTheme(); return; }
        newContent = true;
        write(() => { for (const record of records) if (!valid(record)) { restoreRecord(record); record.status = 'stale'; } });
        emit();
      });
      observe();
      routeTimer = setInterval(() => { if (active && location.href !== pageUrl) { restore(); bridge.notice('页面已切换，已恢复原文；可以重新翻译当前页面。'); } }, 750);
    }
    function restore() {
      lookupRevision++; localLoading = false;
      generation++; active = false; running = false; collecting = false; paused = false; phase = 'idle';
      observer?.disconnect(); themeObserver?.disconnect(); themeMedia.removeEventListener('change', updateTheme); window.removeEventListener('resize', updateTheme); clearInterval(routeTimer); cancelRequests();
      bridge.mutate(() => records.forEach(restoreRecord)); records = []; selected = null; lastError = ''; lastCode = ''; newContent = false;
      pageHandle = null; writerReady = false; freshRead = false; restoredCount = 0; cacheError = '';
      emit(); bridge.onExit(); return status();
    }
    function start(options = {}) {
      if (active) restore();
      lookupRevision++; localLoading = false;
      bridge.onEnter(); active = true; mode = options.mode === 'translation' ? 'translation' : 'bilingual'; selected = options.owners || null;
      phase = 'collecting'; collecting = true; pageUrl = location.href; allowance = 400; charAllowance = 120000;
      freshRead = options.fresh === true; restoredCount = 0; cacheError = '';
      const token = ++generation; monitor(); emit();
      collect(token).then(async items => {
        if (!current(token)) return;
        records = items; records.forEach(record => record.slots.forEach(slot => originals.set(slot.node, slot)));
        let saved = options.snapshot;
        if (!saved) {
          try { saved = await bridge.send('PAGE_CACHE_OPEN', { url: pageUrl, info: cacheInfo(), signature: bridge.signature(), fresh: options.fresh === true }); writerReady = true; }
          catch { cacheError = '本次译文暂存不可用。'; }
        }
        if (!current(token)) return;
        pageHandle = saved || null; freshRead = options.fresh === true || saved?.fresh === true;
        cachedCount = saved?.blocks?.length || 0;
        if (saved && !options.fresh) {
          const paths = new Set(saved.selectionPaths);
          const selectedOnly = options.localOnly && saved.scope === 'selection';
          // A page may retain older full-page blocks alongside a newer
          // selection. Only selected owners may participate in local restore.
          const matched = PageMap.match(records, selectedOnly ? saved.blocks.filter(block => paths.has(block.locator)) : saved.blocks);
          if (selectedOnly) {
            records = records.filter(record => paths.has(record.mapping.locator) || matched.has(record)); selected = new Set(records.map(record => record.owner));
          }
          const ready = [];
          for (const record of records) {
            const block = matched.get(record); if (!block || !valid(record)) continue;
            record.values = [...block.values]; record.translation = record.slots.some(slot => slot.locked) ? record.values.map((text, i) => record.slots[i].locked ? record.slots[i].source : text).join('') : block.translation || block.values.join('');
            record.status = 'done'; restoredCount++; ready.push(record);
          }
          if (ready.length) anchored(() => ready.forEach(render));
        }
        collecting = false;
        if (options.localOnly) {
          phase = 'complete'; writerReady = false; newContent = records.some(record => record.status !== 'done');
          if (!restoredCount) { restore(); cachedCount = saved?.blocks?.length || 0; bridge.notice('本页内容已变化，可点击小猫重新翻译。'); }
          emit();
        } else { phase = records.length ? 'translating' : 'complete'; emit(); run(); }
      }).catch(() => { if (active && token === generation) { collecting = false; phase = 'paused'; lastError = '无法读取页面内容，请恢复原文后重试。'; emit(); } });
      return status();
    }
    async function refresh() {
      if (!active || running || collecting) return status();
      collecting = true; phase = 'collecting'; const token = generation; emit();
      try {
        const items = await collect(token);
        if (!active || token !== generation) return status();
        const previous = new Map(records.filter(valid).map(record => [record.slots[0]?.node, record]));
        const retained = new Set();
        records = items.map(item => {
          const old = previous.get(item.slots[0]?.node);
          if (old && old.slots.length === item.slots.length && old.slots.every((slot, index) => slot.node === item.slots[index].node && slot.source === item.slots[index].source)) { retained.add(old); return old; }
          item.slots.forEach(slot => { slot.applied = undefined; originals.set(slot.node, slot); }); return item;
        });
        write(() => { for (const old of previous.values()) if (!retained.has(old)) restoreRecord(old); });
        records.forEach(record => record.slots.forEach(slot => originals.set(slot.node, slot)));
        newContent = false; allowance += 400; charAllowance += 120000;
      } finally { if (active && token === generation) { collecting = false; run(true); } }
      return status();
    }
    function setMode(value) {
      if (!['bilingual', 'translation'].includes(value)) return status();
      mode = value; if (active) anchored(() => records.forEach(render));
      if (pageHandle) bridge.send('PAGE_CACHE_STATE', { url: pageUrl, id: pageHandle.id, revision: pageHandle.revision, mode, enabled: true }).catch(() => {});
      emit(); return status();
    }
    function stop() { if (collecting) return restore(); if (active && running) { paused = true; cancelRequests(); phase = 'paused'; emit(); } return status(); }
    function command(action, value) {
      if (action === 'translate') return active ? (setMode(value || mode), run(true, true), status()) : start({ mode: value });
      if (action === 'retranslate') return start({ mode: value || mode, fresh: true });
      if (action === 'load-local') return restoreCached(true);
      if (action === 'mode') return setMode(value);
      if (action === 'restore') {
        const handle = pageHandle, previousMode = mode, result = restore();
        return handle ? bridge.send('PAGE_CACHE_STATE', { url: pageUrl, id: handle.id, revision: handle.revision, mode: previousMode, enabled: false }).then(() => result).catch(() => result) : result;
      }
      if (action === 'stop') return stop();
      if (action === 'refresh') { refresh().catch(error => { lastError = error.message; emit(); }); return status(); }
      if (['resume', 'retry'].includes(action)) { run(true, true); return status(); }
      return status();
    }
    async function restoreCached(manual = false) {
      if (active) return status();
      const url = location.href, signature = bridge.signature(), lookup = ++lookupRevision; localLoading = true; emit();
      try {
        const { page } = await bridge.send('PAGE_CACHE_LOAD', { url });
        if (active || url !== location.href || lookup !== lookupRevision || signature !== bridge.signature()) return status();
        cachedCount = page?.blocks?.length || 0;
        if (page && cachedCount && (manual || page.enabled)) {
          writerReady = false;
          if (manual) await bridge.send('PAGE_CACHE_STATE', { url, id: page.id, revision: page.revision, mode: page.mode, enabled: true });
          if (active || url !== location.href || lookup !== lookupRevision || signature !== bridge.signature()) return status();
          start({ mode: page.mode, snapshot: page, localOnly: true });
        }
      } catch { if (lookup === lookupRevision) cachedCount = 0; }
      finally { if (lookup === lookupRevision) { localLoading = false; emit(); } }
      return status();
    }
    function clearSaved() { cachedCount = 0; restoredCount = 0; pageHandle = null; writerReady = false; emit(); }
    return Object.freeze({ status, start, restore, stop, command, selectedOwners, refreshAppearance: updateTheme, restoreCached, clearSaved });
  }
  globalThis.ShiyiReader = Object.freeze({ create, ownerOf, selectedOwners, insertion, translationTheme });
})();
