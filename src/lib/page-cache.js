import { assert } from './core.js';
import './page-map.js';

export const PAGE_TTL = 7 * 86400000, MAX_PAGES = 50, MAX_PAGE_BYTES = 3 * 1024 * 1024, MAX_PAGE_TOTAL_BYTES = 20 * 1024 * 1024, MAX_PAGE_BLOCKS = 1000;
const bytes = value => new TextEncoder().encode(JSON.stringify(value)).byteLength;
export function cleanPageInfo(input = {}) {
  assert(['bilingual', 'translation'].includes(input.mode), 'INVALID_INPUT', '请选择页面译文显示方式。');
  assert(input.scope === undefined || ['page', 'selection'].includes(input.scope), 'INVALID_INPUT', '页面暂存范围不正确。');
  const selectionPaths = input.scope === 'selection' ? input.selectionPaths : [];
  assert(Array.isArray(selectionPaths) && selectionPaths.length <= 1000 && selectionPaths.every(path => typeof path === 'string' && path.length <= 4096), 'INVALID_INPUT', '页面暂存范围过大。');
  return { mode: input.mode, scope: input.scope || 'page', selectionPaths: [...new Set(selectionPaths)], fresh: input.fresh === true, title: typeof input.title === 'string' ? input.title.slice(0, 240) : '' };
}
export function cleanPageBlocks(input) {
  assert(Array.isArray(input) && input.length <= 64 && input.every(globalThis.ShiyiPageMap.valid), 'INVALID_INPUT', '页面暂存片段不完整，已保留原页面。');
  assert(bytes(input) <= MAX_PAGE_BYTES, 'PAGE_CACHE_SIZE', '本批内容超过页面暂存容量，译文仍可阅读。');
  return input.map(({ key, locator, signature, values, translation }) => ({ key, locator, signature, values, translation }));
}
export function openedPage(id, previous, info, fresh, now = Date.now()) {
  const reusable = previous && previous.expiresAt > now && !fresh;
  return { id, ...info, fresh: fresh || !!(reusable && previous.fresh) || info.fresh === true, revision: crypto.randomUUID(), enabled: true, blocks: reusable ? previous.blocks : [], updatedAt: now, expiresAt: now + PAGE_TTL, ready: reusable && previous.blocks.length ? 1 : 0 };
}
export function patchedPage(previous, revision, info, blocks, now = Date.now()) {
  if (!previous || previous.revision !== revision || previous.expiresAt <= now) return null;
  const merged = new Map(previous.blocks.map(block => [block.key, block]));
  for (const block of blocks) { merged.delete(block.key); merged.set(block.key, block); }
  const next = { ...previous, ...info, updatedAt: now, expiresAt: now + PAGE_TTL, blocks: [] };
  let total = bytes(next) + 2048;
  const sizes = new Map([...merged].map(([key, block]) => [key, bytes(block)]));
  for (const size of sizes.values()) total += size;
  for (const [key] of merged) {
    if (merged.size <= MAX_PAGE_BLOCKS && total <= MAX_PAGE_BYTES) break;
    total -= sizes.get(key); merged.delete(key);
  }
  next.blocks = [...merged.values()]; next.ready = next.blocks.length ? 1 : 0; next.bytes = bytes(next);
  return next;
}
