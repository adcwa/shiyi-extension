// HTTP-only isolated UI acceptance harness. Real production settings and model
// parsers, empty in-memory storage, fixed responses, no actual provider or auth.
import { VERSION, DEFAULT_PREFS } from '../releases/dianyi-0.12.0/lib/core.js';
import { presetProfile } from '../releases/dianyi-0.12.0/lib/providers.js';
import { summaryPresetProfile } from '../releases/dianyi-0.12.0/lib/summary-presets.js';
import * as settings from '../releases/dianyi-0.12.0/lib/settings.js';
import { callModel } from '../releases/dianyi-0.12.0/lib/model.js';
import { runSummaryModel } from '../releases/dianyi-0.12.0/lib/summary-model.js';
const data={local:{},session:{}};
const area=name=>({ async get(key){return {[key]:structuredClone(data[name][key])};},async set(value){Object.assign(data[name],structuredClone(value));},async remove(key){delete data[name][key];},async setAccessLevel(){} });
const fixtureFetch=async(_url,options)=>{
  await new Promise(resolve=>setTimeout(resolve,600));
  const body=JSON.parse(options.body);
  if(body.stream)return new Response('data: {"choices":[{"delta":{"content":"隔离连接测试成功。"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
  return new Response(JSON.stringify({choices:[{message:{content:body.model.startsWith('qwen-mt-')?'好奇心':JSON.stringify({translation:'好奇心',sourceLanguage:'en',kind:'word'})}}]}),{headers:{'content-type':'application/json'}});
};
globalThis.chrome={
  storage:{local:area('local'),session:area('session')},
  permissions:{async contains(){return true;},async request(){return true;}},
  runtime:{id:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',getURL:path=>new URL('/releases/dianyi-0.12.0/'+path,location.origin).href,onMessage:{addListener(){}},async sendMessage(message){
    try{
      let result={};
      switch(message.type){
        case 'SHIYI/UI_STATE':result={...await settings.publicConfig(),version:VERSION,count:0,blacklist:[],pageCache:{count:0,bytes:0},tab:null};break;
        case 'SHIYI/LIBRARY':result={entries:[]};break;
        case 'SHIYI/TEST_MODEL':{const connection=await settings.resolveProfile(message.profile,message.apiKey);result={...await callModel({...connection,prefs:DEFAULT_PREFS,text:'curiosity',fetchImpl:fixtureFetch}),elapsedMs:8};break;}
        case 'SHIYI/TEST_SUMMARY_MODEL':{const connection=await settings.resolveSummaryProfile(message.profile,message.apiKey);let output='';await runSummaryModel({...connection,text:'隔离连接测试短文。',preset:'general',fetcher:fixtureFetch,onDelta:x=>{output+=x;}});result={translation:output,elapsedMs:8};break;}
        case 'SHIYI/SAVE_PROFILE':result=await settings.saveProfile(message.profile,message.apiKey,{id:message.connectionId,makeDefault:message.makeDefault});break;
        case 'SHIYI/SAVE_SUMMARY_PROFILE':result=await settings.saveSummaryProfile(message.profile,message.apiKey,{id:message.connectionId,makeDefault:message.makeDefault});break;
        case 'SHIYI/CONNECTION_UPDATE':await settings.updateConnection(message.purpose,message.id,message.action,message.enabled);break;
        case 'SHIYI/CLEAR_KEY':await settings.clearCredential();break;
        case 'SHIYI/CLEAR_SUMMARY_KEY':await settings.clearSummaryCredential();break;
        case 'SHIYI/SAVE_SUMMARY_PREFS':await settings.saveSummaryPrefs(message.prefs);break;
        case 'SHIYI/CODEX_STATUS':return {ok:false,error:{code:'CODEX_UNAVAILABLE',message:'隔离界面不连接本机认证；请按安装指引连接本机助手。'}};
        default:throw new Error('隔离验收未实现此操作。');
      }
      return {ok:true,data:result};
    }catch(error){return {ok:false,error:{code:error.code||'FIXTURE',message:error.message}};}
  }}
};
await settings.initializeStorage();
// All seeded keys below are synthetic and never sent to a provider. Deterministic
// fixtures let navigation-race and responsive checks start from the same state.
await settings.saveProfile({...presetProfile('deepseek'),name:'日常翻译 · 默认',rememberKey:true},'qa-primary-not-a-real-key');
await settings.saveProfile({...presetProfile('deepseek'),name:'日常翻译 · 备用 Key'},'qa-backup-not-a-real-key',{id:null});
await settings.saveProfile({...presetProfile('qwen'),name:'千问 · 网页备用'},'qa-qwen-not-a-real-key',{id:null});
await settings.saveSummaryProfile({...summaryPresetProfile(),name:'总结 · 独立连接'},'qa-summary-not-a-real-key');
await import('../releases/dianyi-0.12.0/ui/options.js');
