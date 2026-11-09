import { AppError, entryIdentity } from './core.js';
import { PAGE_TTL, MAX_PAGES, MAX_PAGE_TOTAL_BYTES, openedPage, patchedPage } from './page-cache.js';

let opening;
function database() {
  if (!opening) opening = new Promise((resolve, reject) => {
    const request = indexedDB.open('shiyi-vocabulary', 3);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('entries')) {
        const entries = db.createObjectStore('entries', { keyPath: 'id' });
        entries.createIndex('identity', 'identity', { unique: true });
        entries.createIndex('targetLanguage', 'targetLanguage');
      }
      for (const name of ['cache', 'meta', 'trash']) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
      if (!db.objectStoreNames.contains('pages')) {
        const pages = db.createObjectStore('pages', { keyPath: 'id' });
        pages.createIndex('updatedAt', 'updatedAt'); pages.createIndex('readyUntil', ['ready', 'expiresAt']);
      }
      if (!db.objectStoreNames.contains('explanations')) {
        const explanations = db.createObjectStore('explanations', { keyPath: 'id' });
        explanations.createIndex('entryId', 'entryId'); explanations.createIndex('updatedAt', 'updatedAt');
      }
    };
    request.onsuccess = () => { const db = request.result; db.onversionchange = () => { db.close(); opening = null; }; resolve(db); };
    request.onerror = () => { opening = null; reject(request.error); };
    request.onblocked = () => { opening = null; reject(new AppError('DATABASE_BUSY', '词库正在更新，请关闭旧的插件页面后重试。')); };
  });
  return opening;
}
const result = request => new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
async function transaction(names, mode, work) {
  const db = await database(), tx = db.transaction(names, mode);
  const done = new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error || new AppError('DATABASE_ABORT', '词库操作未完成，请重试。')); tx.onerror = () => {}; });
  try { const output = await work(tx); await done; return output; }
  catch (error) { try { tx.abort(); } catch {} await done.catch(() => {}); throw error; }
}
export const listEntries = language => transaction(['entries'], 'readonly', tx => language ? result(tx.objectStore('entries').index('targetLanguage').getAll(language)) : result(tx.objectStore('entries').getAll()));
export const countEntries = () => transaction(['entries'], 'readonly', tx => result(tx.objectStore('entries').count()));
export const getEntry = id => transaction(['entries'], 'readonly', tx => result(tx.objectStore('entries').get(id)));
export const findEntry = (text, language) => transaction(['entries'], 'readonly', tx => result(tx.objectStore('entries').index('identity').get(entryIdentity(text, language))));
export const getEpoch = () => transaction(['meta'], 'readonly', async tx => (await result(tx.objectStore('meta').get('epoch')))?.value || 0);
export const getMeta = id => transaction(['meta'], 'readonly', async tx => (await result(tx.objectStore('meta').get(id)))?.value);
export const setMeta = (id,value) => transaction(['meta'], 'readwrite', tx => { tx.objectStore('meta').put({id,value}); });
export function importEntries(entries) {
  return transaction(['entries','meta','cache'], 'readwrite', async tx => {
    const store=tx.objectStore('entries');let added=0,skipped=0;
    for(const input of entries){
      const identity=entryIdentity(input.text,input.targetLanguage);
      if(await result(store.index('identity').get(identity))){skipped++;continue;}
      const id=input.id&&!await result(store.get(input.id))?input.id:crypto.randomUUID();
      store.add({...input,id,identity});added++;
    }
    if(added){tx.objectStore('cache').clear();await bump(tx);}
    return {added,skipped};
  });
}
async function bump(tx) { const meta = tx.objectStore('meta'), epoch = (await result(meta.get('epoch')))?.value || 0; meta.put({ id: 'epoch', value: epoch + 1 }); }
export async function commitTranslation(entry, expectedEpoch) {
  return transaction(['entries', 'meta'], 'readwrite', async tx => {
    const epoch = (await result(tx.objectStore('meta').get('epoch')))?.value || 0;
    if (epoch !== expectedEpoch) throw new AppError('LIBRARY_CHANGED', '翻译期间词库发生了修改；为避免恢复已删词句，请重新翻译。');
    const store = tx.objectStore('entries'), identity = entryIdentity(entry.text, entry.targetLanguage);
    const existing = await result(store.index('identity').get(identity));
    if (existing) return existing;
    const record = { ...entry, identity }; store.add(record); return record;
  });
}
export async function editEntry(id, translation) {
  return transaction(['entries', 'meta', 'cache', 'explanations'], 'readwrite', async tx => {
    const store = tx.objectStore('entries'), entry = await result(store.get(id));
    if (!entry) throw new AppError('NOT_FOUND', '这个词句已经被删除。');
    entry.translation = translation; entry.updatedAt = Date.now(); store.put(entry);
    await removeExplanations(tx, entry);
    tx.objectStore('cache').clear(); await bump(tx); return entry;
  });
}
export async function removeEntries(ids, scope) {
  return transaction(['entries', 'meta', 'cache', 'trash', 'explanations'], 'readwrite', async tx => {
    const store = tx.objectStore('entries'), trash = tx.objectStore('trash'), removed = [];
    for (const id of ids) { const entry = await result(store.get(id)); if (entry) { removed.push(entry); store.delete(id); await removeExplanations(tx, entry); } }
    for (const record of await result(trash.getAll())) if (record.expiresAt < Date.now()) trash.delete(record.id);
    const token = crypto.randomUUID();
    trash.put({ id: token, entries: removed, scope, expiresAt: Date.now() + 8000 });
    tx.objectStore('cache').clear(); await bump(tx);
    return { token, removed: removed.length, expiresAt: Date.now() + 8000 };
  });
}
export async function undoDelete(token, scope) {
  return transaction(['entries', 'meta', 'trash', 'cache'], 'readwrite', async tx => {
    const trash = tx.objectStore('trash'), record = await result(trash.get(token));
    if (!record || record.expiresAt < Date.now() || record.scope !== scope) throw new AppError('UNDO_EXPIRED', '撤销时间已过，或该操作属于另一个页面。');
    const store = tx.objectStore('entries'); let restored = 0;
    for (const entry of record.entries) {
      if (!await result(store.index('identity').get(entry.identity))) { store.put(entry); restored++; }
    }
    trash.delete(token); tx.objectStore('cache').clear(); await bump(tx); return { restored };
  });
}
export async function purgeExpiredTrash() {
  return transaction(['trash'], 'readwrite', async tx => {
    const trash = tx.objectStore('trash');
    for (const record of await result(trash.getAll())) if (record.expiresAt <= Date.now()) trash.delete(record.id);
  });
}
export async function cacheRead(id) {
  return transaction(['cache'], 'readonly', async tx => {
    const entry = await result(tx.objectStore('cache').get(id));
    return entry && entry.expiresAt > Date.now() ? entry.value : null;
  });
}
export async function cacheWrite(id, value, expectedEpoch) {
  return transaction(['cache', 'meta'], 'readwrite', async tx => {
    const epoch = (await result(tx.objectStore('meta').get('epoch')))?.value || 0;
    if (epoch !== expectedEpoch) return;
    const store = tx.objectStore('cache');
    if (await result(store.count()) >= 1000) store.clear();
    store.put({ id, value, expiresAt: Date.now() + 7 * 86400000 });
  });
}
async function removeExplanations(tx, entry) {
  const store = tx.objectStore('explanations');
  for (const entryId of [entry.id, `word:${entryIdentity(entry.text, entry.targetLanguage)}`]) {
    for (const id of await result(store.index('entryId').getAllKeys(entryId))) store.delete(id);
  }
}
const sameExplanationEntry = (a, b) => a && a.text === b.text && a.translation === b.translation && a.targetLanguage === b.targetLanguage && a.updatedAt === b.updatedAt;
async function explanationEntry(tx, entry) {
  const entries = tx.objectStore('entries');
  return entry.id ? result(entries.get(entry.id)) : result(entries.index('identity').get(entryIdentity(entry.text, entry.targetLanguage)));
}
export const explanationRead = id => transaction(['explanations'], 'readwrite', async tx => {
  const store = tx.objectStore('explanations'), record = await result(store.get(id));
  if (!record?.text) return null;
  record.updatedAt = Date.now(); store.put(record);
  return { text: record.text, modelName: record.modelName, updatedAt: record.updatedAt };
});
export const explanationOpen = (id, entry) => transaction(['entries', 'explanations'], 'readwrite', async tx => {
  const current = await explanationEntry(tx, entry);
  if (entry.id && !sameExplanationEntry(current, entry)) throw new AppError('LIBRARY_CHANGED', '词句已更新，请重新打开释义后再补充。');
  const store = tx.objectStore('explanations'), previous = await result(store.get(id)), revision = crypto.randomUUID();
  store.put({ ...previous, id, entryId: current?.id || `word:${entryIdentity(entry.text, entry.targetLanguage)}`, revision, updatedAt: Date.now() });
  const excess = await result(store.count()) - 1000;
  if (excess > 0) {
    const oldest = await result(store.index('updatedAt').getAllKeys(undefined, excess + 1));
    for (const key of oldest.filter(key => key !== id).slice(0, excess)) store.delete(key);
  }
  return revision;
});
export const explanationWrite = (id, revision, entry, output) => transaction(['entries', 'explanations'], 'readwrite', async tx => {
  const store = tx.objectStore('explanations'), record = await result(store.get(id));
  if (!record || record.revision !== revision) return false;
  const current = await explanationEntry(tx, entry);
  if (entry.id && !sameExplanationEntry(current, entry)) return false;
  if (typeof output.text !== 'string' || !output.text.trim() || output.text.length > 80000) throw new AppError('INVALID_RESULT', '补充解释内容不完整，未保存到本地。');
  store.put({ ...record, entryId: current?.id || record.entryId, text: output.text, modelName: String(output.modelName || '').slice(0, 160), updatedAt: Date.now() });
  return true;
});
async function writePage(tx, page, previous) {
  const pages = tx.objectStore('pages'), meta = tx.objectStore('meta');
  page.bytes ||= new TextEncoder().encode(JSON.stringify(page)).byteLength;
  const stats = (await result(meta.get('page-cache-stats'))) || { id: 'page-cache-stats', bytes: 0 };
  stats.bytes = Math.max(0, stats.bytes - (previous?.bytes || 0) + page.bytes); pages.put(page);
  let count = await result(pages.count());
  if (count > MAX_PAGES || stats.bytes > MAX_PAGE_TOTAL_BYTES) {
    await new Promise((resolve, reject) => {
      const request = pages.index('updatedAt').openCursor();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor || count <= MAX_PAGES && stats.bytes <= MAX_PAGE_TOTAL_BYTES) { resolve(); return; }
        stats.bytes = Math.max(0, stats.bytes - (cursor.value.bytes || 0)); count--; cursor.delete(); cursor.continue();
      };
    });
  }
  meta.put(stats);
}
export const pageRead = id => transaction(['pages'], 'readonly', async tx => {
  const page = await result(tx.objectStore('pages').get(id)); return page && page.expiresAt > Date.now() ? page : null;
});
export const pageOpen = (id, info, fresh = false) => transaction(['pages', 'meta'], 'readwrite', async tx => {
  const previous = await result(tx.objectStore('pages').get(id)), next = openedPage(id, previous, info, fresh);
  await writePage(tx, next, previous); return next;
});
export const pagePatch = (id, revision, info, blocks) => transaction(['pages', 'meta'], 'readwrite', async tx => {
  const previous = await result(tx.objectStore('pages').get(id)), next = patchedPage(previous, revision, info, blocks);
  if (!next) return { saved: false };
  await writePage(tx, next, previous); return { saved: true, blocks: next.blocks.length };
});
export const pageState = (id, revision, enabled, mode) => transaction(['pages', 'meta'], 'readwrite', async tx => {
  const previous = await result(tx.objectStore('pages').get(id));
  if (!previous || previous.revision !== revision) return { saved: false };
  const next = { ...previous, enabled, mode, updatedAt: Date.now(), expiresAt: Date.now() + PAGE_TTL, bytes: 0 };
  await writePage(tx, next, previous); return { saved: true };
});
export const pageCacheSummary = () => transaction(['pages', 'meta'], 'readonly', async tx => ({
  count: await result(tx.objectStore('pages').index('readyUntil').count(IDBKeyRange.bound([1, Date.now()], [1, Number.MAX_SAFE_INTEGER]))),
  bytes: (await result(tx.objectStore('meta').get('page-cache-stats')))?.bytes || 0
}));
export const clearPageCache = () => transaction(['pages', 'meta'], 'readwrite', async tx => {
  tx.objectStore('pages').clear(); tx.objectStore('meta').put({ id: 'page-cache-stats', bytes: 0 }); return { cleared: true };
});
