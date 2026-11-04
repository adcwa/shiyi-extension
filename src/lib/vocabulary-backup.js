import { LANGUAGES,STYLES,assert,boundedText,classifyText,exportEntry,safeSource,VERSION } from './core.js';

export const VOCABULARY_BACKUP_KEY='vocabularyLocalBackup';
export function cleanVocabularyImport(data) {
  assert(data?.format==='shiyi-vocabulary'&&data.version===1&&Array.isArray(data.entries),'INVALID_IMPORT','请选择点译导出的词库 JSON 文件。');
  assert(data.entries.length<=20000,'INVALID_IMPORT','每批最多恢复 20,000 个词句，请分批导入。');
  return data.entries.map((input,index)=>{
    assert(input&&typeof input==='object','INVALID_IMPORT',`第 ${index+1} 条词句格式不正确。`);
    const text=boundedText(input.text,2000,'原文'),translation=boundedText(input.translation,2000,'释义');
    assert(Object.hasOwn(LANGUAGES,input.targetLanguage),'INVALID_IMPORT',`第 ${index+1} 条词句的目标语言不受支持。`);
    const timestamp=value=>Number.isFinite(value)&&value>=0&&value<=8640000000000000?value:Date.now();
    return {id:typeof input.id==='string'&&input.id.length<=80?input.id:crypto.randomUUID(),text,translation,targetLanguage:input.targetLanguage,
      kind:['word','phrase','sentence'].includes(input.kind)?input.kind:classifyText(text),style:Object.hasOwn(STYLES,input.style)?input.style:'regular',
      sourceLanguage:String(input.sourceLanguage||'').slice(0,30),modelName:String(input.modelName||'').slice(0,160),customPromptVersion:String(input.customPromptVersion||'').slice(0,100),
      context:typeof input.context==='string'?input.context.slice(0,2000):'',source:safeSource(input.source?.url||'',input.source?.title||''),createdAt:timestamp(input.createdAt),updatedAt:timestamp(input.updatedAt)};
  });
}
export function createVocabularyBackup({store,storage,now=()=>Date.now()}) {
  let tail=Promise.resolve(),error='';
  function snapshot(){
    const task=tail.then(async()=>{
      const entries=(await store.listEntries()).map(exportEntry);
      const backup={format:'shiyi-vocabulary',version:1,extensionVersion:VERSION,updatedAt:now(),count:entries.length,entries};
      try{await storage.set({[VOCABULARY_BACKUP_KEY]:backup});error='';}catch{error='词库已保存在本地数据库，自动副本未能更新。可重试备份或导出 JSON。';throw Error(error);}
      return {count:entries.length,updatedAt:backup.updatedAt};
    });tail=task.catch(()=>{});return task;
  }
  async function initialize(){
    const marker=await store.getMeta('vocabulary-protection'),backup=(await storage.get(VOCABULARY_BACKUP_KEY))[VOCABULARY_BACKUP_KEY];let restored=0;
    if(!marker&&!await store.countEntries()&&backup?.entries?.length){
      try{const result=await store.importEntries(cleanVocabularyImport(backup));restored=result.added;}
      catch{error='本地自动副本无法恢复，已保留原副本。请从词库 JSON 备份恢复。';return{restored:0};}
    }
    await store.setMeta('vocabulary-protection',{version:1,initializedAt:now()});
    await snapshot().catch(()=>{});return{restored};
  }
  async function status(){const backup=(await storage.get(VOCABULARY_BACKUP_KEY))[VOCABULARY_BACKUP_KEY];return{count:backup?.count||0,updatedAt:backup?.updatedAt||0,error};}
  return{initialize,snapshot,status};
}
