(() => {
  'use strict';
  const LONG_TEXT = 160, MAX_CHARS = 1800, MAX_PARTS = 60;
  const DEFAULT_BATCH_BLOCKS = 16, MAX_BATCH_BLOCKS = 64, MAX_BATCH_CHARS = 24000, MAX_BATCH_PARTS = 768;
  function batchLimits(value = DEFAULT_BATCH_BLOCKS) {
    const size = Number(value), maxBlocks = Number.isInteger(size) && size >= 1 && size <= MAX_BATCH_BLOCKS ? size : DEFAULT_BATCH_BLOCKS;
    return { maxBlocks, maxChars: Math.min(MAX_BATCH_CHARS, Math.max(MAX_CHARS, maxBlocks * 600)), maxParts: Math.min(MAX_BATCH_PARTS, Math.max(MAX_PARTS, maxBlocks * 12)) };
  }
  // Retain every character and its original text-node owner. Requests may split a
  // paragraph; rendering never splits its DOM or commits an incomplete paragraph.
  function chunks(parts, maxChars = MAX_CHARS, maxParts = MAX_PARTS) {
    const out = []; let batch = [], size = 0;
    const flush = () => { if (batch.length) out.push(batch); batch = []; size = 0; };
    parts.forEach((part, owner) => {
      let remaining = part.text, piece = 0;
      if (/^⟦SHIYI_\d+⟧$/.test(remaining) && size + remaining.length > maxChars) flush();
      while (remaining.length) {
        if (size >= maxChars || batch.length >= maxParts) flush();
        let end = Math.min(remaining.length, maxChars - size);
        if (end < remaining.length) {
          const window = remaining.slice(0, end), sentence = Math.max(window.lastIndexOf('。') + 1, window.lastIndexOf('. ') >= 0 ? window.lastIndexOf('. ') + 2 : 0, window.lastIndexOf('！') + 1, window.lastIndexOf('？') + 1, window.lastIndexOf('\n') + 1);
          const boundary = sentence >= end / 2 ? sentence : window.lastIndexOf(' ') + 1;
          if (boundary >= end / 2) end = boundary;
          if (end > 0 && /[\uD800-\uDBFF]/.test(remaining[end - 1]) && /[\uDC00-\uDFFF]/.test(remaining[end] || '')) end--;
          if (!end) { flush(); continue; }
        }
        batch.push({ id: `p${owner}c${piece++}`, text: remaining.slice(0, end), owner });
        size += end; remaining = remaining.slice(end);
        if (remaining.length) flush();
      }
    });
    flush(); return out;
  }
  function assemble(parts, batches, outputs) {
    const values = parts.map(() => '');
    batches.forEach((batch, index) => {
      const translated = new Map(outputs[index].parts.map(part => [part.id, part.text]));
      for (const part of batch) values[part.owner] += translated.get(part.id);
    });
    return values;
  }
  function takeBatch(queue, size = DEFAULT_BATCH_BLOCKS) {
    if (!queue.length) return [];
    const { maxBlocks, maxChars, maxParts } = batchLimits(size);
    const first = queue.shift(), batch = [first];
    if (first.singleOnly || first.chunks.length !== 1) return batch;
    let characters = first.chunks[0].reduce((sum, part) => sum + part.text.length, 0), parts = first.chunks[0].length;
    while (queue.length && batch.length < maxBlocks) {
      const next = queue[0];
      if (next.singleOnly || next.chunks.length !== 1) break;
      const size = next.chunks[0].reduce((sum, part) => sum + part.text.length, 0);
      if (characters + size > maxChars || parts + next.chunks[0].length > maxParts) break;
      batch.push(queue.shift()); characters += size; parts += next.chunks[0].length;
    }
    return batch;
  }
  globalThis.ShiyiBlockText = Object.freeze({ LONG_TEXT, MAX_CHARS, MAX_PARTS, DEFAULT_BATCH_BLOCKS, MAX_BATCH_BLOCKS, MAX_BATCH_CHARS, MAX_BATCH_PARTS, batchLimits, chunks, assemble, takeBatch });
})();
