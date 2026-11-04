import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { IDBFactory } from 'fake-indexeddb';
import { createKnowledgeStore } from '../src/lib/knowledge-store.js';
import { createKnowledgeManager } from '../src/lib/knowledge-manager.js';
import { dayKey,period,zonedTime,nextDaily,cleanKnowledgePrefs,evidenceParts,plainKnowledgeText,knowledgeSource } from '../src/lib/knowledge-core.js';
import { knowledgeFiles,knowledgeZip,knowledgeCSV,knowledgeJSONL,knowledgeBundleMarkdown,knowledgeMarkdown } from '../src/lib/knowledge-export.js';

const delay=ms=>new Promise(r=>setTimeout(r,ms));
test('reading-list excerpts remove Markdown syntax but preserve text, link labels and code',()=>{const value=plainKnowledgeText('# 标题\n\n- 重要依据\n\n```javascript\nconst localKnowledge = true;\n```\n[来源](https://example.org) **关键**');assert.equal(value,'标题 重要依据 const localKnowledge = true; 来源 关键');});
test('knowledge source links retain ordinary article IDs while removing auth and unnecessary parameters',()=>{const source=knowledgeSource('https://example.org/view?id=42&page=2&token=private&signature=hidden&utm_source=ad','Source');assert.equal(source.url,'https://example.org/view?id=42&page=2');assert.equal(knowledgeSource('https://example.org/#/docs/guide','Guide').url,'https://example.org/#/docs/guide');});
async function until(fn){for(let n=0;n<400;n++){if(await fn())return;await delay(10);}assert.fail('Knowledge task timed out');}
async function fixture(t,{time=Date.parse('2026-11-04T10:30:00Z'),configured=true}={}){
 const repository=createKnowledgeStore(new IDBFactory()),calls=[],alarms=new Map(),tabs=new Map([[1,{id:1,url:'https://example.org/article',title:'Article',active:false,status:'complete'}],[2,{id:2,url:'https://other.example/guide',title:'Other',active:false,status:'complete'}]]);
 let clock=time,mode='ok';
 const server=http.createServer(async(req,res)=>{let body='';for await(const part of req)body+=part;const data=JSON.parse(body);calls.push(data);if(mode==='403'){res.writeHead(403);res.end('{"error":{"code":"Forbidden"}}');return;}res.writeHead(200,{'Content-Type':'text/event-stream'});res.write('data: '+JSON.stringify({choices:[{delta:{content:'## 阅读要点\n\n从来源提炼事实与依据。'}}]})+'\n\n');if(mode==='slow')return;if(mode==='delayed'){setTimeout(()=>res.end('data: [DONE]\n\n'),180);return;}res.end('data: [DONE]\n\n');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const profile={provider:'custom',model:'local-knowledge-fixture',name:'Local',auth:'none',endpoint:`http://127.0.0.1:${server.address().port}/v1/chat/completions`,timeoutSeconds:5};
 const value={blacklist:[],summaryConfigured:configured,summaryProfile:profile,summaryPrefs:{preset:'general',prompts:{}},knowledgePrefs:{time:'18:00',timeZone:'Asia/Shanghai',prompts:{}},modelConnections:{summary:{defaultId:'one',items:[{id:'one',profile,backup:false}]}}};
 const chromeApi={runtime:{sendMessage:async()=>{},getPlatformInfo:async()=>({})},permissions:{contains:async()=>true},alarms:{create:async(name,info)=>alarms.set(name,info)},tabs:{get:async id=>{if(!tabs.has(id))throw Error('closed');return {...tabs.get(id)};}},scripting:{executeScript:async({target})=>{const tab=tabs.get(target.tabId);return [{result:{url:tab.url,title:tab.title,text:tab.text||'Original visible evidence about reading and local summaries. No forms are read.',chars:80,truncated:false}}];}}};
 const settings={config:async()=>structuredClone(value),resolveSummaryProfile:async profile=>({profile,apiKey:''})};
 let service=createKnowledgeManager({chromeApi,settings,repository,permissionGranted:async()=>true,now:()=>clock});await service.initialize();
 t.after(async()=>{service.cancelAll('test ended');await delay(20);server.closeAllConnections();await new Promise(r=>server.close(r));await repository.close();});
 const complete=async id=>until(async()=>{const s=await repository.get('summaries',id);assert.notEqual(s?.phase,'error',s?.error);return s?.phase==='complete';});
 return {repository,calls,alarms,tabs,value,chromeApi,settings,get service(){return service;},setTime:t=>clock=t,mode:next=>mode=next,complete,restart:async()=>{service.cancelAll();await delay(20);service=createKnowledgeManager({chromeApi,settings,repository,permissionGranted:async()=>true,now:()=>clock});await service.initialize();}};
}
test('calendar periods keep natural-day boundaries, Monday weeks and leap/year rollovers',()=>{
 assert.equal(dayKey(Date.parse('2026-11-03T16:01:00Z'),'Asia/Shanghai'),'2026-11-04');
 const w=period('week','2026-11-01','Asia/Shanghai');assert.equal(w.start,'2026-10-26');assert.equal(w.end,'2026-11-02');
 assert.equal(period('month','2024-02-20','UTC').end,'2024-03-01');assert.equal(period('year','2026-12-31','UTC').end,'2027-01-01');
 const p={time:'18:00',timeZone:'Asia/Shanghai'};assert.equal(new Date(nextDaily(Date.parse('2026-11-04T09:00:00Z'),p)).toISOString(),'2026-11-04T10:00:00.000Z');
 assert.equal(new Date(nextDaily(Date.parse('2026-11-04T11:00:00Z'),p)).toISOString(),'2026-11-05T10:00:00.000Z');
 assert.equal(new Date(zonedTime('2026-03-08','18:00','America/New_York')).toISOString(),'2026-03-08T22:00:00.000Z');
 assert.throws(()=>cleanKnowledgePrefs({time:'25:01'}));assert.throws(()=>cleanKnowledgePrefs({timeZone:'bad/timezone'}));
});
test('oversized evidence splits without dropping any text and preserves source IDs',()=>{
 const text='完整证据'.repeat(17000),groups=evidenceParts([{id:'evidence-1',text}],20000),parts=groups.flat();
 assert(groups.length>1);assert.equal(parts.map(p=>p.text).join(''),text);assert(parts.every(p=>p.id==='evidence-1'));assert(groups.every(g=>JSON.stringify(g).length<21000));
});
test('a hidden webpage is durably captured and summarized without a side panel',async t=>{
 const f=await fixture(t);const result=await f.service.captureTab(1);await f.complete(result.id);assert.equal(f.calls.length,1);
 const list=await f.service.list({});assert.equal(list.total,1);assert.equal(list.items[0].phase,'complete');
 assert((await f.repository.get('snapshots',(await f.service.detail(list.items[0].id)).visit.documentId)).text.includes('Original visible'));
 assert(f.calls[0].messages.at(-1).content.includes('page_title'));assert(!f.calls[0].messages.at(-1).content.includes('apiKey'));
});
test('same content adds visits without additional model requests; changed content gets a new version',async t=>{
 const f=await fixture(t),first=await f.service.captureTab(1);await f.complete(first.id);
 await f.service.begin(1,{newVisit:true});const second=await f.service.captureTab(1);await delay(100);assert.equal(second.id,first.id);assert.equal(f.calls.length,1);assert.equal((await f.service.list({})).total,2);
 f.tabs.get(1).text='A materially changed article about a different technical implementation.';const third=await f.service.captureTab(1);await f.complete(third.id);assert.notEqual(third.id,first.id);assert.equal(f.calls.length,2);assert.equal((await f.service.list({})).total,3);
});
test('closing a tab after capture does not cancel its stored snapshot job',async t=>{
 const f=await fixture(t);f.mode('slow');const result=await f.service.captureTab(1);await until(()=>f.calls.length===1);f.service.removeTab(1);f.tabs.delete(1);
 assert((await f.repository.all('snapshots')).length===1);assert.equal((await f.repository.get('summaries',result.id)).phase,'streaming');f.service.stop(result.id);await until(async()=> (await f.repository.get('summaries',result.id)).phase==='stopped');
});
test('missing model saves input, waits without calls, then resumes when connected',async t=>{
 const f=await fixture(t,{configured:false}),result=await f.service.captureTab(1);await until(async()=> (await f.repository.get('jobs',result.id)).status==='waiting');assert.equal(f.calls.length,0);assert.equal((await f.repository.all('visits')).length,1);
 f.value.summaryConfigured=true;await f.service.resume();await f.complete(result.id);assert.equal(f.calls.length,1);
});
test('restart keeps finished local knowledge and restores without repeated generation',async t=>{
 const f=await fixture(t,{time:Date.parse('2026-11-04T01:00:00Z')}),r=await f.service.captureTab(1);await f.complete(r.id);await f.restart();
 const reopened=await f.service.captureTab(1);assert.equal(reopened.id,r.id);await delay(100);assert.equal(f.calls.length,1);assert.equal((await f.service.list({})).total,2);
});
test('blacklist prevents capture, cancels in-flight output, and excludes old sources from exports',async t=>{
 const f=await fixture(t);f.value.blacklist=['example.org'];assert.equal((await f.service.captureTab(1)).started,false);assert.equal((await f.service.list({})).total,0);
 f.value.blacklist=[];f.mode('slow');const r=await f.service.captureTab(1);await until(()=>f.calls.length===1);f.value.blacklist=['example.org'];await f.service.restrict();await delay(100);
 assert.equal((await f.repository.get('jobs',r.id)).status,'canceled');assert.equal((await f.service.exportData()).visits.length,0);assert.equal((await f.service.exportData()).summaries.length,0);
});
test('daily reviews include notes, deduplicate unchanged inputs and preserve explicit versions',async t=>{
 const f=await fixture(t),r=await f.service.captureTab(1);await f.complete(r.id);const visit=(await f.service.list({})).items[0];await f.service.updateVisit(visit.id,{note:'重点核对实现边界',project:'阅读项目',tags:'技术,验证'});
 const review=await f.service.createReview({kind:'day',date:'2026-11-04'});await f.complete(review.id);assert(f.calls.at(-1).messages.at(-1).content.includes('重点核对实现边界'));
 const again=await f.service.createReview({kind:'day',date:'2026-11-04'});assert.equal(again.id,review.id);const newer=await f.service.createReview({kind:'day',date:'2026-11-04',force:true});await f.complete(newer.id);assert.notEqual(newer.id,review.id);
 assert.equal((await f.service.detail(newer.id)).versions.length,2);
});
test('month and year aggregate bounded lower periods rather than cross-month weeks',async t=>{
 const f=await fixture(t),r=await f.service.captureTab(1);await f.complete(r.id);const m=await f.service.createReview({kind:'month',date:'2026-11-04'});await f.complete(m.id);
 const month=await f.repository.get('summaries',m.id);assert(month.inputIds.length===1);assert.equal((await f.repository.get('summaries',month.inputIds[0])).kind,'day');assert.equal(month.sourceIds[0],r.id);
 const y=await f.service.createReview({kind:'year',date:'2026-11-04'});await f.complete(y.id);const year=await f.repository.get('summaries',y.id);assert((await f.repository.get('summaries',year.inputIds[0])).kind==='month');
});
test('scheduled 18:00 snapshots and late arrivals produce traceable new daily versions',async t=>{
 const f=await fixture(t,{time:Date.parse('2026-11-04T09:00:00Z')}),r=await f.service.captureTab(1);await f.complete(r.id);await f.service.runDue();assert.equal((await f.service.list({type:'reviews'})).total,0);
 f.setTime(Date.parse('2026-11-04T10:01:00Z'));await f.service.runDue();await until(async()=> (await f.service.list({type:'reviews'})).items.some(s=>s.phase==='complete'));const calls=f.calls.length;await f.service.runDue();await delay(50);assert.equal(f.calls.length,calls);
 f.setTime(Date.parse('2026-11-04T12:00:00Z'));const later=await f.service.captureTab(2);await f.complete(later.id);f.setTime(Date.parse('2026-11-05T10:01:00Z'));await f.service.runDue();await until(async()=> (await f.service.list({type:'reviews'})).items.filter(s=>s.phase==='complete').length>=2);
 const reviews=(await f.repository.all('summaries')).filter(s=>s.kind==='day');assert(reviews.some(s=>s.sourceIds.length===2));assert(f.alarms.has('dianyi-knowledge-daily'));
});
test('topic/project filters reach real analysis and source evidence, without fabricating empty periods',async t=>{
 const f=await fixture(t),r=await f.service.captureTab(1);await f.complete(r.id);const v=(await f.service.list({})).items[0];await f.service.updateVisit(v.id,{note:'',project:'Alpha',tags:'性能'});
 const analysis=await f.service.createReview({kind:'analysis',dimension:'技术方案',filter:{project:'Alpha'}});await f.complete(analysis.id);assert((await f.repository.get('summaries',analysis.id)).sourceIds.includes(r.id));
 const count=f.calls.length,empty=await f.service.createReview({kind:'day',date:'2026-11-03'});assert.equal((await f.repository.get('summaries',empty.id)).sourceIds.length,0);assert.equal(f.calls.length,count);
});
test('elapsed wall-clock time and worker restart do not re-bill unchanged period evidence',async t=>{
 const f=await fixture(t),r=await f.service.captureTab(1);await f.complete(r.id);await f.service.runDue();await until(async()=> (await f.service.list({type:'reviews'})).items.some(s=>s.kind==='day'&&s.phase==='complete'));
 const count=f.calls.length,first=(await f.service.list({type:'reviews'})).items[0].id;f.setTime(Date.parse('2026-11-04T11:30:00Z'));await f.service.runDue();await delay(80);assert.equal(f.calls.length,count);assert.equal((await f.service.list({type:'reviews'})).items[0].id,first);
 await f.restart();await delay(80);assert.equal(f.calls.length,count);
});
test('delete removes orphan snapshots and derived reviews; late writes cannot restore them',async t=>{
 const f=await fixture(t),r=await f.service.captureTab(1);await f.complete(r.id);const report=await f.service.createReview({kind:'day',date:'2026-11-04'});await f.complete(report.id);const v=(await f.service.list({})).items[0];await f.service.remove([v.id]);
 assert.equal((await f.repository.all('snapshots')).length,0);assert.equal((await f.repository.all('summaries')).length,0);assert.equal((await f.service.list({})).total,0);await delay(50);assert.equal((await f.repository.all('summaries')).length,0);
});
test('exports provide Markdown, graph JSONL and readable ZIP paths without internal identities or secrets',async t=>{
 const f=await fixture(t),r=await f.service.captureTab(1);await f.complete(r.id);const data=await f.service.exportData(),files=knowledgeFiles(data),encoded=knowledgeZip(files);
 assert(files['manifest.json']);assert(files['relations.jsonl']);assert(Object.keys(files).some(n=>n.startsWith('summaries/')));assert.equal(new DataView(encoded.buffer).getUint32(0,true),0x04034b50);
 assert(!knowledgeJSONL(data).includes('"identity"'));assert(!knowledgeJSONL(data).includes('apiKey'));assert.equal(data.snapshots.length,0);assert((await f.service.exportData({},true)).snapshots.length===1);
 const full=await f.service.exportData({},true);assert(knowledgeJSONL(full).includes('"type":"snapshot"'));
 const visit=data.visits[0];visit.note='独立文档里的备注';assert(knowledgeBundleMarkdown(data).includes(visit.note));
 assert(!knowledgeMarkdown({...data.summaries[0],sourceIds:['related']}).includes('(related.md)'));assert(knowledgeFiles({...data,summaries:[{...data.summaries[0],sourceIds:[r.id]}]})[`summaries/${r.id}.md`].includes(`(${r.id}.md)`));
 const csv=knowledgeCSV([{id:'x',visitedAt:Date.now(),source:{title:'=FORMULA()',url:'https://example.org'},project:'',tags:[],note:'',summaryId:r.id}]);assert(csv.includes("'=FORMULA"));
});
test('explicit re-summary makes a fresh request and preserves the previous completed version',async t=>{
 const f=await fixture(t),r=await f.service.captureTab(1);await f.complete(r.id);const before=f.calls.length,v=(await f.service.list({})).items[0];const fresh=await f.service.retry(v.id);await f.complete(fresh.id);assert.equal(f.calls.length,before+1);assert.equal((await f.repository.get('summaries',r.id)).phase,'complete');assert.equal((await f.service.detail(v.id)).versions.length,2);
});
test('simultaneous captures and period requests share durable jobs rather than duplicate model calls',async t=>{
 const f=await fixture(t),captures=await Promise.all([f.service.captureTab(1),f.service.captureTab(1)]);assert.equal(captures[0].id,captures[1].id);await f.complete(captures[0].id);const reports=await Promise.all([f.service.createReview({kind:'day',date:'2026-11-04'}),f.service.createReview({kind:'day',date:'2026-11-04'})]);assert.equal(reports[0].id,reports[1].id);await f.complete(reports[0].id);assert.equal(f.calls.length,2);
});
test('blacklisting a context source excludes dependent page summaries and inherited yearly knowledge',async t=>{
 const f=await fixture(t),first=await f.service.captureTab(1);await f.complete(first.id);f.tabs.get(2).openerTabId=1;const next=await f.service.captureTab(2);await f.complete(next.id);assert((await f.repository.get('summaries',next.id)).contextIds.includes(first.id));
 f.value.blacklist=['example.org'];await f.service.restrict();const data=await f.service.exportData();assert(!data.summaries.length);assert(data.visits.every(v=>!v.summaryId));
});
test('revoked permission on a related source prevents sending that context through another allowed page',async t=>{
 const f=await fixture(t),first=await f.service.captureTab(1);await f.complete(first.id);f.tabs.get(2).openerTabId=1;
 f.chromeApi.permissions.contains=async({origins})=>!origins.some(origin=>origin.includes('example.org'));
 const next=await f.service.captureTab(2);await until(async()=> (await f.repository.get('jobs',next.id))?.status==='error');
 assert.equal(f.calls.length,1);assert.match((await f.repository.get('summaries',next.id)).error,/权限/);
});
test('year-end scheduler executes day/month/year in order and remains idempotent',async t=>{
 const f=await fixture(t,{time:Date.parse('2026-12-31T11:00:00Z')}),r=await f.service.captureTab(1);await f.complete(r.id);await f.service.runDue();await until(async()=> (await f.service.list({type:'reviews'})).items.some(s=>s.kind==='year'&&s.phase==='complete'));
 const count=f.calls.length;await f.service.runDue();await delay(80);assert.equal(f.calls.length,count);const kinds=(await f.service.list({type:'reviews'})).items.map(s=>s.kind);assert(kinds.includes('month')&&kinds.includes('day'));
});
test('clearing local knowledge also removes blacklisted history and leaves model configuration alone',async t=>{
 const f=await fixture(t),r=await f.service.captureTab(1);await f.complete(r.id);f.value.blacklist=['example.org'];await f.service.restrict();assert.equal((await f.service.list({})).total,0);await f.service.clear();assert.equal((await f.repository.all('visits')).length,0);assert.equal((await f.repository.all('snapshots')).length,0);assert.equal(f.value.summaryProfile.model,'local-knowledge-fixture');
});
test('deleting one repeated visit clears reviews that quoted its notes while retaining shared raw evidence',async t=>{
 const f=await fixture(t),r=await f.service.captureTab(1);await f.complete(r.id);await f.service.begin(1,{newVisit:true});await f.service.captureTab(1);const visits=(await f.service.list({})).items;await f.service.updateVisit(visits[0].id,{note:'A private note to delete',project:'',tags:''});const d=await f.service.createReview({kind:'day',date:'2026-11-04'});await f.complete(d.id);await f.service.remove([visits[0].id]);assert.equal((await f.repository.all('snapshots')).length,1);assert.equal((await f.repository.get('summaries',d.id)),undefined);assert.equal((await f.service.list({})).total,1);
});

test('daily review waits for already-captured page jobs before its first summary request',async t=>{const f=await fixture(t);f.mode('delayed');const page=await f.service.captureTab(1);await until(()=>f.calls.length===1);const review=await f.service.createReview({kind:'day',date:'2026-11-04'});assert.equal((await f.repository.get('jobs',review.id)).status,'awaiting-input');await f.complete(page.id);await f.complete(review.id);assert.equal(f.calls.length,2);assert.deepEqual((await f.repository.get('summaries',review.id)).sourceIds,[page.id]);});
