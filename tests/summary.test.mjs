import test from 'node:test';
import assert from 'node:assert/strict';
import { SSEDecoder, streamRedactor, runSummaryModel } from '../src/lib/summary-model.js';
import { cleanSummaryProfile, summaryPresetProfile, summaryModels, summaryPrompt, cleanSummaryPrefs } from '../src/lib/summary-presets.js';
import { initialModelDraft, changeProvider, modelForm } from '../src/ui/model-setup.js';
import { createContextMenus, MENU } from '../src/lib/context-menu.js';
const profile = { provider:'custom', endpoint:'http://127.0.0.1:1234/v1/chat/completions', model:'fixture', auth:'bearer', timeoutSeconds:5 };
const event = value => `data: ${JSON.stringify(value)}\n\n`;
const delta = text => event({choices:[{delta:{content:text}}]});
function stream(body) { const bytes = new TextEncoder().encode(body); return new Response(new ReadableStream({start(controller){ for(let n=0;n<bytes.length;n+=3)controller.enqueue(bytes.slice(n,n+3));controller.close(); }}),{headers:{'content-type':'text/event-stream'}}); }
test('summary defaults and form choices exclude dedicated MT without changing translation defaults', () => {
  assert.equal(summaryPresetProfile().model,'qwen-flash');
  assert(!summaryModels('qwen').some(item=>item.id.startsWith('qwen-mt-')));
  assert.throws(()=>cleanSummaryProfile({...summaryPresetProfile(),model:'qwen-mt-flash'}), /通用对话模型/);
  const draft=changeProvider(initialModelDraft(summaryPresetProfile(),'summary'),'deepseek');
  assert.equal(changeProvider(draft,'qwen').model,'qwen-flash');
  const form=modelForm(changeProvider(draft,'qwen'),{hasKey:false});
  assert(form.includes('总结模型')); assert(!form.includes('value="qwen-mt-flash"'));
});
test('summary prompts keep page content untrusted and custom instructions bounded', () => {
  const prefs=cleanSummaryPrefs({preset:'research',prompts:{research:'按证据比较'}});
  assert(summaryPrompt('research',prefs).includes('按证据比较'));
  assert(summaryPrompt('research').includes('不声称检索'));
  assert.throws(()=>cleanSummaryPrefs({preset:'research',prompts:{research:'x'.repeat(6001)}}));
});
test('SSE parser handles CRLF, multiline events and chunked line endings', () => {
  const values=[],parser=new SSEDecoder(text=>values.push(text));
  for(const chunk of [': heartbeat\r','\ndata: one\r','\ndata: two\r\n\r','\ndata: [DONE]\n\n'])parser.push(chunk);
  parser.push('',true); assert.deepEqual(values,['one\ntwo','[DONE]']);
});
test('redactor hides secret echoes split across arbitrary deltas', () => {
  let output='';const emit=streamRedactor('sk-private-value',text=>output+=text);
  emit('正文 sk-pri');assert.equal(output,'正文 ');emit('vate-value 结束');emit('',true);
  assert.equal(output,'正文 [密钥已隐藏] 结束');
});
test('manual summary uses one actual streaming fetch and preserves split UTF8', async () => {
  const requests=[];let output='';
  await runSummaryModel({profile,apiKey:'fixture-secret',text:'原始网页资料',preset:'technical',onDelta:text=>output+=text,fetcher:async(url,options)=>{requests.push({url,options});return stream(delta('中文🙂')+delta(' sk-fixture')+event({choices:[{delta:{},finish_reason:'stop'}]})+'data: [DONE]\n\n');}});
  assert.equal(output,'中文🙂 sk-fixture');assert.equal(requests.length,1);
  const {options}=requests[0],body=JSON.parse(options.body);assert.equal(body.stream,true);assert.equal(options.headers.Authorization,'Bearer fixture-secret');assert(!options.body.includes('fixture-secret'));assert.equal(options.credentials,'omit');
});
test('auto summary classifies first then uses the selected scene and ignores reasoning deltas', async () => {
  let calls=0,output='',selected;
  await runSummaryModel({profile,apiKey:'',text:'正文',preset:'auto',onPhase:value=>{if(value.chosen)selected=value;},onDelta:text=>output+=text,fetcher:async(url,options)=>{calls++;const body=JSON.parse(options.body);if(!body.stream)return Response.json({choices:[{message:{content:'{"preset":"news","topic":"新闻主题"}'}}]});assert(body.messages[0].content.includes('各方立场'));return stream(event({choices:[{delta:{reasoning_content:'不应展示'}}]})+delta('事实总结')+'data: [DONE]\n\n');}});
  assert.equal(calls,2);assert.equal(selected.chosen,'news');assert.equal(output,'事实总结');
});
test('invalid topic type falls back to general without trusting injected preset names', async () => {
  let selected;
  await runSummaryModel({profile,text:'正文',apiKey:'',preset:'auto',onPhase:value=>{if(value.chosen)selected=value;},fetcher:async(url,options)=>JSON.parse(options.body).stream?stream(delta('总结')+'data: [DONE]\n\n'):Response.json({choices:[{message:{content:'{"preset":"__proto__"}'}}]})});
  assert.equal(selected.chosen,'general');assert.equal(selected.fallback,true);
});
test('abrupt EOF and length limit preserve emitted partial text but never report complete', async () => {
  for(const [body,code] of [[delta('部分'),'STREAM_INTERRUPTED'],[delta('部分')+event({choices:[{finish_reason:'length',delta:{}}]})+'data: [DONE]\n\n','OUTPUT_TRUNCATED']]){
    let output='';await assert.rejects(runSummaryModel({profile,apiKey:'',text:'正文',preset:'general',onDelta:text=>output+=text,fetcher:async()=>stream(body)}),error=>error.code===code);assert.equal(output,'部分');
  }
});
test('HTTP failures retain structured error category without exposing raw upstream secret', async () => {
  await assert.rejects(runSummaryModel({profile,apiKey:'private-secret',text:'正文',preset:'general',fetcher:async()=>new Response('private-secret upstream',{status:403})}),error=>error.code==='HTTP_403'&&!error.message.includes('private-secret'));
});
test('cancelled request never calls provider and summary context menu preserves synchronous gesture', async () => {
  const controller=new AbortController();controller.abort();let called=0;
  await assert.rejects(runSummaryModel({profile,apiKey:'',text:'正文',preset:'general',signal:controller.signal,fetcher:async()=>{called++;throw new DOMException('Aborted','AbortError');}}),error=>error.code==='CANCELLED');
  const actions={state:()=>{throw Error('must not await state before open');},summary:()=>{called++;}};
  assert.equal(called,0);
  const menus=createContextMenus({},actions);const promise=menus.click({menuItemId:MENU.summary,frameId:0},{id:1,windowId:2});assert.equal(called,1);await promise;
});
test('same-host summary and translation credentials remain independent across save, clear and restart storage', async () => {
  const data={local:{},session:{}};
  const area=name=>({async get(key){return {[key]:data[name][key]};},async set(value){Object.assign(data[name],value);},async remove(key){delete data[name][key];},async setAccessLevel(){}});
  globalThis.chrome={storage:{local:area('local'),session:area('session')}};
  const settings=await import('../src/lib/settings.js');await settings.initializeStorage();
  await settings.saveProfile({...profile,rememberKey:true},'translation-secret');
  assert.equal(await settings.getSummarySecret(profile),'');
  await settings.saveSummaryProfile({...profile,rememberKey:false},'summary-secret');
  assert.equal(await settings.getSecret(profile),'translation-secret');assert.equal(await settings.getSummarySecret(profile),'summary-secret');
  assert(Object.keys(data.local.modelLibraryCredentials).length===1);assert(Object.keys(data.session.modelLibraryCredentials).length===1);assert(!data.local.modelCredentials&&!data.local.summaryCredentials&&!data.session.summaryCredentials);
  await settings.clearSummaryCredential();assert.equal(await settings.getSecret(profile),'translation-secret');assert.equal(await settings.getSummarySecret(profile),'');
  delete globalThis.chrome;
});
