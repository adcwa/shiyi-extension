import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {entryIdentity} from '../src/lib/core.js';
import {createVocabularyBackup,cleanVocabularyImport,VOCABULARY_BACKUP_KEY} from '../src/lib/vocabulary-backup.js';

const word=(text='curiosity',translation='好奇心')=>({id:crypto.randomUUID(),text,translation,targetLanguage:'zh-CN',kind:'word',style:'regular',source:{url:'https://example.org/article',title:'Fixture'},createdAt:1,updatedAt:2});
async function fixture(){
  globalThis.indexedDB=new IDBFactory();const store=await import('../src/lib/db.js?isolation='+crypto.randomUUID()),data={};let fails=false;
  const storage={get:async key=>({[key]:structuredClone(data[key])}),set:async value=>{if(fails)throw Error('full');Object.assign(data,structuredClone(value));}};
  const backup=createVocabularyBackup({store,storage});return{store,data,storage,backup,fail:value=>fails=value};
}
test('upgrading a v1 local vocabulary preserves original records and adds a durable local backup',async()=>{
  globalThis.indexedDB=new IDBFactory();const saved=word();
  await new Promise((resolve,reject)=>{const request=indexedDB.open('shiyi-vocabulary',1);request.onupgradeneeded=()=>{const db=request.result,s=db.createObjectStore('entries',{keyPath:'id'});s.createIndex('identity','identity',{unique:true});s.createIndex('targetLanguage','targetLanguage');s.add({...saved,identity:entryIdentity(saved.text,saved.targetLanguage)});};request.onsuccess=()=>{request.result.close();resolve();};request.onerror=()=>reject(request.error);});
  const store=await import('../src/lib/db.js?upgrade='+crypto.randomUUID()),data={},storage={get:async k=>({[k]:data[k]}),set:async v=>Object.assign(data,v)},backup=createVocabularyBackup({store,storage});
  await backup.initialize();assert.equal((await store.listEntries())[0].translation,'好奇心');assert.equal(data[VOCABULARY_BACKUP_KEY].count,1);
  await backup.initialize();assert.equal(await store.countEntries(),1);
});
test('merge recovery preserves current meanings and handles conflicting IDs without losing new words',async()=>{
  const {store,backup}=await fixture();await backup.initialize();const original=word();await store.importEntries([original]);
  const imported=cleanVocabularyImport({format:'shiyi-vocabulary',version:1,entries:[{...original,translation:'不覆盖现有释义'},{...word('evidence','依据'),id:original.id}]});
  assert.deepEqual(await store.importEntries(imported),{added:1,skipped:1});assert.equal((await store.findEntry('curiosity','zh-CN')).translation,'好奇心');assert.notEqual((await store.findEntry('evidence','zh-CN')).id,original.id);
});
test('import validates every record before any write and discards credentials and unsafe source parameters',async()=>{
  const {store}=await fixture();assert.throws(()=>cleanVocabularyImport({format:'other',version:1,entries:[]}));
  assert.throws(()=>cleanVocabularyImport({format:'shiyi-vocabulary',version:1,entries:[word(),{...word(),targetLanguage:'unsupported'}]}));assert.equal(await store.countEntries(),0);
  const records=cleanVocabularyImport({format:'shiyi-vocabulary',version:1,entries:[{...word(),apiKey:'never-copy',authorization:'private',source:{url:'https://example.org/article?token=private',title:'Source'}}]});
  assert(!JSON.stringify(records).includes('never-copy'));assert(!JSON.stringify(records).includes('private'));assert.equal(records[0].source.url,'https://example.org/article');
});
test('a newly recreated local database can recover from its stored automatic copy',async()=>{
  const f=await fixture();await f.backup.initialize();await f.store.importEntries([word()]);await f.backup.snapshot();
  globalThis.indexedDB=new IDBFactory();const fresh=await import('../src/lib/db.js?recreated='+crypto.randomUUID()),backup=createVocabularyBackup({store:fresh,storage:f.storage});
  assert.equal((await backup.initialize()).restored,1);assert.equal(await fresh.countEntries(),1);
});
test('intentional deletion does not resurrect an older backup on restart and empty copies remain empty',async()=>{
  const {store,backup,data,storage}=await fixture();await backup.initialize();const record=word();await store.importEntries([record]);await backup.snapshot();await store.removeEntries([record.id],'test');
  const restarted=createVocabularyBackup({store,storage});await restarted.initialize();assert.equal(await store.countEntries(),0);assert.equal(data[VOCABULARY_BACKUP_KEY].count,0);
});
test('backup failure leaves the primary local vocabulary intact and provides a recovery message',async()=>{
  const f=await fixture();await f.backup.initialize();await f.store.importEntries([word()]);f.fail(true);await assert.rejects(f.backup.snapshot());assert.equal(await f.store.countEntries(),1);assert.match((await f.backup.status()).error,/重试备份/);
  f.fail(false);await f.backup.snapshot();assert.equal((await f.backup.status()).error,'');
});
test('a corrupt automatic copy never blocks the extension or silently overwrites the only backup',async()=>{
  const f=await fixture();f.data[VOCABULARY_BACKUP_KEY]={entries:[{invalid:true}]};await f.backup.initialize();assert.match((await f.backup.status()).error,/无法恢复/);assert.deepEqual(f.data[VOCABULARY_BACKUP_KEY].entries,[{invalid:true}]);
});
