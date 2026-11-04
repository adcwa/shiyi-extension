import { assert, digest, friendlyError, pageOrigin, permissionPattern } from './core.js';
import { blockingSite } from './site-policy.js';
import { extractSummaryPage } from './summary-extract.js';
import { runSummaryModel } from './summary-model.js';
import { runConnections } from './connections.js';
import { cleanKnowledgePrefs, cleanKnowledgeFilter, DEFAULT_KNOWLEDGE_PREFS, KNOWLEDGE_KINDS, dayKey, period, shiftDay, zonedTime, nextDaily, matchesVisit, evidenceParts, reviewPrompt, plainKnowledgeText, knowledgeSource as safeSource } from './knowledge-core.js';

export function createKnowledgeManager({ chromeApi, settings, repository, permissionGranted, now = () => Date.now() }) {
  const tables = Object.fromEntries(['visits','documents','summaries','jobs','meta'].map(name => [name, new Map()]));
  const bindings = new Map(), captures = new Map(), ports = new Set(), running = new Map();
  let tail = Promise.resolve(), started = false, pumping = false, scheduling = false, healthError='';
  const loaded = (async () => { for (const name of Object.keys(tables)) for (const row of await repository.all(name)) tables[name].set(row.id, row); })();
  const rows = name => [...tables[name].values()];
  function serial(work) { const task = tail.then(() => loaded).then(work); tail = task.catch(() => {}); return task; }
  async function save(updates = {}, removals = {}) {
    try{await repository.write(updates, removals);}catch(error){healthError=friendlyError(error).message;publish();throw error;}
    for (const [name, values] of Object.entries(updates)) if (tables[name]) for (const value of values) tables[name].set(value.id, value);
    for (const [name, ids] of Object.entries(removals)) if (tables[name]) for (const id of ids) tables[name].delete(id);
  }
  const config = () => settings.config();
  const prefs = value => cleanKnowledgePrefs(value.knowledgePrefs || DEFAULT_KNOWLEDGE_PREFS);
  const permitted = (source, value) => !!pageOrigin(source?.url) && !blockingSite(source.url, value.blacklist);
  const leaves = record => record.kind === 'page' ? [record.id] : record.sourceIds || [];
  function valid(record, value) {
    if (!record) return false;
    const pending=[...leaves(record)],seen=new Set();
    while(pending.length){const id=pending.pop();if(seen.has(id))continue;seen.add(id);const leaf=tables.summaries.get(id);if(!leaf||!permitted(leaf.source,value))return false;pending.push(...(leaf.contextIds||[]));}
    return true;
  }
  async function accessible(record) {
    const pending=[...leaves(record)],seen=new Set(),origins=new Set();
    while(pending.length){const id=pending.pop();if(seen.has(id))continue;seen.add(id);const source=tables.summaries.get(id);if(!source)return false;origins.add(permissionPattern(source.source.url));pending.push(...(source.contextIds||[]));}
    return (await Promise.all([...origins].map(origin=>chromeApi.permissions.contains({origins:[origin]})))).every(Boolean);
  }
  function stateFor(tabId) {
    const binding = bindings.get(tabId), visit = tables.visits.get(binding?.visitId);
    const summary = tables.summaries.get(visit?.summaryId);
    if (summary) return { ...summary, tabId, source: visit.source, chars: summary.chars || 0, stale: false,...(visit.error?{phase:'error',error:visit.error}:{}) };
    if (visit) return { id: visit.id, tabId, source: visit.source, phase: visit.error ? 'error' : 'waiting', text: '', error: visit.error || '', chars: 0, preset: 'general' };
    return null;
  }
  function publish() {
    for (const port of ports) { try { port.postMessage({ type: 'state', tabId: port.summaryTab, state: stateFor(port.summaryTab) }); } catch {} }
    chromeApi.runtime.sendMessage({ type: 'SHIYI/KNOWLEDGE_CHANGED' }).catch(() => {});
  }
  async function signature(value, preset) { return digest(JSON.stringify([value.summaryProfile, value.summaryPrefs, preset])); }
  async function begin(tabId, { newVisit = false,tabSnapshot,visitToken } = {}) {
    await loaded;
    const value = await config(), tab = tabSnapshot||await chromeApi.tabs.get(tabId), source = safeSource(tab.url, tab.title);
    if (!permitted(source, value) || !await chromeApi.permissions.contains({origins:[permissionPattern(source.url)]})) return null;
    const identity = await digest(tab.url || '');
    return serial(async () => {
      let binding = bindings.get(tabId);
      if (!binding || binding.identity !== identity || visitToken && binding.visitToken!==visitToken || !visitToken&&newVisit && !binding.loading) {
        const id = crypto.randomUUID(), parent = bindings.get(tab.openerTabId)?.visitId || binding?.visitId || '';
        const visit = { id, visitedAt: now(), source, title: source.title, domain: source.domain, identity, parentId: parent, project: '', tags: [], note: '', summaryId: '', documentId: '' };
        await save({ visits: [visit] }); binding = { visitId: id, identity, loading: tab.status === 'loading',visitToken }; bindings.set(tabId, binding); publish();
      }
      return { tab, binding };
    });
  }
  async function captureTab(tabId, options = {}) {
    const context = await begin(tabId, options); if (!context) return { started: false };
    if (context.tab.status === 'loading' && !options.documentReady) return { started: false };
    const previous = captures.get(tabId);
    if (previous?.binding === context.binding) return previous.task;
    const task = (async () => {
      try {
        const [extracted] = await chromeApi.scripting.executeScript({ target: { tabId, frameIds: [0] }, func: extractSummaryPage });
        const page = extracted?.result;
        if (!page?.url || await digest(page.url) !== context.binding.identity) return { started: false };
        assert(!page.error && page.text?.length >= 20, 'EMPTY_PAGE', page.error || '网页正文尚未加载，已保留访问记录。');
        const value = await config(); if (!permitted(safeSource(page.url), value)) return { started: false };
        const contentHash = await digest(page.text), documentId = await digest(context.binding.identity + ':' + contentHash), preset = options.preset || value.summaryPrefs.preset;
        const sig = await signature(value, preset);
        return serial(async () => {
          let visit = tables.visits.get(context.binding.visitId); if (!visit) return { started: false };
          if(!permitted(safeSource(page.url),await config()))return{started:false};
          if (visit.documentId && visit.documentId !== documentId) {
            visit = { ...visit, id: crypto.randomUUID(), visitedAt: now(), parentId: visit.id, documentId: '', summaryId: '' };
            context.binding.visitId = visit.id;
          }
          const source = safeSource(page.url, page.title), document = { id: documentId, identity: context.binding.identity, contentHash, source, chars: page.chars, truncated: !!page.truncated, capturedAt: now() };
          let summary = !options.force && rows('summaries').filter(s => s.kind === 'page' && !s.invalidated && s.documentId === documentId && s.signature === sig).sort((a,b) => (b.revision||0)-(a.revision||0)||b.createdAt-a.createdAt)[0];
          const updates = { documents: [document], snapshots: [{ id: documentId, text: page.text }], visits: [] };
          if (!summary) {
            const parent = tables.visits.get(visit.parentId), related = tables.summaries.get(parent?.summaryId);
            const contextIds = related?.phase === 'complete' && valid(related, value) ? [related.id] : [];
            summary = { id: crypto.randomUUID(), kind: 'page', logicalKey: `page:${documentId}`,revision:rows('summaries').filter(s=>s.logicalKey===`page:${documentId}`).length+1, documentId, signature: sig, source, contextIds, preset,force:!!options.force,phase: 'queued', text: '', error: '', createdAt: now(), updatedAt: now(), chars: page.chars, truncated: !!page.truncated };
            updates.summaries = [summary]; updates.jobs = [{ id: summary.id, status: 'pending', createdAt: now(), priority: options.force ? 0 : 5 }];
            if(options.force)updates.meta=[{id:'queue',held:false,error:''}];
          }
          updates.visits.push({ ...visit, title: source.title, domain: source.domain, source, documentId, summaryId: summary.id, error: '' });
          await save(updates); context.binding.loading = false; publish(); void pump();
          return { started: summary.phase === 'queued', reused: summary.phase === 'complete', id: summary.id };
        });
      } catch (error) {
        await serial(async () => { const visit = tables.visits.get(context.binding.visitId); if (visit) await save({ visits: [{ ...visit, error: friendlyError(error).message }] }); }); publish();
        return { started: false };
      } finally { if (captures.get(tabId)?.task === task) captures.delete(tabId); }
    })();
    captures.set(tabId, { task, binding: context.binding }); return task;
  }
  async function patchSummary(id, patch, current) {
    return serial(async () => {
      if (current && !current()) return;
      const summary = tables.summaries.get(id); if (!summary) return;
      await save({ summaries: [{ ...summary, ...patch, updatedAt: now() }] }); publish();
    });
  }
  async function inputRecords(summary, value) {
    if (summary.kind === 'page') {
      const snapshot = await repository.get('snapshots', summary.documentId); assert(snapshot?.text, 'NOT_FOUND', '原文快照已被清理，请重新访问网页。');
      const visits=rows('visits').filter(v=>v.summaryId===summary.id),parents=visits.map(v=>tables.visits.get(v.parentId)?.summaryId).filter(id=>id&&id!==summary.id);
      const context = [...new Set([...(summary.contextIds||[]),...parents])].map(id => tables.summaries.get(id)).filter(s => s?.phase === 'complete' && valid(s, value)).slice(0,3).map(s => ({ id: s.id, title: s.source.title, summary: s.text.slice(0, 1800) }));
      await patchSummary(summary.id,{contextIds:context.map(s=>s.id),annotationVisitIds:visits.filter(v=>v.note||v.project||v.tags?.length).map(v=>v.id)});
      return JSON.stringify({ page_title: summary.source.title, page_id: summary.id, original_content: snapshot.text, reading_notes:visits.filter(v=>v.note||v.project||v.tags?.length).slice(-3).map(v=>({note:v.note,project:v.project,tags:v.tags})),related_reading: context });
    }
    assert(valid(summary, value), 'SITE_DISABLED', '来源已删除或加入黑名单，请重新生成这份回顾。');
    const records = (summary.inputIds || []).map(id => tables.summaries.get(id));
    assert(records.every(s => s?.phase === 'complete'), 'DEPENDENCY', '下层摘要尚未完成，请先处理相关任务。');
    const evidence = summary.evidence || records.map(s => ({ id: s.id, title: s.title || s.source?.title || '', text: s.text }));
    const annotations=(summary.annotations||[]).filter(v=>v.note||v.project||v.tags?.length);
    return JSON.stringify({ period: summary.range, dimension: summary.dimension, evidence,annotations });
  }
  async function prepareReduction(summary, value) {
    if (summary.kind === 'page' || summary.evidence) return false;
    const records = summary.inputIds.map(id => tables.summaries.get(id)), groups = evidenceParts(records);
    if (groups.length <= 1) return false;
    assert((summary.reductionDepth||0)<6,'KNOWLEDGE_TOO_LARGE','多轮归纳后资料仍过长，已保留分批结果，请缩小时间或主题范围后重试。');
    await serial(async () => {
      const children = groups.map(evidence => ({ id: crypto.randomUUID(), kind: 'rollup', logicalKey: summary.logicalKey, title: '分批证据整理', inputIds: [], evidence, sourceIds: summary.sourceIds, range: summary.range, dimension: summary.dimension, phase: 'queued', text: '', error: '', createdAt: now(), updatedAt: now() }));
      await save({ summaries: [...children, { ...summary, inputIds: children.map(s => s.id), phase: 'queued',reductionDepth:(summary.reductionDepth||0)+1 }], jobs: [...children.map(s => ({ id: s.id, status: 'pending', priority: 1, createdAt: now() })), { ...tables.jobs.get(summary.id), status: 'pending' }] });
    }); return true;
  }
  async function execute(job) {
    let summary = tables.summaries.get(job.id); if (!summary) return;
    const value = await config();
    if (summary.kind === 'page') assert(permitted(summary.source, value), 'SITE_DISABLED', '此网站已加入黑名单。');
    else assert(valid(summary, value), 'SITE_DISABLED', '来源已删除或加入黑名单。');
    assert(await accessible(summary),'SITE_DISABLED','来源网页访问权限已被移除。');
    if (summary.kind === 'page'&&!summary.force) {
      const sig = await signature(value, summary.preset), cached = rows('summaries').find(s => s.id !== summary.id && !s.invalidated && s.kind === 'page' && s.documentId === summary.documentId && s.signature === sig && s.phase === 'complete');
      if (cached) { await serial(async()=>save({summaries:[{...summary,text:cached.text,phase:'complete',error:'',signature:sig,model:cached.model,completedAt:now(),updatedAt:now()}],jobs:[{...job,status:'complete'}]}));publish();return; }
    }
    if (await prepareReduction(summary, value)) return;
    const controller = new AbortController(), token = { controller }; running.set(job.id, token);
    const current = () => running.get(job.id) === token && !controller.signal.aborted && tables.summaries.has(job.id);
    const heartbeat = setInterval(() => chromeApi.runtime.getPlatformInfo().catch(() => {}), 20000);
    const deadline = setTimeout(() => controller.abort(), 180000);
    try {
      assert(value.summaryConfigured, 'SUMMARY_NOT_CONFIGURED', '请从原入口的总结设置连接模型。访问资料已保存在本地。');
      const input = await inputRecords(summary, value);
      const latestPolicy=await config();assert(valid(tables.summaries.get(job.id),latestPolicy)&&await accessible(tables.summaries.get(job.id)),'SITE_DISABLED','来源或上下文权限已变化，本次不会发送资料。');
      const sig = summary.kind === 'page' ? await signature(value, summary.preset) : summary.semanticFilter?await digest(JSON.stringify([summary.kind,summary.range.key,summary.semanticFilter,summary.dimension,summary.sourceIds.map(id=>[id,tables.summaries.get(id)?.updatedAt]),(summary.annotations||[]).map(v=>[v.id,v.note,v.project,v.tags]),prefs(value).prompts,value.summaryProfile])):summary.signature;
      await patchSummary(job.id, { phase: 'streaming', text: '', error: '', signature: sig }, current);
      let emitted = false, text = '', lastWrite = 0;
      const summaryPrefs = summary.kind === 'page' ? value.summaryPrefs : { ...value.summaryPrefs, prompts: { ...value.summaryPrefs.prompts, general: reviewPrompt(summary.kind, prefs(value), summary.dimension) } };
      await runConnections({ value, purpose: 'summary', signal: controller.signal, allowBackup: () => !emitted,
        resolve: async profile => { const connection = await settings.resolveSummaryProfile(profile); assert(await permissionGranted(profile), 'MODEL_PERMISSION', '请在总结设置重新授权这个连接。'); return connection; },
        onSelected: ({ profile, backup }) => { void patchSummary(job.id, { model: profile.model, connectionName: profile.name, connectionFallback: backup }, current); },
        run: connection => runSummaryModel({ ...connection, text: input, preset: summary.kind === 'page' ? summary.preset : 'general', prefs: summaryPrefs, signal: controller.signal,
          onRequest:()=>{void serial(async()=>{const s=tables.summaries.get(job.id);if(current()&&s)await save({summaries:[{...s,requestAttempts:(s.requestAttempts||0)+1}]});});},
          onUsage:usage=>{const safe=Object.fromEntries(['prompt_tokens','completion_tokens','total_tokens'].filter(k=>Number.isFinite(usage[k])&&usage[k]>=0).map(k=>[k,usage[k]]));void patchSummary(job.id,{usage:safe},current);},
          onPhase: patch => { void patchSummary(job.id, patch, current); },
          onDelta: chunk => { if (chunk) emitted = true; text += chunk; if (now() - lastWrite > 250) { lastWrite = now(); void patchSummary(job.id, { text }, current); } }
        }) });
      const latest = await config(); assert(valid(tables.summaries.get(job.id), latest), 'SITE_DISABLED', '来源已删除或被停用，结果不会写回。');
      const missing = (summary.visitIds || []).filter(id => { const v=tables.visits.get(id); return !v?.summaryId || tables.summaries.get(v.summaryId)?.phase!=='complete'; }).length;
      await patchSummary(job.id, { phase: 'complete', text, error: '', missing, completedAt: now() }, current);
      await serial(async () => { if (current()) await save({ jobs: [{ ...job, status: 'complete' }] }); });
    } catch (error) {
      const failure = friendlyError(error), waiting = /^(MISSING_KEY|SUMMARY_NOT_CONFIGURED|MODEL_PERMISSION|CODEX_PERMISSION)$/.test(error.code);
      await patchSummary(job.id, { phase: waiting ? 'waiting' : controller.signal.aborted ? 'stopped' : 'error', error: controller.signal.aborted ? '生成已停止，已保留内容。' : failure.message }, () => tables.summaries.has(job.id) && running.get(job.id) === token);
      await serial(async () => { if (tables.jobs.has(job.id) && running.get(job.id)===token) await save({ jobs: [{ ...job, status: waiting ? 'waiting' : 'error' }] }); });
      if (waiting || error.connectionsExhausted) await serial(async () => { await save({ meta: [{ id: 'queue', held: true, error: failure.message }] }); });
    } finally { clearInterval(heartbeat); clearTimeout(deadline); if (running.get(job.id) === token) running.delete(job.id); publish(); }
  }
  async function pump() {
    await loaded; if (!started || pumping || healthError||tables.meta.get('queue')?.held) return;
    pumping = true;
    try {
      while (!healthError&&!tables.meta.get('queue')?.held) {
        for(const waiting of rows('jobs').filter(j=>j.status==='awaiting-input')){
          const summary=tables.summaries.get(waiting.id);if(!summary)continue;
          const visits=(summary.visitIds||[]).map(id=>tables.visits.get(id)).filter(Boolean);
          if(visits.some(v=>['pending','running','waiting'].includes(tables.jobs.get(v.summaryId)?.status)))continue;
          const value=await config(),p=prefs(value),allowed=visits.filter(v=>permitted(v.source,value));
          const sourceIds=[...new Set(allowed.map(v=>v.summaryId))].filter(id=>tables.summaries.get(id)?.phase==='complete'&&valid(tables.summaries.get(id),value));
          let inputIds=sourceIds;
          if(['week','month','year'].includes(summary.kind)&&sourceIds.length){const lower=summary.kind==='year'?'month':'day',dates=[...new Set(allowed.map(v=>lower==='month'?dayKey(v.visitedAt,summary.range.timeZone).slice(0,7)+'-01':dayKey(v.visitedAt,summary.range.timeZone)))];inputIds=[];for(const date of dates){const child=await createReview({kind:lower,date,filter:summary.filter});inputIds.push(child.id);}}
          const signatureValue=await digest(JSON.stringify([summary.kind,summary.range.key,summary.semanticFilter,summary.dimension,sourceIds.map(id=>[id,tables.summaries.get(id)?.updatedAt]),allowed.map(v=>[v.id,v.note,v.project,v.tags]),p.prompts,value.summaryProfile]));
          const missing=allowed.filter(v=>!v.summaryId||tables.summaries.get(v.summaryId)?.phase!=='complete').length;
          await serial(async()=>{if(!tables.summaries.has(summary.id))return;await save({summaries:[{...summary,sourceIds,inputIds,annotations:allowed.map(v=>({id:v.id,source_id:v.summaryId,note:v.note,project:v.project,tags:v.tags})),signature:signatureValue,missing,phase:sourceIds.length?'queued':'complete',text:sourceIds.length?'':`本期暂无已完成的页面摘要${missing?`，${missing} 条资料仍需处理`:''}。`,updatedAt:now()}],jobs:[{...waiting,status:sourceIds.length?'pending':'complete'}]});});publish();
        }
        const job = rows('jobs').filter(j => j.status === 'pending' && (tables.summaries.get(j.id)?.inputIds || []).every(id => tables.summaries.get(id)?.phase === 'complete')).sort((a,b) => a.priority-b.priority || a.createdAt-b.createdAt)[0];
        if (!job) {
          const blocked=rows('jobs').filter(j=>j.status==='pending'&&(tables.summaries.get(j.id)?.inputIds||[]).some(id=>['error','stopped','interrupted','waiting'].includes(tables.summaries.get(id)?.phase)));
          if(blocked.length)await serial(async()=>save({jobs:blocked.map(j=>({...j,status:'dependency'})),summaries:blocked.map(j=>({...tables.summaries.get(j.id),phase:'waiting',error:'下层资料尚未完成，请处理相关记录后重新生成此回顾。'}))}));
          if(blocked.length)publish();break;
        }
        await serial(async () => save({ jobs: [{ ...job, status: 'running' }] }));
        try { await execute(job); } catch (error) {
          await patchSummary(job.id, { phase: 'error', error: friendlyError(error).message });
          await serial(async () => { if (tables.jobs.has(job.id)) await save({ jobs: [{ ...job, status: 'error' }] }); });
        }
      }
    } finally { pumping = false; }
  }
  async function resume() {
    await serial(async () => { await save({ meta: [{ id: 'queue', held: false, error: '' }], jobs: rows('jobs').filter(j => j.status === 'waiting').map(j => ({ ...j, status: 'pending' })) }); }); void pump();
    healthError='';void pump();
  }
  async function select(filter = {}) {
    await loaded; const value = await config(), cleaned = cleanKnowledgeFilter(filter);
    return rows('visits').filter(v => permitted(v.source, value) && matchesVisit(v,{...cleaned,query:''})&&(!cleaned.query||matchesVisit(v,{query:cleaned.query})||`${tables.summaries.get(v.summaryId)?.topic||''} ${tables.summaries.get(v.summaryId)?.text||''}`.toLocaleLowerCase().includes(cleaned.query.toLocaleLowerCase()))).sort((a,b) => b.visitedAt-a.visitedAt);
  }
  async function createReview(input = {}) {
    await loaded; const value = await config(), p = prefs(value), kind = input.kind || 'day';
    assert(Object.hasOwn(KNOWLEDGE_KINDS, kind), 'INVALID_INPUT', '请选择日、周、月、年或专题。');
    const range = kind === 'analysis' ? { kind, key: 'analysis', label: '专题分析', from: 0, to: now()+1, timeZone: p.timeZone } : period(kind, input.date || dayKey(now(), p.timeZone), p.timeZone);
    const filter = cleanKnowledgeFilter({ ...input.filter, from: Math.max(input.filter?.from ?? range.from,range.from), to: Math.min(input.filter?.to ?? range.to,range.to, now()+1) });
    const visits = await select(filter), sourceIds = [...new Set(visits.map(v => v.summaryId).filter(Boolean))].filter(id => tables.summaries.get(id)?.phase==='complete' && valid(tables.summaries.get(id), value));
    const semanticFilter={...filter,from:Math.max(input.filter?.from??range.from,range.from),to:kind==='analysis'?(input.filter?.to??null):Math.min(input.filter?.to??range.to,range.to)};
    const signatureValue = await digest(JSON.stringify([kind, range.key, semanticFilter, input.dimension || '主题', sourceIds.map(id => [id, tables.summaries.get(id)?.updatedAt]),visits.map(v=>[v.id,v.note,v.project,v.tags]), p.prompts, value.summaryProfile]));
    const logicalKey = kind === 'analysis' ? `analysis:${signatureValue}` : range.key;
    const existing = rows('summaries').filter(s => s.logicalKey === logicalKey && s.signature === signatureValue && s.kind === kind).sort((a,b)=>(b.revision||0)-(a.revision||0)||b.createdAt-a.createdAt)[0];
    const retryFailed=input.retryFailed&&existing&&['error','stopped','interrupted','waiting'].includes(existing.phase);
    if (existing && !input.force&&!retryFailed) return { id: existing.id, reused: true };
    const missing = visits.filter(v => !v.summaryId || tables.summaries.get(v.summaryId)?.phase !== 'complete').length;
    const awaiting=visits.some(v=>['pending','running','waiting'].includes(tables.jobs.get(v.summaryId)?.status));
    let inputIds = sourceIds;
    if (['week','month','year'].includes(kind) && sourceIds.length&&!awaiting) {
      const lower = kind === 'year' ? 'month' : 'day';
      const dates = [...new Set(visits.map(v => lower === 'month' ? dayKey(v.visitedAt, p.timeZone).slice(0,7)+'-01' : dayKey(v.visitedAt, p.timeZone)))];
      inputIds = [];
      for (const date of dates) { const child = await createReview({ kind: lower, date,retryFailed:input.force||input.retryFailed, filter:{...input.filter,from:Math.max(input.filter?.from??range.from,range.from),to:Math.min(input.filter?.to??range.to,range.to)} }); inputIds.push(child.id); }
    }
    const title = `${range.label} · ${KNOWLEDGE_KINDS[kind]}`, id = crypto.randomUUID();
    const summary = { id, kind, logicalKey, signature: signatureValue,semanticFilter,title, range: { ...range, to: filter.to, from: filter.from }, sourceIds, inputIds, missing, annotations:visits.map(v=>({id:v.id,source_id:v.summaryId,note:v.note,project:v.project,tags:v.tags})),visitIds:visits.map(v=>v.id),visitCount: visits.length, dimension: String(input.dimension || '主题').slice(0, 80), filter, phase: sourceIds.length||awaiting ? 'queued' : 'complete', text: sourceIds.length||awaiting ? '' : missing ? `本期有 ${missing} 条资料尚未完成总结，可在处理完成后更新。` : '本期暂无符合条件的阅读资料。', error: '', createdAt: now(), updatedAt: now(), preset: 'general' };
    let resultId=id;
    await serial(async () => {const duplicate=!input.force&&rows('summaries').filter(s=>s.kind===kind&&s.logicalKey===logicalKey&&s.signature===signatureValue&&!(input.retryFailed&&['error','stopped','interrupted','waiting'].includes(s.phase))).sort((a,b)=>b.createdAt-a.createdAt)[0];if(duplicate){resultId=duplicate.id;return;}summary.revision=rows('summaries').filter(s=>s.logicalKey===logicalKey&&s.kind===kind).length+1;await save({ summaries: [summary], ...(sourceIds.length||awaiting ? { jobs: [{ id, status: awaiting?'awaiting-input':'pending', priority: 3, createdAt: now() }] } : {}) });}); publish(); void pump(); return { id:resultId };
  }
  async function runDue({catchup=false}={}) {
    await loaded; if (scheduling) return; scheduling = true;
    try {
      const value = await config(), p = prefs(value), today = dayKey(now(), p.timeZone);
      await chromeApi.alarms.create('dianyi-knowledge-daily', { when: nextDaily(now(), p) });
      const dates = [...new Set((await select()).map(v => dayKey(v.visitedAt, p.timeZone)))].sort();
      const periods = new Map();
      for (const date of dates) {
        if (date === today && now() < zonedTime(today, p.time, p.timeZone)) continue;
        if(catchup&&date===today&&rows('summaries').some(s=>s.kind==='day'&&s.logicalKey===`day:${date}`))continue;
        await createReview({ kind: 'day', date });
        for (const kind of ['week','month','year']) {
          const r = period(kind, date, p.timeZone);
          if (r.to <= now() || shiftDay(r.end,-1) === today && now() >= zonedTime(today,p.time,p.timeZone)) periods.set(r.key, { kind, date });
        }
      }
      for (const spec of [...periods.values()].sort((a,b) => ['week','month','year'].indexOf(a.kind)-['week','month','year'].indexOf(b.kind))) {const r=period(spec.kind,spec.date,p.timeZone);if(catchup&&shiftDay(r.end,-1)===today&&rows('summaries').some(s=>s.logicalKey===r.key))continue;await createReview(spec);}
    } finally { scheduling = false; }
  }
  async function restrict() {
    await loaded; const value = await config();
    for(const [tabId,binding]of bindings){const visit=tables.visits.get(binding.visitId);if(visit&&!permitted(visit.source,value))bindings.delete(tabId);}
    for (const [id, token] of running) if (!valid(tables.summaries.get(id), value)) { running.delete(id); token.controller.abort(); }
    await serial(async () => {
      const denied = rows('jobs').filter(j => !valid(tables.summaries.get(j.id), value));
      await save({ jobs: denied.map(j => ({ ...j, status: 'canceled' })), summaries: denied.map(j => ({ ...tables.summaries.get(j.id), phase: 'stopped', invalidated:true,error: '来源已加入黑名单，任务已取消。', updatedAt: now() })) });
    }); publish();
  }
  async function updateVisit(id, input) {
    const visit = tables.visits.get(id); assert(visit, 'NOT_FOUND', '访问记录已不存在。');
    assert(typeof input.note === 'string' && input.note.length <= 6000 && typeof input.project === 'string' && input.project.length <= 100, 'INVALID_INPUT', '备注最多 6000 字符，项目最多 100 字符。');
    const tags = [...new Set(String(input.tags || '').split(/[,，]/).map(v => v.trim()).filter(Boolean))];
    assert(tags.length <= 20 && tags.every(v => v.length <= 40), 'INVALID_INPUT', '最多 20 个标签，每个不超过 40 字符。');
    await serial(async () => save({ visits: [{ ...visit, note: input.note, project: input.project.trim(), tags }] })); publish();
  }
  async function remove(ids) {
    await loaded; assert(Array.isArray(ids) && ids.length <= 500 && ids.every(id => typeof id === 'string'), 'INVALID_INPUT', '请每次选择不超过 500 条记录。');
    await serial(async () => {
      const deleted = rows('visits').filter(v => ids.includes(v.id)), documentIds = [...new Set(deleted.map(v => v.documentId).filter(Boolean))].filter(id => !rows('visits').some(v => !ids.includes(v.id) && v.documentId === id));
      const leafIds = rows('summaries').filter(s => s.kind === 'page' && documentIds.includes(s.documentId)).map(s => s.id);
      const affectedSet=new Set([...leafIds,...rows('summaries').filter(s=>[...(s.visitIds||[]),...(s.annotationVisitIds||[])].some(id=>ids.includes(id))).map(s=>s.id)]);let expanded=true;
      while(expanded){expanded=false;for(const s of rows('summaries'))if(!affectedSet.has(s.id)&&[...leaves(s),...(s.contextIds||[]),...(s.inputIds||[])].some(id=>affectedSet.has(id))){affectedSet.add(s.id);expanded=true;}}
      const affected=[...affectedSet];
      for (const id of affected) { const token = running.get(id); running.delete(id); token?.controller.abort(); }
      const changedVisits=rows('visits').filter(v=>!ids.includes(v.id)&&affectedSet.has(v.summaryId)).map(v=>({...v,summaryId:'',error:'引用来源已删除，可以重新总结已保存的原文。'}));
      await save({visits:changedVisits}, { visits: ids, documents: documentIds, snapshots: documentIds, summaries: affected, jobs: affected });
      for (const [tabId,binding] of bindings) if (ids.includes(binding.visitId)) bindings.delete(tabId);
    }); publish();
  }
  async function detail(id) {
    await loaded; const value = await config(), visit = tables.visits.get(id), summary = tables.summaries.get(visit?.summaryId || id);
    assert(visit ? permitted(visit.source,value) : valid(summary,value), 'NOT_FOUND', '资料已删除或来源已被停用。');
    const sources = (summary?.kind === 'page' ? summary.contextIds || [] : summary?.sourceIds || []).map(id => tables.summaries.get(id)).filter(s => valid(s,value)).map(s => ({ id:s.id, title:s.source?.title||s.title, url:s.source?.url||'', phase:s.phase }));
    return { visit, summary:visit?.error&&summary?{...summary,phase:'error',error:visit.error}:summary, sources, versions: summary ? rows('summaries').filter(s => s.logicalKey === summary.logicalKey && s.kind === summary.kind && valid(s,value)).sort((a,b)=>(a.revision||0)-(b.revision||0)||a.createdAt-b.createdAt).map(s => ({id:s.id,createdAt:s.createdAt,phase:s.phase,revision:s.revision})) : [] };
  }
  async function clear(filter) {
    await loaded;const visits=filter?await select(filter):rows('visits');
    for(let at=0;at<visits.length;at+=500)await remove(visits.slice(at,at+500).map(v=>v.id));
    if(!filter)await serial(async()=>{for(const token of running.values())token.controller.abort();running.clear();await save({meta:[{id:'queue',held:false,error:''}]},{summaries:rows('summaries').map(s=>s.id),jobs:rows('jobs').map(j=>j.id),documents:rows('documents').map(d=>d.id),snapshots:await repository.keys('snapshots')});});healthError='';publish();return{removed:visits.length};
  }
  async function list(input = {}) {
    const visits = await select(input.filter), value = await config();
    const isReviews=input.view==='reviews'||input.type==='reviews';
    const f=cleanKnowledgeFilter(input.filter),selectedSources=new Set(visits.map(v=>v.summaryId));
    const records = isReviews ? rows('summaries').filter(s => Object.hasOwn(KNOWLEDGE_KINDS,s.kind) && valid(s,value) && (!input.kind||s.kind===input.kind)&&(!f.query||`${s.title} ${s.dimension} ${s.text}`.toLocaleLowerCase().includes(f.query.toLocaleLowerCase()))&&(!f.from||(s.range?.to||s.createdAt)>=f.from)&&(!f.to||(s.range?.from||s.createdAt)<f.to)&&(!(f.domain||f.project||f.tag)||s.sourceIds.some(id=>selectedSources.has(id)))).sort((a,b)=>b.createdAt-a.createdAt) : visits;
    const offset = Math.max(0,Math.min(100000,Number(input.offset)||0)), shown = records.slice(offset,offset+40);
    return { total: records.length, offset, items: shown.map(v => { const s = isReviews?v:tables.summaries.get(v.summaryId); return { id:v.id,title:v.title||v.source?.title,domain:v.domain||'',date:v.visitedAt||v.createdAt,kind:s?.kind,phase:v.error?'error':s?.phase||'waiting',excerpt:plainKnowledgeText(s?.text||v.error||'等待正文或模型连接').slice(0,180),project:v.project||'',tags:v.tags||[],missing:s?.missing||0 }; }), facets: { domains:[...new Set(visits.map(v=>v.domain))],projects:[...new Set(visits.map(v=>v.project).filter(Boolean))],tags:[...new Set(visits.flatMap(v=>v.tags||[]))] }, queue:{ pending:rows('jobs').filter(j=>['pending','running','waiting','awaiting-input','dependency'].includes(j.status)).length,held:!!healthError||!!tables.meta.get('queue')?.held,error:healthError||tables.meta.get('queue')?.error||'',requestAttempts:rows('summaries').reduce((n,s)=>n+(s.requestAttempts||0),0) }, prefs:prefs(value) };
  }
  async function exportData(filter = {}, originals = false) {
    const visits = await select(filter), value = await config(), docIds = new Set(visits.map(v=>v.documentId)),visitIds=new Set(visits.map(v=>v.id)),selectedSummaries=new Set(visits.map(v=>v.summaryId)),whole=Object.keys(cleanKnowledgeFilter(filter)).length===0;
    const summaries = rows('summaries').filter(s => valid(s,value) && (s.kind==='page' ? (whole?docIds.has(s.documentId):selectedSummaries.has(s.id)) : Object.hasOwn(KNOWLEDGE_KINDS,s.kind)&&(s.visitIds||[]).every(id=>visitIds.has(id))&&s.sourceIds?.every(id=>docIds.has(tables.summaries.get(id)?.documentId))));
    const selectedIds=new Set(summaries.map(s=>s.id));let expanded=true;while(expanded){expanded=false;for(const s of [...summaries])for(const id of s.inputIds||[]){const node=tables.summaries.get(id);if(node?.kind==='rollup'&&!selectedIds.has(id)&&valid(node,value)){summaries.push(node);selectedIds.add(id);expanded=true;}}}
    const documents = rows('documents').filter(d=>docIds.has(d.id));
    const snapshots = originals ? (await Promise.all([...docIds].filter(Boolean).map(id=>repository.get('snapshots',id)))).filter(Boolean) : [];
    const included=new Set(summaries.map(s=>s.id));const references=[...new Set(summaries.flatMap(s=>[...(s.sourceIds||[]),...(s.contextIds||[]),...(s.inputIds||[])]))];
    const externalSources=references.filter(id=>!included.has(id)).map(id=>tables.summaries.get(id)).filter(s=>valid(s,value)).map(s=>({id:s.id,title:s.source?.title||s.title,url:s.source?.url||''}));
    for(const id of new Set(visits.map(v=>v.parentId).filter(id=>id&&!visitIds.has(id)))){const v=tables.visits.get(id);if(v&&permitted(v.source,value))externalSources.push({id,title:v.title,url:v.source.url});}
    const payload={ schemaVersion:1, exportedAt:now(),timeZone:prefs(value).timeZone,visits:visits.map(v=>valid(tables.summaries.get(v.summaryId),value)?v:{...v,summaryId:''}),documents,summaries,snapshots,externalSources };
    assert(JSON.stringify(payload).length<=16000000,'KNOWLEDGE_EXPORT_TOO_LARGE','本批导出资料较大，请缩小日期或项目范围，或取消包含完整原文后分批导出。');return payload;
  }
  function stop(idOrTab, reason = '生成已停止，内容已保留。') {
    const id = typeof idOrTab==='number' ? stateFor(idOrTab)?.id : idOrTab, token=running.get(id); running.delete(id);token?.controller.abort();
    void serial(async()=> { const s=tables.summaries.get(id),j=tables.jobs.get(id);if(s&&j)await save({summaries:[{...s,phase:'stopped',error:reason,updatedAt:now()}],jobs:[{...j,status:'stopped'}]}); }).then(publish);
  }
  async function retry(id) {
    await loaded;const visit=tables.visits.get(id);let s=tables.summaries.get(visit?.summaryId||id);const value=await config();
    if(!s&&visit?.documentId){const doc=tables.documents.get(visit.documentId);assert(doc,'NOT_FOUND','原文记录已不存在。');s={kind:'page',logicalKey:`page:${doc.id}`,documentId:doc.id,source:doc.source,chars:doc.chars,truncated:doc.truncated,preset:value.summaryPrefs.preset,contextIds:[]};}
    assert(s,'NOT_FOUND','记录已不存在。');assert(permitted(s.source,value),'SITE_DISABLED','来源已被停用。');
    if(s.id&&s.phase!=='complete')stop(s.id);const newId=crypto.randomUUID(),contextIds=(s.contextIds||[]).filter(id=>valid(tables.summaries.get(id),value));
    await serial(async()=>save({summaries:[{...s,id:newId,revision:rows('summaries').filter(row=>row.logicalKey===s.logicalKey).length+1,contextIds,force:true,phase:'queued',invalidated:false,text:'',error:'',createdAt:now(),updatedAt:now()}],jobs:[{id:newId,status:'pending',priority:0,createdAt:now()}],visits:rows('visits').filter(v=>visit?v.id===visit.id:v.summaryId===id).map(v=>({...v,summaryId:newId,error:''})),meta:[{id:'queue',held:false,error:''}]}));healthError='';void pump();return{id:newId};
  }
  async function initialize() {
    await loaded;
    await serial(async()=> { const interrupted=rows('jobs').filter(j=>j.status==='running');await save({ jobs:interrupted.map(j=>({...j,status:tables.summaries.get(j.id)?.phase==='complete'?'complete':'error'})),summaries:interrupted.filter(j=>tables.summaries.get(j.id)?.phase!=='complete').map(j=>({...tables.summaries.get(j.id),phase:'interrupted',error:'后台中断，内容已保留；可在轨迹中重试。'})) }); });
    started=true;await chromeApi.alarms.create('dianyi-knowledge-queue',{periodInMinutes:1});await runDue({catchup:true});void pump();
  }
  return { initialize, begin, captureTab, restrict, resume, runDue, pump, createReview,list, detail, updateVisit, remove,clear, exportData, retry, stop,
    start: (tabId,preset)=>captureTab(tabId,{preset,force:true,documentReady:true}), ensure:(tabId,preset)=>captureTab(tabId,{preset,documentReady:true}),
    snapshot: async tabId=>{await loaded;return stateFor(tabId);},
    connect(port,tabId) { port.summaryTab=tabId;ports.add(port);port.onMessage.addListener(message=>{if(message?.type==='bind'&&message.tabId===tabId)loaded.then(publish);});port.onDisconnect.addListener(()=>ports.delete(port)); },
    cancelAll(reason) { for(const id of running.keys())stop(id,reason); }, invalidate:()=>{}, removeTab:tabId=>bindings.delete(tabId),
    scheduleNext:async()=>{const p=prefs(await config());await chromeApi.alarms.create('dianyi-knowledge-daily',{when:nextDaily(now(),p)});}
  };
}
