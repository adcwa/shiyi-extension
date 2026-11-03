// Local-only inline structure. Models receive text/IDs, never this tree or URLs.
(() => {
  'use strict';
  if (globalThis.ShiyiInline) return;
  const tags = new Set('a abbr acronym b strong i em u s strike del ins small big sub sup span font code kbd samp var tt mark q cite dfn time bdi bdo ruby rt rp br wbr'.split(' '));
  const aliases = { bold: 'b', blod: 'b' };
  const omitted = 'script,style,noscript,template,input,textarea,select,option,button,pre,svg,canvas,video,audio,iframe,object,embed,[hidden],[aria-hidden="true"],[contenteditable]:not([contenteditable="false"]),[translate="no"],.notranslate,[data-shiyi-root],[data-shiyi-block-translation],[data-shiyi-meaning]';
  const textStyles = ['font-family', 'font-weight', 'font-style', 'font-variant', 'letter-spacing', 'text-decoration-line', 'vertical-align', 'white-space'];
  const linkState = source => JSON.stringify(['href', 'target', 'rel', 'download'].map(name => source.getAttribute(name)).concat(source.href || ''));
  function linkInfo(source) {
    const raw = source.getAttribute('href');
    if (raw === null) return { href: '', scripted: source.getAttribute('role') === 'link' || source.tabIndex >= 0 };
    try {
      const url = new URL(source.href, document.baseURI);
      return /^(https?:|mailto:|tel:)$/.test(url.protocol) ? { href: url.href, scripted: false } : { blocked: true };
    } catch { return { blocked: true }; }
  }
  function capture(owner, slots, whole = false) {
    const wanted = new Map(slots.map((slot, index) => [slot.node, index])), ancestors = new Set([owner]), tokens = [];
    let firstChild, lastChild;
    for (const { node } of slots) {
      let child = node, current = child.parentElement, depth = 0;
      while (current && current !== owner && depth++ < 256) { ancestors.add(current); child = current; current = current.parentElement; }
      if (current !== owner) return null;
      firstChild ||= child; lastChild = child;
    }
    if (!slots.length) return null;
    const range = document.createRange();
    range.setStartBefore(slots[0].node); range.setEndAfter(slots.at(-1).node);
    function walk(node, depth = 0) {
      if (node.nodeType === Node.TEXT_NODE) {
        const index = wanted.get(node);
        if (index === undefined) return null;
        tokens.push([node, 'text', index]); return { index };
      }
      if (node.nodeType !== Node.ELEMENT_NODE || node.matches(omitted) || depth > 256) return null;
      if (node.hasAttribute('data-shiyi-source-wrap')) {
        const children = [];
        for (const child of node.childNodes) { const item = walk(child, depth + 1); if (item) children.push(item); }
        return children.length ? { transparent: true, children } : null;
      }
      const isBreak = node.matches('br,wbr');
      if (isBreak) {
        if (!whole && !range.intersectsNode(node)) return null;
        tokens.push([node, node.localName, '']); return { source: node, tag: node.localName, children: [] };
      }
      if (!ancestors.has(node) && !node.querySelector('br,wbr')) return null;
      const tokenStart = tokens.length, name = aliases[node.localName] || node.localName;
      const tag = tags.has(name) && node.namespaceURI === 'http://www.w3.org/1999/xhtml' ? name : 'span';
      tokens.push([node, 'open', tag === 'a' ? linkState(node) : tag]);
      const children = [];
      for (const child of node.childNodes) { const item = walk(child, depth + 1); if (item) children.push(item); }
      if (!children.length) { tokens.length = tokenStart; return null; }
      tokens.push([node, 'close', tag]); return { source: node, tag, children };
    }
    tokens.push([owner, 'root', owner.localName === 'a' ? linkState(owner) : '']);
    const tree = [];
    // Partial owner groups must not scan an entire document for each fragment.
    // Complete groups also retain leading/trailing line breaks.
    let child = whole ? owner.firstChild : firstChild;
    for (; child; child = child.nextSibling) {
      const item = walk(child); if (item) tree.push(item);
      if (!whole && child === lastChild) break;
    }
    return { owner, slots, whole, tree, tokens };
  }
  function current(mapping) {
    if (!mapping?.owner.isConnected || mapping.slots.some(slot => !slot.node.isConnected)) return false;
    const next = capture(mapping.owner, mapping.slots, mapping.whole);
    return !!next && next.tokens.length === mapping.tokens.length && next.tokens.every((token, index) => token.every((value, part) => value === mapping.tokens[index][part]));
  }
  function value(slot, translated) {
    if (slot.locked) return slot.source;
    const text = slot.source.trim();
    // URLs used as link labels are identifiers, not prose to be translated.
    if (slot.node.parentElement?.closest('a') && /^(?:https?:\/\/|www\.)\S+$|^(?:[\w-]+\.)+[a-z]{2,}(?:[/?#]\S*)?$/i.test(text)) return slot.source;
    return translated;
  }
  function appearance(bindings) {
    for (const { source, node } of bindings) {
      if (!source.isConnected) continue;
      if (node.matches('br,wbr')) {
        let visible = true;
        for (let item = source; item; item = item.parentElement) {
          const style = getComputedStyle(item);
          if (style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) || style.contentVisibility === 'hidden') { visible = false; break; }
        }
        node.style.display = visible ? '' : 'none'; continue;
      }
      const style = getComputedStyle(source);
      for (const name of textStyles) node.style.setProperty(name, style.getPropertyValue(name));
      if (aliases[source.localName]) node.style.fontWeight = '700';
      const original = parseFloat(style.fontSize) || 16, size = Math.max(1, original - 2), line = parseFloat(style.lineHeight);
      node.style.setProperty('font-size', `${size}px`, 'important');
      node.style.setProperty('line-height', Number.isFinite(line) ? `${line * size / original}px` : 'normal');
      node.style.setProperty('color', 'inherit', 'important');
      // Restore typography without copying site layout, backgrounds or raw CSS.
      node.style.setProperty('background', 'transparent', 'important');
      if (node.localName === 'font') {
        for (const name of ['face', 'size', 'color']) {
          const text = source.getAttribute(name);
          if (text && text.length <= 200 && (name !== 'size' || /^[+-]?[1-7]$/.test(text))) node.setAttribute(name, text);
          else node.removeAttribute(name);
        }
      }
      const title = source.getAttribute('title');
      if (title && title.length <= 2000) node.title = title; else node.removeAttribute('title');
      const dir = source.getAttribute('dir');
      if (['ltr', 'rtl', 'auto'].includes(dir)) node.setAttribute('dir', dir); else node.removeAttribute('dir');
      if (node.localName === 'time') {
        const date = source.getAttribute('datetime');
        if (date && date.length <= 200) node.setAttribute('datetime', date);
      }
    }
  }
  function render(mapping, values, options = {}) {
    const fragment = document.createDocumentFragment(), bindings = [], edgeText = [];
    if (!mapping) {
      values.forEach((text, index) => { if (!options.skip?.(index)) fragment.append(document.createTextNode(options.slots?.[index] ? value(options.slots[index], text) : text)); });
      return { fragment, bindings };
    }
    let breaks;
    if (mapping.slots.some((slot, index) => options.skip?.(index))) {
      const meaningful = mapping.tokens.map((token, index) => token[1] === 'text' && !options.skip?.(token[2]) && value(mapping.slots[token[2]], values[token[2]] || '').trim() ? index : -1).filter(index => index >= 0);
      breaks = new Set(mapping.tokens.filter((token, index) => ['br', 'wbr'].includes(token[1]) && index > meaningful[0] && index < meaningful.at(-1)).map(token => token[0]));
    }
    function build(item, insideLink) {
      if (item.index !== undefined) {
        if (options.skip?.(item.index)) return null;
        const node = document.createTextNode(value(mapping.slots[item.index], values[item.index] ?? ''));
        edgeText.push({ node, locked: mapping.slots[item.index].locked }); return node;
      }
      if (item.transparent) {
        const output = document.createDocumentFragment();
        for (const child of item.children) { const node = build(child, insideLink); if (node) output.append(node); }
        return output;
      }
      let tag = item.tag, info;
      if (['br', 'wbr'].includes(tag) && breaks && !breaks.has(item.source)) return null;
      if (tag === 'a') {
        info = linkInfo(item.source);
        if (insideLink || info.blocked || !info.href && !info.scripted) tag = 'span';
      }
      const node = document.createElement(tag);
      node.dataset.shiyiInline = '';
      for (const child of item.children) { const built = build(child, insideLink || tag === 'a'); if (built) node.append(built); }
      if (!node.childNodes.length && !['br', 'wbr'].includes(tag)) return null;
      if (tag === 'a') {
        if (info.href) node.href = info.href;
        else { node.setAttribute('role', 'link'); node.tabIndex = 0; }
        const target = item.source.getAttribute('target');
        if (target && target.length <= 200) node.target = target;
        const rel = new Set((item.source.getAttribute('rel') || '').split(/\s+/).filter(word => /^(noopener|noreferrer|nofollow|ugc|sponsored|external|author|bookmark|tag|help|license|next|prev)$/.test(word)));
        if (target === '_blank') rel.add('noopener');
        if (rel.size) node.rel = [...rel].join(' ');
        if (item.source.hasAttribute('download')) node.setAttribute('download', item.source.getAttribute('download').slice(0, 300));
        function activate(event) {
          if (!event.isTrusted || event.defaultPrevented || event.button && event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault(); event.stopPropagation();
          if (!current(mapping)) { options.onStale?.(); return; }
          // A real original node preserves its page-side click/router handlers.
          // Modified/middle clicks and context menus use the copied native href.
          item.source.click();
        }
        node.addEventListener('click', activate);
        if (!info.href) node.addEventListener('keydown', event => { if (event.key === 'Enter') activate(event); });
      }
      bindings.push({ source: item.source, node });
      return node;
    }
    const inside = !!mapping.owner.closest('a');
    for (const item of mapping.tree) { const node = build(item, inside); if (node) fragment.append(node); }
    // HTML indentation outside inline tags must not become blank translated
    // lines. Protected code whitespace, interior spaces and real breaks remain.
    for (const { node, locked } of edgeText) { if (locked) break; node.data = node.data.trimStart(); if (node.data) break; }
    for (const { node, locked } of [...edgeText].reverse()) { if (locked) break; node.data = node.data.trimEnd(); if (node.data) break; }
    appearance(bindings); return { fragment, bindings };
  }
  globalThis.ShiyiInline = Object.freeze({ capture, current, render, appearance, value });
})();
