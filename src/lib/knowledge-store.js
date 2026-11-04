import { AppError } from './core.js';

const names = ['visits','documents','snapshots','summaries','jobs','meta'];
export function createKnowledgeStore(factory = indexedDB) {
  let opening;
  function database() {
    if (!opening) opening = new Promise((resolve, reject) => {
      const request = factory.open('dianyi-knowledge', 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const name of names) if (!db.objectStoreNames.contains(name)) {
          const store = db.createObjectStore(name, { keyPath: 'id' });
          if (name === 'visits') store.createIndex('visitedAt', 'visitedAt');
          if (name === 'jobs') store.createIndex('status', 'status');
          if (name === 'summaries') store.createIndex('logicalKey', 'logicalKey');
        }
      };
      request.onsuccess = () => { const db = request.result; db.onversionchange = () => { db.close(); opening = null; }; resolve(db); };
      request.onerror = () => { opening = null; reject(new AppError('KNOWLEDGE_STORAGE', '阅读轨迹保存失败，请检查本地存储空间。')); };
      request.onblocked = () => reject(new AppError('KNOWLEDGE_STORAGE', '请关闭旧的阅读空间页面后重试。'));
    });
    return opening;
  }
  const result = request => new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  async function read(name, id) {
    const db = await database(), tx = db.transaction(name, 'readonly');
    return result(id === undefined ? tx.objectStore(name).getAll() : tx.objectStore(name).get(id));
  }
  async function write(updates = {}, removals = {}) {
    const stores = [...new Set([...Object.keys(updates), ...Object.keys(removals)])]; if (!stores.length) return;
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(stores, 'readwrite');
      tx.oncomplete = resolve;
      tx.onabort = tx.onerror = () => reject(new AppError('KNOWLEDGE_STORAGE', '本地空间不足或轨迹保存失败，资料尚未安全保存，请导出或清理后重试。'));
      for (const [name, rows] of Object.entries(updates)) for (const row of rows) tx.objectStore(name).put(row);
      for (const [name, ids] of Object.entries(removals)) for (const id of ids) tx.objectStore(name).delete(id);
    });
  }
  return { get: (name, id) => read(name, id), all: name => read(name),keys:async name=>{const db=await database();return result(db.transaction(name,'readonly').objectStore(name).getAllKeys());}, write, close: async () => { (await opening)?.close(); opening = null; } };
}
