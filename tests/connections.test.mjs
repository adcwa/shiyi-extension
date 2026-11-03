import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanProfile, secretIdentity, DEFAULT_PREFS, AppError } from '../src/lib/core.js';
import { runConnections, orderedConnections, hasUsableConnection } from '../src/lib/connections.js';
import * as settings from '../src/lib/settings.js';
import { initialModelDraft, changeProvider, canReuseKey, modelForm } from '../src/ui/model-setup.js';
import { nativeCodex, codexFetch } from '../src/lib/codex.js';
import { callModel } from '../src/lib/model.js';
import { runSummaryModel } from '../src/lib/summary-model.js';
import { createServer } from 'node:http';

const profile = cleanProfile({ provider:'custom', endpoint:'https://model.example/v1', model:'small-model', name:'主用 Key', auth:'bearer', timeoutSeconds:5 });
function memory(initial = {}) {
  const data={local:structuredClone(initial),session:{}};
  const area=name=>({ async get(key){return {[key]:structuredClone(data[name][key])};}, async set(value){Object.assign(data[name],structuredClone(value));}, async remove(key){delete data[name][key];},async setAccessLevel(){} });
  globalThis.chrome={storage:{local:area('local'),session:area('session')}};
  return data;
}
test('same-endpoint keys stay independent, blank new connection cannot borrow, and default controls credentials', async () => {
  const data=memory();await settings.initializeStorage();
  const first=await settings.saveProfile({...profile,rememberKey:true},'primary-only-secret');
  const second=await settings.saveProfile({...profile,name:'备用 Key',rememberKey:false},'backup-only-secret',{id:null});
  let value=await settings.config();const bank=value.modelConnections.translation;
  assert.equal(bank.defaultId,first.id);assert.equal(bank.items.length,2);
  assert.equal(await settings.getSecret(bank.items[0].profile),'primary-only-secret');
  assert.equal(await settings.getSecret(bank.items[1].profile),'backup-only-secret');
  await assert.rejects(settings.resolveProfile({...profile,connectionId:null},''),{code:'MISSING_KEY'});
  assert.equal(Object.keys(data.local.modelCredentials).length,1);assert.equal(Object.keys(data.session.modelCredentials).length,1);
  assert(!JSON.stringify(await settings.publicConfig()).includes('only-secret'));
  await settings.updateConnection('translation',second.id,'default');value=await settings.config();
  assert.equal(value.profile.connectionId,second.id);assert.equal(await settings.getSecret(value.profile),'backup-only-secret');
  await settings.saveProfile({...value.profile,rememberKey:true},'');
  assert.equal(Object.keys(data.local.modelCredentials).length,2);assert.equal(Object.keys(data.session.modelCredentials).length,0);
  await assert.rejects(settings.updateConnection('translation',second.id,'delete'),{code:'DEFAULT_CONNECTION'});
  await settings.updateConnection('translation',first.id,'delete');
  assert.equal((await settings.config()).profile.connectionId,second.id);assert(!data.local.modelCredentials[first.id]);
});
test('legacy model and session/local persistence migrate once, with no resurrection after clearing', async () => {
  const data=memory({config:{profile:{...profile,rememberKey:true},summaryProfile:{...profile,name:'总结旧连接'},summaryConfigured:true,prefs:{...DEFAULT_PREFS}},credential:{identity:secretIdentity(profile),apiKey:'legacy-translation'}});
  data.session.summaryCredential={identity:secretIdentity(profile),apiKey:'legacy-summary'};
  await settings.initializeStorage();let value=await settings.config();
  assert.equal(await settings.getSecret(value.profile),'legacy-translation');assert.equal(await settings.getSummarySecret(value.summaryProfile),'legacy-summary');
  assert(!data.local.credential);assert(!data.session.summaryCredential);assert(data.session.summaryCredentials['summary-primary']);
  assert(!data.local.summaryCredentials);assert.equal(value.profile.model,profile.model);
  await settings.clearCredential();await settings.initializeStorage();value=await settings.config();
  assert.equal(await settings.getSecret(value.profile),'');assert.equal(await settings.getSummarySecret(value.summaryProfile),'legacy-summary');
});
test('concurrent connection saves serialize without losing keys and enforce capacity before writes', async () => {
  const data=memory();await settings.initializeStorage();
  await Promise.all(Array.from({length:8},(_,i)=>settings.saveProfile({...profile,name:'连接 '+i},'independent-'+i,{id:null})));
  assert.equal((await settings.config()).modelConnections.translation.items.length,8);
  assert.equal(Object.keys(data.session.modelCredentials).length,8);
  await assert.rejects(settings.saveProfile(profile,'ninth',{id:null}),{code:'CONNECTION_LIMIT'});
  assert.equal(Object.keys(data.session.modelCredentials).length,8);
});
test('clearing one purpose removes all its primary and backup keys without touching the other purpose', async () => {
  memory();await settings.initializeStorage();await settings.saveProfile(profile,'translation');await settings.saveSummaryProfile(profile,'summary');await settings.saveSummaryProfile({...profile,name:'summary backup'},'summary-backup',{id:null});
  await settings.clearSummaryCredential();const value=await settings.config();
  assert.equal(await settings.getSecret(value.profile),'translation');
  for(const item of value.modelConnections.summary.items)assert.equal(await settings.getSummarySecret(item.profile),'');
});
const policy = () => ({modelConnections:{translation:{defaultId:'primary',items:[{id:'disabled',backup:false,profile:{name:'关闭的备用'}},{id:'backup',backup:true,profile:{name:'备用',model:'small',endpoint:profile.endpoint,auth:'bearer',hasKey:true}},{id:'primary',backup:true,profile:{name:'默认',model:'small',endpoint:profile.endpoint,auth:'bearer',hasKey:false}}]}}});
test('default always goes first, enabled backups follow saved order, and an expired primary still permits backup entry', async () => {
  const value=policy(),calls=[];
  assert.deepEqual(orderedConnections(value,'translation').map(c=>c.id),['primary','backup']);assert.equal(hasUsableConnection(value,'translation'),true);
  const result=await runConnections({value,purpose:'translation',resolve:async p=>({profile:p,apiKey:p.name}),run:async c=>{calls.push(c.profile.name);if(c.profile.name==='默认')throw new AppError('HTTP_429','限流');return '译文';}});
  assert.deepEqual(calls,['默认','备用']);assert.equal(result.output,'译文');assert.equal(result.backup,true);
});
test('cancel, malformed model output and partial summary never rotate to another connection', async () => {
  for(const code of ['CANCELLED','BLOCK_ALIGNMENT','INVALID_RESULT']){
    let calls=0;await assert.rejects(runConnections({value:policy(),purpose:'translation',resolve:async p=>({profile:p}),run:async()=>{calls++;throw new AppError(code,'受控失败');}}),{code});assert.equal(calls,1);
  }
  let emitted=false,calls=0;
  await assert.rejects(runConnections({value:policy(),purpose:'translation',resolve:async p=>({profile:p}),allowBackup:()=>!emitted,run:async()=>{calls++;emitted=true;throw new AppError('NETWORK_ERROR','部分内容已保留');}}),{code:'NETWORK_ERROR'});assert.equal(calls,1);
  const controller=new AbortController();calls=0;
  await assert.rejects(runConnections({value:policy(),purpose:'translation',signal:controller.signal,resolve:async p=>({profile:p}),run:async()=>{calls++;controller.abort();throw new AppError('NETWORK','失败');}}),{code:'CANCELLED'});assert.equal(calls,1);
});
test('exhausted connections preserve the last HTTP category and pause page queues instead of repeating across all blocks', async () => {
  let calls=0;
  await assert.rejects(runConnections({value:policy(),purpose:'translation',resolve:async p=>({profile:p}),run:async()=>{calls++;throw new AppError('HTTP_503','受控服务故障');}}),error=>error.code==='HTTP_503' && error.connectionsExhausted && error.message.includes('2 个连接'));
  assert.equal(calls,2);
});
test('editing and provider changes preserve connection identity but new same-vendor forms never reuse another key', () => {
  const saved={...profile,connectionId:'one',hasKey:true};
  const draft=initialModelDraft(saved);assert.equal(changeProvider(draft,'qwen').connectionId,'one');assert.equal(changeProvider(draft,'codex').connectionId,'one');
  assert.equal(canReuseKey({...draft,connectionId:null},saved),false);
  assert.equal(canReuseKey({...draft,connectionId:'two'},saved),false);
  const html=modelForm({...draft,connectionId:null},saved);
  assert.match(html,/id="model-key"[^>]* required/);assert.equal((html.match(/id="model-name"/g)||[]).length,1);
});
test('Codex profile has no copied credential, validates models and preserves the API endpoint restrictions', () => {
  const codex=cleanProfile({provider:'codex',model:'auto'});assert.equal(codex.auth,'none');assert.equal(codex.endpoint,'codex://local');assert.equal(codex.rememberKey,false);
  assert.throws(()=>cleanProfile({provider:'codex',model:'x; arbitrary-command'}));assert.throws(()=>cleanProfile({...profile,endpoint:'http://remote.example/v1'}));
  const html=modelForm(initialModelDraft(codex),codex);assert(!html.includes('id="model-key"'));assert.match(html,/本机助手/);assert.match(html,/API Key 的按量计费不同/);
});
test('actual HTTP rotates two same-endpoint keys after 429 and sends only the chosen credential in each header', async () => {
  const requests=[];
  const server=createServer((request,response)=>{let body='';request.on('data',part=>{body+=part;});request.on('end',()=>{
    requests.push({authorization:request.headers.authorization,body});response.setHeader('Content-Type','application/json');
    if(request.headers.authorization==='Bearer rejected-primary'){response.writeHead(429);response.end('{"error":{"code":"rate_limit"}}');}
    else response.end(JSON.stringify({choices:[{message:{content:'{"translation":"好奇心","sourceLanguage":"en","kind":"word"}'}}]}));
  });});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    memory();await settings.initializeStorage();const endpoint=`http://127.0.0.1:${server.address().port}/v1`;
    await settings.saveProfile({...profile,endpoint},'rejected-primary');await settings.saveProfile({...profile,endpoint,name:'真实 HTTP 备用'},'accepted-backup',{id:null});
    const result=await runConnections({value:await settings.config(),purpose:'translation',resolve:settings.resolveProfile,run:connection=>callModel({...connection,prefs:DEFAULT_PREFS,text:'curiosity'})});
    assert.equal(result.output.translation,'好奇心');assert.equal(result.profile.name,'真实 HTTP 备用');assert.equal(result.backup,true);
    assert.deepEqual(requests.map(r=>r.authorization),['Bearer rejected-primary','Bearer accepted-backup']);assert(requests.every(r=>!r.body.includes('rejected-primary')&&!r.body.includes('accepted-backup')));
  }finally{server.close();server.closeAllConnections();}
});
function fakeNative(script) {
  const events=()=>({listeners:[],addListener(fn){this.listeners.push(fn);}}),message=events(),disconnect=events();
  const stats={connections:0,closed:false,request:null};
  const port={onMessage:message,onDisconnect:disconnect,postMessage(request){stats.request=request;queueMicrotask(()=>script(value=>message.listeners.forEach(fn=>fn(value)),request));},disconnect(){stats.closed=true;disconnect.listeners.forEach(fn=>fn());}};
  return {stats,api:{runtime:{connectNative(){stats.connections++;return port;}}}};
}
test('native protocol streams deltas, hides raw native errors and aborts before or during generation', async () => {
  const fake=fakeNative(emit=>{emit({type:'delta',text:'好'});emit({type:'delta',text:'奇心'});emit({type:'done'});}),chunks=[];
  assert.equal(await nativeCodex({chromeApi:fake.api,onDelta:x=>chunks.push(x)}),'好奇心');assert.deepEqual(chunks,['好','奇心']);assert(fake.stats.closed);
  const failed=fakeNative(emit=>emit({type:'error',code:'CODEX_AUTH',message:'must-not-echo-secret'}));
  await assert.rejects(nativeCodex({chromeApi:failed.api}),e=>e.code==='CODEX_AUTH'&&!e.message.includes('must-not-echo-secret'));
  const aborted=new AbortController();aborted.abort();await assert.rejects(nativeCodex({chromeApi:fake.api,signal:aborted.signal}),{code:'CANCELLED'});assert.equal(fake.stats.connections,1);
  const ongoing=fakeNative(emit=>emit({type:'delta',text:'部分内容'})),response=await codexFetch(cleanProfile({provider:'codex'}),{messages:[],stream:true},undefined,ongoing.api),reader=response.body.getReader();
  await reader.read();await reader.cancel();await Promise.resolve();assert(ongoing.stats.closed);
});
test('native translation and summary use existing structured mapping and stream parsers', async () => {
  const codex=cleanProfile({provider:'codex'}),native=fakeNative((emit,request)=>{assert.equal(request.model,'auto');assert(!Object.hasOwn(request,'apiKey'));emit({type:'delta',text:'{"parts":[{"id":"p2","text":"世界"},{"id":"p1","text":"你好"}]}'});emit({type:'done'});});globalThis.chrome=native.api;
  const output=await callModel({profile:codex,prefs:DEFAULT_PREFS,parts:[{id:'p1',text:'Hello'},{id:'p2',text:'World'}]});assert.deepEqual(output.parts,[{id:'p1',text:'你好'},{id:'p2',text:'世界'}]);
  const summary=fakeNative(emit=>{emit({type:'delta',text:'# 总结\n'});emit({type:'delta',text:'保留重点。'});emit({type:'done'});});globalThis.chrome=summary.api;let text='';
  await runSummaryModel({profile:codex,text:'A public page about text reading.',preset:'general',onDelta:part=>{text+=part;}});assert.equal(text,'# 总结\n保留重点。');assert(summary.stats.closed);delete globalThis.chrome;
});
