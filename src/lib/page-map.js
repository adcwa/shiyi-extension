(() => {
  'use strict';
  if (globalThis.ShiyiPageMap) return;
  function fingerprint(text) {
    let a = 2166136261, b = 2246822507;
    for (let i = 0; i < text.length; i++) { const value = text.charCodeAt(i); a = Math.imul(a ^ value, 16777619); b = Math.imul(b ^ value, 3266489909); }
    return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
  }
  function path(element, stop) {
    const parts = [];
    for (let node = element; node && node !== stop && node.nodeType === 1; node = node.parentElement) {
      if (node.hasAttribute('data-shiyi-source-wrap')) continue;
      if (!stop && node.id && document.getElementById(node.id) === node && document.querySelectorAll(`#${CSS.escape(node.id)}`).length === 1) { parts.unshift(`#${encodeURIComponent(node.id)}`); break; }
      let index = 1; for (let sibling = node.previousElementSibling; sibling; sibling = sibling.previousElementSibling) if (sibling.tagName === node.tagName && !sibling.matches('[data-shiyi-root],[data-shiyi-block-translation],[data-shiyi-meaning],[data-shiyi-source-wrap]')) index++;
      parts.unshift(`${node.localName}:${index}`);
    }
    const value = parts.join('/'); return value.length <= 4096 ? value : `path:${fingerprint(value)}`;
  }
  const key = (locator, signature) => fingerprint(`${locator}\u001f${signature}`);
  function describe(record) {
    const owner = record.owner, locator = path(owner), role = owner.getAttribute('role') || '';
    const slots = record.slots.map((slot, index) => {
      let parent = slot.node.parentElement || owner;
      while (parent.hasAttribute('data-shiyi-source-wrap')) parent = parent.parentElement || owner;
      const link = parent.closest('a');
      return [path(parent, owner), link ? fingerprint(link.href) : '', slot.locked ? `⟦SHIYI_${index}⟧` : slot.source, !!slot.locked];
    });
    const signature = JSON.stringify([owner.localName, role, slots]);
    return { key: key(locator, signature), locator, signature };
  }
  function valid(block) {
    if (!block || typeof block.locator !== 'string' || block.locator.length > 4096 || typeof block.signature !== 'string' || block.signature.length > 600000 || block.key !== key(block.locator, block.signature) || typeof block.translation !== 'string' || block.translation.length > 600000 || !Array.isArray(block.values) || block.values.length > 2000) return false;
    let shape; try { shape = JSON.parse(block.signature); } catch { return false; }
    const slots = shape?.[2];
    return Array.isArray(slots) && slots.length > 0 && slots.length === block.values.length && slots.every((slot, i) => Array.isArray(slot) && slot.length === 4 && typeof slot[0] === 'string' && typeof slot[1] === 'string' && typeof slot[2] === 'string' && typeof slot[3] === 'boolean' && typeof block.values[i] === 'string' && block.values[i].length <= 200000 && (slot[3] || !slot[2].trim() || !!block.values[i].trim()));
  }
  function snapshot(record) {
    const mapping = record.mapping || describe(record), locked = record.slots.some(slot => slot.locked);
    const value = { ...mapping, values: record.values.map((text, i) => record.slots[i].locked ? `⟦SHIYI_${i}⟧` : text), translation: locked ? '' : record.translation };
    return valid(value) ? value : null;
  }
  function match(records, blocks) {
    const usable = blocks.filter(valid), byKey = new Map(usable.map(block => [block.key, block])), bySignature = new Map(usable.map(block => [block.signature, block])), oldCounts = new Map(), newCounts = new Map();
    for (const block of usable) oldCounts.set(block.signature, (oldCounts.get(block.signature) || 0) + 1);
    for (const record of records) { record.mapping ||= describe(record); newCounts.set(record.mapping.signature, (newCounts.get(record.mapping.signature) || 0) + 1); }
    const result = new Map();
    for (const record of records) {
      const mapping = record.mapping, direct = byKey.get(mapping.key);
      const block = direct?.locator === mapping.locator && direct.signature === mapping.signature ? direct : oldCounts.get(mapping.signature) === 1 && newCounts.get(mapping.signature) === 1 ? bySignature.get(mapping.signature) : null;
      if (block && block.values.length === record.slots.length) result.set(record, block);
    }
    return result;
  }
  globalThis.ShiyiPageMap = Object.freeze({ fingerprint, key, path, describe, valid, snapshot, match });
})();
