import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { entryIdentity } from '../src/lib/core.js';
import { explanationIdentity, selectionExplanationIdentity } from '../src/lib/explanation-model.js';

const word = () => ({ id: crypto.randomUUID(), text: 'RAG', translation: '检索增强生成', targetLanguage: 'zh-CN', updatedAt: 1 });
async function fixture() {
  globalThis.indexedDB = new IDBFactory();
  const store = await import('../src/lib/db.js?explanations=' + crypto.randomUUID());
  const entry = word();
  await store.commitTranslation(entry, 0);
  return { store, entry };
}

test('explanation identity separates pages, languages, meanings and nearby occurrences while normalizing whitespace', async () => {
  const entry = word(), url = 'https://example.org/guide';
  const key = await explanationIdentity(url, entry, 'RAG retrieves documents.');
  assert.equal(key, await explanationIdentity(url, entry, '  RAG  retrieves\ndocuments. '));
  for (const [page, value, context] of [
    [url + '/other', entry, 'RAG retrieves documents.'],
    [url, entry, 'RAG refers to old cloth.'],
    [url, { ...entry, translation: '旧布' }, 'RAG retrieves documents.'],
    [url, { ...entry, targetLanguage: 'en' }, 'RAG retrieves documents.']
  ]) assert.notEqual(key, await explanationIdentity(page, value, context));
});

test('upgrading the local v2 database preserves vocabulary and page results and adds persistent explanations', async () => {
  globalThis.indexedDB = new IDBFactory();
  const entry = word();
  await new Promise((resolve, reject) => {
    const request = indexedDB.open('shiyi-vocabulary', 2);
    request.onupgradeneeded = () => {
      const db = request.result, words = db.createObjectStore('entries', { keyPath: 'id' });
      words.createIndex('identity', 'identity', { unique: true });
      words.createIndex('targetLanguage', 'targetLanguage');
      words.put({ ...entry, identity: entryIdentity(entry.text, entry.targetLanguage) });
      for (const name of ['cache', 'meta', 'trash']) db.createObjectStore(name, { keyPath: 'id' });
      const pages = db.createObjectStore('pages', { keyPath: 'id' });
      pages.createIndex('updatedAt', 'updatedAt'); pages.createIndex('readyUntil', ['ready', 'expiresAt']);
      pages.put({ id: 'kept-page', blocks: ['existing translation'], expiresAt: Date.now() + 60000 });
    };
    request.onsuccess = () => { request.result.close(); resolve(); };
    request.onerror = () => reject(request.error);
  });
  const store = await import('../src/lib/db.js?explanation-upgrade=' + crypto.randomUUID());
  assert.equal((await store.getEntry(entry.id)).translation, entry.translation);
  assert.deepEqual((await store.pageRead('kept-page')).blocks, ['existing translation']);
  const revision = await store.explanationOpen('explanation', entry);
  assert.equal(await store.explanationWrite('explanation', revision, entry, { text: '完整解释', modelName: 'summary' }), true);
  const restarted = await import('../src/lib/db.js?explanation-restart=' + crypto.randomUUID());
  assert.equal((await restarted.explanationRead('explanation')).text, '完整解释');
});

test('regeneration retains the prior successful explanation until the latest revision completes', async () => {
  const { store, entry } = await fixture();
  const first = await store.explanationOpen('key', entry);
  await store.explanationWrite('key', first, entry, { text: '第一版', modelName: 'summary' });
  const older = await store.explanationOpen('key', entry), newer = await store.explanationOpen('key', entry);
  assert.equal((await store.explanationRead('key')).text, '第一版');
  assert.equal(await store.explanationWrite('key', older, entry, { text: '迟到的旧请求' }), false);
  await assert.rejects(store.explanationWrite('key', newer, entry, { text: '' }));
  assert.equal((await store.explanationRead('key')).text, '第一版');
  assert.equal(await store.explanationWrite('key', newer, entry, { text: '第二版' }), true);
  assert.equal((await store.explanationRead('key')).text, '第二版');
});

test('editing or deleting a vocabulary entry removes its saved explanations and rejects late writes', async () => {
  const { store, entry } = await fixture();
  const revision = await store.explanationOpen('old', entry);
  await store.explanationWrite('old', revision, entry, { text: '原解释' });
  const updated = await store.editEntry(entry.id, '新的译文');
  assert.equal(await store.explanationRead('old'), null);
  assert.equal(await store.explanationWrite('old', revision, entry, { text: '过期结果' }), false);
  const next = await store.explanationOpen('new', updated);
  await store.explanationWrite('new', next, updated, { text: '新解释' });
  await store.removeEntries([entry.id], 'test');
  assert.equal(await store.explanationRead('new'), null);
  assert.equal(await store.explanationWrite('new', next, updated, { text: '删除后迟到' }), false);
});

test('saved explanations evict the oldest records at the local count limit', async () => {
  const { store, entry } = await fixture();
  await new Promise((resolve, reject) => {
    const request = indexedDB.open('shiyi-vocabulary');
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction('explanations', 'readwrite');
      for (let index = 0; index < 1000; index++) tx.objectStore('explanations').put({ id: 'old-' + index, entryId: entry.id, text: '解释', updatedAt: index });
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => reject(tx.error);
    };
    request.onerror = () => reject(request.error);
  });
  const revision = await store.explanationOpen('latest', entry);
  await store.explanationWrite('latest', revision, entry, { text: '最新解释' });
  assert.equal(await store.explanationRead('old-0'), null);
  assert.equal((await store.explanationRead('old-1')).text, '解释');
  assert.equal((await store.explanationRead('latest')).text, '最新解释');
});
test('parallel explanation keys remain stable before and after the translation is saved', async () => {
  const entry = word(), draft = { text: entry.text, translation: '', targetLanguage: entry.targetLanguage };
  assert.equal(await selectionExplanationIdentity('https://example.org', draft, 'Nearby context'), await selectionExplanationIdentity('https://example.org', entry, 'Nearby context'));
  assert.notEqual(await selectionExplanationIdentity('https://example.org', draft, 'Nearby context'), await selectionExplanationIdentity('https://example.org', draft, 'Another context'));
});
test('an explanation can complete before its translation and is still invalidated when the saved word is edited', async () => {
  globalThis.indexedDB = new IDBFactory();
  const store = await import('../src/lib/db.js?parallel-before=' + crypto.randomUUID());
  const entry = word(), draft = { text: entry.text, translation: '', targetLanguage: entry.targetLanguage };
  const revision = await store.explanationOpen('parallel', draft);
  await store.explanationWrite('parallel', revision, draft, { text: '先完成的解释' });
  await store.commitTranslation(entry, 0);
  assert.equal((await store.explanationRead('parallel')).text, '先完成的解释');
  await store.editEntry(entry.id, '新译文');
  assert.equal(await store.explanationRead('parallel'), null);
});
test('a translation completing during explanation generation binds the result to the saved word', async () => {
  globalThis.indexedDB = new IDBFactory();
  const store = await import('../src/lib/db.js?parallel-during=' + crypto.randomUUID());
  const entry = word(), draft = { text: entry.text, translation: '', targetLanguage: entry.targetLanguage };
  const revision = await store.explanationOpen('parallel', draft);
  await store.commitTranslation(entry, 0);
  assert.equal(await store.explanationWrite('parallel', revision, draft, { text: '后完成的解释' }), true);
  await store.removeEntries([entry.id], 'test');
  assert.equal(await store.explanationRead('parallel'), null);
});
