import { api, esc, icon, notify } from './common.js';
import { KNOWLEDGE_KINDS, dayKey, zonedTime, shiftDay } from '../lib/knowledge-core.js';
import { knowledgeFiles, knowledgeZip, knowledgeJSONL, knowledgeCSV, knowledgeMarkdown, knowledgeBundleMarkdown } from '../lib/knowledge-export.js';

const draftKey = 'dianyi-reading-drafts';
const remarkDrafts = new Map(), readingViews = new Map();
try {
  for (const [id, value] of JSON.parse(sessionStorage.getItem(draftKey) || '[]')) remarkDrafts.set(id, value);
} catch {}
function saveRemarkDrafts() {
  try { sessionStorage.setItem(draftKey, JSON.stringify([...remarkDrafts])); } catch {}
}
export function clearKnowledgeDrafts() { remarkDrafts.clear(); saveRemarkDrafts(); }
window.addEventListener('beforeunload',event=>{if(remarkDrafts.size){event.preventDefault();event.returnValue='';}});
const phases={queued:'排队中',waiting:'等待处理',streaming:'生成中',classifying:'识别主题中',complete:'已完成',error:'未完成',stopped:'已停止',interrupted:'已中断'};
const download=(data,name,type)=>{const url=URL.createObjectURL(new Blob([data],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);};
const copy=async text=>{try{await navigator.clipboard.writeText(text);}catch{const field=document.createElement('textarea');field.value=text;document.body.append(field);field.select();const ok=document.execCommand('copy');field.remove();if(!ok)throw Error('复制未成功，请选择文本后复制。');}notify('已复制');};
async function htmlBody(markdown){const R=globalThis.DianyiDocs,parsed=R.parse(markdown),holder=document.createElement('div');holder.innerHTML=parsed.html;for(const item of parsed.artifacts){const node=holder.querySelector(`[data-artifact="${item.id}"]`);node?.querySelector('.artifact-head')?.remove();if(item.kind==='mermaid'){try{node.querySelector('.artifact-preview').innerHTML=await R.diagram(item.source);}catch{node.querySelector('.artifact-preview').textContent=item.source;}}node?.querySelector('.artifact-source[hidden]')?.remove();}return holder.innerHTML;}
export function knowledgePreferences(value) {
  return `<section class="card knowledge-preferences"><h2>自动总结与定时回顾</h2><form id="knowledge-preferences"><div class="form-row"><span>自动总结</span><div><label class="check-label"><input type="checkbox" id="auto-summary-setting" ${value.autoSummary?'checked':''}>开启后台网页总结与定时回顾</label><p class="field-help">开启后使用总结模型额度。开关立即生效，手动总结和已有资料保留。</p></div></div><details class="settings-disclosure" id="review-advanced"><summary>时间、时区与回顾提示词</summary><div class="form-row"><label for="knowledge-time">每日生成时间</label><div><input class="input" type="time" id="knowledge-time" value="${esc(value.time)}" required><p class="field-help">按自然日归档；此时生成截至当前的总结。晚间记录下一次补齐，保留版本。</p></div></div><div class="form-row"><label for="knowledge-zone">统计时区</label><div><input class="input" id="knowledge-zone" list="knowledge-zones" value="${esc(value.timeZone)}" required><datalist id="knowledge-zones">${['Asia/Shanghai','Asia/Tokyo','Europe/London','America/New_York','America/Los_Angeles','UTC'].map(v=>`<option value="${v}">`).join('')}</datalist><p class="field-help">电脑休眠或浏览器退出时不会唤醒设备，恢复运行后补办。使用模型库里为总结与回顾选择的连接。</p></div></div>${Object.entries(KNOWLEDGE_KINDS).map(([key,label])=>`<details><summary>${label}提示词</summary><label class="sr-only" for="knowledge-prompt-${key}">${label}提示词</label><textarea class="input" id="knowledge-prompt-${key}" data-knowledge-prompt="${key}" maxlength="6000" placeholder="留空使用内置的主题、依据与待核对问题提示词">${esc(value.prompts?.[key]||'')}</textarea></details>`).join('')}<div class="save-bar"><span>保存后用于后续任务，不重跑已有结果。</span><button class="btn primary" type="submit">保存回顾设置</button></div></details></form></section>`;
}
export function mountKnowledge(host,{type}) {
  const controller=new AbortController(),signal=controller.signal;
  const previous = readingViews.get(type);
  let state, selected = previous?.selected || '', detail, offset = previous?.offset || 0, filter = previous?.filter || {}, kind = previous?.kind || '';
  let readingOpen = previous?.readingOpen || false;
  let busy = false, refreshTimer, filterTimer, sequence = 0, detailSequence = 0;
  const reviewing=type==='reviews';
  const formatTime=ms=>new Intl.DateTimeFormat('zh-CN',{timeZone:state?.prefs.timeZone||'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(ms));
  host.innerHTML = `<div class="page-heading"><h1>${reviewing ? '阅读回顾' : '我的轨迹'}</h1><div class="knowledge-actions">
    <button class="btn" data-k="export">${icon('download')}导出知识</button>${reviewing ? '<button class="btn primary" data-k="generate-open">生成回顾</button>' : ''}
    <details class="action-details"><summary>更多</summary><div class="knowledge-actions"><a class="btn" href="#summary">回顾设置</a>${reviewing ? '' : '<button class="btn danger" data-k="clear-filter">清理筛选结果</button>'}</div></details>
  </div></div>
  <div class="knowledge-queue" role="status" hidden></div>
  <section class="knowledge-tools" aria-label="筛选阅读资料">
    <div class="knowledge-filter-head">
      <label class="search-field" for="knowledge-query">${icon('search')}<input type="search" id="knowledge-query" aria-label="搜索阅读资料" placeholder="搜索标题、备注或主题"></label>
      ${reviewing ? `<label class="sr-only" for="knowledge-kind-filter">回顾类型</label><select class="sort-select" id="knowledge-kind-filter"><option value="">全部回顾</option>${Object.entries(KNOWLEDGE_KINDS).map(([id, label]) => `<option value="${id}">${label}</option>`).join('')}</select>` : ''}
      <button class="btn small" data-k="toggle-filters" aria-controls="knowledge-filters" aria-expanded="false">筛选</button>
    </div>
    <div class="knowledge-chips" aria-label="已应用筛选" hidden></div>
    <div id="knowledge-filters" class="knowledge-filters" hidden>
      <label>起始日期<input class="input" type="date" id="knowledge-from"></label>
      <label>结束日期<input class="input" type="date" id="knowledge-to"></label>
      <label>来源<select class="input" id="knowledge-domain"><option value="">全部网站</option></select></label>
      <label>项目<select class="input" id="knowledge-project"><option value="">全部项目</option></select></label>
      <label>标签<select class="input" id="knowledge-tag"><option value="">全部标签</option></select></label>
      <button class="btn subtle" data-k="reset">清除筛选</button>
    </div>
  </section>
  ${reviewing ? `<dialog class="knowledge-export-dialog knowledge-generate-dialog" aria-labelledby="knowledge-generate-title">
    <h2 id="knowledge-generate-title">生成回顾</h2><p id="knowledge-generation-scope"></p>
    <div class="knowledge-generate">
      <label>周期<select class="input" id="knowledge-kind">${Object.entries(KNOWLEDGE_KINDS).map(([id, label]) => `<option value="${id}">${label}</option>`).join('')}</select></label>
      <label>日期<input class="input" type="date" id="knowledge-date" value="${dayKey(Date.now())}"></label>
      <label>分析维度<select class="input" id="knowledge-dimension">${['主题', '项目', '技术方案', '新闻脉络', '证据与冲突', '待解决问题'].map(value => `<option>${value}</option>`).join('')}</select></label>
    </div><p class="field-help">按当前资料范围生成，可能使用总结模型额度。</p>
    <div class="knowledge-actions"><button class="btn" data-k="generate-close">取消</button><button class="btn primary" data-k="generate">生成回顾</button></div>
  </dialog>` : ''}<div class="knowledge-layout"><section class="knowledge-list" aria-label="${reviewing?'回顾':'轨迹'}列表"><p role="status">正在读取本地记录…</p></section><section class="knowledge-reading" aria-label="记录详情"><p class="muted">选择一条记录，查看总结和来源。</p></section></div><div class="knowledge-pagination"></div><dialog class="knowledge-export-dialog" aria-labelledby="knowledge-export-title"><h2 id="knowledge-export-title">带走你的阅读积累</h2><p>按网页日期、关键词、来源、项目和标签导出资料，保留关联关系。</p><label class="form-label" for="knowledge-export-format">文件格式</label><select class="input" id="knowledge-export-format"><option value="zip">Markdown 知识包（ZIP）</option><option value="jsonl">结构化记录（JSONL）</option><option value="json">完整数据（JSON）</option><option value="md">阅读汇总（Markdown）</option><option value="html">阅读文档（HTML）</option><option value="csv">访问时间线（CSV）</option></select><label class="check-label"><input type="checkbox" id="knowledge-originals">包含已保存的完整原文快照（ZIP / JSON / JSONL）</label><p class="field-help">默认导出摘要与必要元信息，不导出 Key、认证资料和黑名单来源。</p><div class="knowledge-actions"><button class="btn" data-k="export-close">取消</button><button class="btn primary" data-k="export-go">导出文件</button></div></dialog>`;
  const $=s=>host.querySelector(s),R=globalThis.DianyiDocs;
  const filterLabels = { from: '从', to: '至', domain: '来源', project: '项目', tag: '标签' };
  const filterFields = Object.keys(filterLabels);
  function fieldValues() {
    return Object.fromEntries(['query', ...filterFields].map(key => [key, $('#knowledge-' + key).value]));
  }
  const fields = previous?.fields || {};
  for (const [key, value] of Object.entries(fields)) {
    const input = $('#knowledge-' + key);
    if (value && input.tagName === 'SELECT') input.add(new Option(value, value));
    input.value = value;
  }
  if (reviewing) $('#knowledge-kind-filter').value = kind;
  function renderChips() {
    const values = fieldValues(), chips = $('.knowledge-chips');
    chips.innerHTML = filterFields.filter(key => values[key]).map(key => `<button class="btn small subtle" data-k="remove-filter" data-filter-key="${key}" aria-label="移除${filterLabels[key]} ${esc(values[key])}">${filterLabels[key]} ${esc(values[key])} ${icon('close')}</button>`).join('');
    chips.hidden = !chips.childElementCount;
  }
  function collectFilter() {
    const { from, to, ...values } = fieldValues(), zone = state?.prefs.timeZone || 'Asia/Shanghai';
    filter = values;
    if (from) filter.from = zonedTime(from, '00:00', zone);
    if (to) filter.to = zonedTime(shiftDay(to, 1), '00:00', zone);
    renderChips();
    return filter;
  }
  function resetDetail() {
    detailSequence++; selected = ''; detail = null; readingOpen = false; host.classList.remove('knowledge-detail-open');
    $('.knowledge-reading').innerHTML = '<p class="muted">选择一条记录，查看总结和来源。</p>';
  }
  function searchSoon(delay=350){
    clearTimeout(filterTimer);clearTimeout(refreshTimer);sequence++;
    filterTimer=setTimeout(()=>{filterTimer=null;if(signal.aborted)return;collectFilter();offset=0;resetDetail();load().catch(error=>notify(error.message));},delay);
  }
  host.addEventListener('input',event=>{if(event.target.id === 'knowledge-query' && !event.isComposing)searchSoon();},{signal});
  host.addEventListener('compositionend',event=>{if(event.target.id === 'knowledge-query')searchSoon();},{signal});
  host.addEventListener('change',event=>{if(event.target.closest('.knowledge-tools') && event.target.id !== 'knowledge-kind-filter' && event.target.id !== 'knowledge-query')searchSoon(0);},{signal});
  async function load(){const request=++sequence,next=await api('KNOWLEDGE_LIST',{view:type,filter,kind,offset});if(signal.aborted||request!==sequence)return;const first=!state;state=next;if(first&&reviewing)$('#knowledge-date').value=dayKey(Date.now(),next.prefs.timeZone);
    const queue = $('.knowledge-queue');
    queue.hidden = !next.queue.pending && !next.queue.held;
    queue.innerHTML = `<span>${!next.prefs.autoSummary ? '自动总结已关闭 · 手动总结可用' : next.queue.held ? '任务等待处理' : `${next.queue.pending} 个任务待处理`}</span>
      <details><summary>队列详情</summary><p>请求尝试 ${next.queue.requestAttempts} 次${next.prefs.autoSummary ? ' · 每日 ' + esc(next.prefs.time) : ''}</p>${next.queue.error ? `<p>${esc(next.queue.error)}</p>` : ''}${next.queue.held && next.prefs.autoSummary ? '<button class="btn small" data-k="resume">继续后台任务</button>' : ''}</details>`;
    for (const [field, values] of Object.entries(next.facets)) {
      const id = { domains: 'domain', projects: 'project', tags: 'tag' }[field], select = $('#knowledge-' + id), value = select.value, all = select.options[0].text;
      const choices = [...new Set(value ? [value, ...values] : values)];
      select.replaceChildren(new Option(all, ''), ...choices.map(item => new Option(item, item, false, item === value)));
    }
    renderChips();
    $('.knowledge-list').innerHTML=next.items.length?next.items.map(item=>`<button class="knowledge-row ${selected===item.id?'selected':''}" data-k-id="${esc(item.id)}" aria-pressed="${selected===item.id}"><span class="knowledge-row-top"><time>${formatTime(item.date)}</time><span>${esc(phases[item.phase]||item.phase)}</span></span><strong>${esc(item.title||'网页')}</strong><p>${esc(item.excerpt)}</p><span class="knowledge-row-meta">${esc([item.domain,item.project,...item.tags].filter(Boolean).join(' · '))}${item.missing?` · ${item.missing} 条待补齐`:''}</span></button>`).join(''):`<div class="empty"><h2>${reviewing?'还没有生成回顾':'这里会留下你的阅读轨迹'}</h2><p>${reviewing?'选择日期和周期，归纳已保存的阅读资料；开启自动总结后，定时回顾将在设定时间生成。':'手动总结的网页会保存在这里。自动总结默认关闭，可在插件弹窗开启；黑名单网站不记录。'}</p>${!reviewing?'<a class="btn" href="#summary">连接总结模型</a>':''}</div>`;
    $('.knowledge-pagination').innerHTML=`<span>共 ${next.total} 条 · 当前 ${next.offset+1>next.total?0:next.offset+1}–${Math.min(next.offset+40,next.total)}</span><div><button class="btn small" data-k="prev" ${offset?'':'disabled'}>上一页</button><button class="btn small" data-k="next" ${offset+40<next.total?'':'disabled'}>下一页</button></div>`;
    if (selected) {
      try { await show(selected, false); }
      catch (error) { if (error.code !== 'NOT_FOUND') throw error; resetDetail(); }
    }
  }
  async function show(id,focus=true){const sequence=++detailSequence,result=await api('KNOWLEDGE_DETAIL',{id});if(signal.aborted||sequence!==detailSequence||selected&&id!==selected&&!focus)return;if(!focus&&result.visit&&remarkDrafts.has(result.visit.id)&&$('#knowledge-note')){detail=result;return;}selected=id;detail=result;const s=result.summary,v=result.visit,reading=$('.knowledge-reading'),text=s?.text||'',parsed=R.parse(text,{streaming:s?.phase!=='complete'});
    const top=reading.scrollTop || previous?.scrollTop || 0;reading.innerHTML=`<header class="knowledge-detail-head"><button class="btn small subtle knowledge-back" data-k="back">返回列表</button><h2 tabindex="-1">${esc(v?.title||s?.title||s?.source?.title||'网页')}</h2><p>${esc(phases[s?.phase]||'等待处理')}${s?.range?` · ${formatTime(s.range.from)} — ${formatTime(s.range.to)} · ${esc(s.range.timeZone)}`:''}${s?.missing?` · ${s.missing} 条待补齐`:''}</p><div class="knowledge-actions"><button class="btn small" data-k="copy" ${text?'':'disabled'}>复制</button><button class="btn small" data-k="single-export" ${text?'':'disabled'}>导出 Markdown</button><button class="btn small" data-k="retry" ${s||v?.documentId?'':'disabled'}>${s?.phase==='complete'?'重新总结':'重试'}</button>${v?'<button class="btn small danger" data-k="delete">删除记录</button>':''}</div>${s?.error?`<p class="knowledge-error">${esc(s.error)}</p>`:''}${s?.truncated?'<p class="field-help">原网页较长，仅采集了已加载正文的前 60,000 字符。</p>':''}</header><article class="knowledge-doc">${parsed.html||'<p class="muted">已保留访问记录，等待正文或模型任务完成。</p>'}</article><section class="knowledge-sources"><h3>来源与依据</h3>${(v?.source?.url||s?.source?.url)?`<a href="${esc(v?.source?.url||s.source.url)}" target="_blank" rel="noopener noreferrer">${esc(v?.source?.domain||s.source.domain)} · 打开原网页</a>`:''}${result.sources.map(source=>`<button class="link-btn" data-k-source="${esc(source.id)}">${esc(source.title||source.id)}</button>`).join('')}${s?.model?`<p class="field-help">${esc(s.model)} · ${s.requestAttempts||0} 次请求尝试${s.usage?.total_tokens!==undefined?` · 服务返回 ${s.usage.total_tokens} Token`:''}</p>`:''}</section>${result.versions.length>1?`<label>历史版本<select class="input" id="knowledge-version">${result.versions.map(version=>`<option value="${esc(version.id)}" ${s?.id===version.id?'selected':''}>v${version.revision||1} · ${formatTime(version.createdAt)} · ${esc(phases[version.phase]||version.phase)}</option>`).join('')}</select></label>`:''}${v?`<form id="knowledge-note"><h3>我的阅读备注</h3><label for="knowledge-note-project">项目</label><input class="input" id="knowledge-note-project" maxlength="100" value="${esc(v.project||'')}"><label for="knowledge-note-tags">标签（逗号分隔）</label><input class="input" id="knowledge-note-tags" value="${esc((v.tags||[]).join(', '))}"><label for="knowledge-note-text">备注</label><textarea class="input" id="knowledge-note-text" maxlength="6000">${esc(v.note||'')}</textarea><div class="knowledge-actions"><button class="btn" type="submit">保存备注</button><button class="btn subtle" type="button" data-k="discard-note" hidden>丢弃修改</button><span class="field-help" id="knowledge-draft-status" role="status"></span></div></form>`:''}`;
    if(v&&remarkDrafts.has(v.id)){const draft=remarkDrafts.get(v.id);$('#knowledge-note-text').value=draft.note;$('#knowledge-note-project').value=draft.project;$('#knowledge-note-tags').value=draft.tags;reading.querySelector('[data-k=discard-note]').hidden=false;$('#knowledge-draft-status').textContent='有未保存的备注';}
    for(const element of reading.querySelectorAll('[data-kind="mermaid"]')){const item=parsed.artifacts.find(a=>a.id===element.dataset.artifact);R.diagram(item.source).then(svg=>{if(element.isConnected)element.querySelector('.artifact-preview').innerHTML=svg;}).catch(()=>{});}
    reading.scrollTop=focus?0:top;
    if (focus) readingOpen = true;
    host.classList.toggle('knowledge-detail-open', readingOpen);
    if (focus) reading.querySelector('h2').focus({ preventScroll: true });host.querySelectorAll('[data-k-id]').forEach(b=>{b.classList.toggle('selected',b.dataset.kId===id);b.setAttribute('aria-pressed',String(b.dataset.kId===id));});
  }
  async function action(button,work){if(busy)return;busy=true;button.disabled=true;try{await work();}catch(error){notify(error.message);}finally{busy=false;if(button.isConnected)button.disabled=false;}}
  host.addEventListener('click',event=>{const button=event.target.closest('button');if(!button)return;const id=button.dataset.kId||button.dataset.kSource;if(id){action(button,()=>show(id));return;}
    const artifact=button.dataset.artifactAction;if(artifact){const item=R.parse(detail?.summary?.text||'').artifacts.find(a=>a.id===button.closest('[data-artifact]')?.dataset.artifact);if(!item)return;action(button,async()=>{if(artifact==='copy')await copy(item.source);else if(artifact==='source'){const el=button.closest('[data-artifact]'),source=el.querySelector('.artifact-source'),preview=el.querySelector('.artifact-preview');if(source&&preview){source.hidden=!source.hidden;preview.hidden=!source.hidden;}}else if(item.kind==='mermaid')download(await R.diagram(item.source),'图形.svg','image/svg+xml');else if(item.kind==='table')download(R.csv(item.source),'表格.csv','text/csv');else download(item.source,'制品.'+(item.kind==='math'?'tex':item.lang==='javascript'?'js':'txt'),'text/plain');});return;}
    const key=button.dataset.k;if(!key)return;
    if(filterTimer&&['next','prev'].includes(key)){searchSoon(0);return;}
    if(['generate','export','export-go','clear-filter','reset','filter'].includes(key)){clearTimeout(filterTimer);filterTimer=null;}
    action(button,async()=>{
      if(key==='filter'){collectFilter();offset=0;await load();}
      if (key === 'toggle-filters') { const panel = $('#knowledge-filters'); panel.hidden = !panel.hidden; button.setAttribute('aria-expanded', String(!panel.hidden)); }
      if (key === 'back') { readingOpen = false; host.classList.remove('knowledge-detail-open'); (host.querySelector('.knowledge-row.selected') || $('#knowledge-query')).focus(); }
      if (key === 'remove-filter') { $('#knowledge-' + button.dataset.filterKey).value = ''; searchSoon(0); $('#knowledge-query').focus(); }
      if (key === 'reset') {
        for (const key of ['query', ...filterFields]) $('#knowledge-' + key).value = '';
        if (reviewing) $('#knowledge-kind-filter').value = '';
        kind = ''; searchSoon(0); $('#knowledge-query').focus();
      }
      if(key==='next'||key==='prev'){offset=Math.max(0,offset+(key==='next'?40:-40));await load();}
      if(key==='clear-filter'){collectFilter();if(confirm('清理当前筛选范围中的访问记录及不再被引用的摘要？相关回顾也会重新建立，请先导出需要保留的内容。')){await api('KNOWLEDGE_CLEAR',{filter});for(const id of [...remarkDrafts.keys()]){try{await api('KNOWLEDGE_DETAIL',{id});}catch{remarkDrafts.delete(id);}}saveRemarkDrafts();resetDetail();await load();}}
      if(key==='resume'){await api('KNOWLEDGE_RESUME');await load();}
      if (key === 'generate-open') {
        collectFilter();
        const selected = Object.values(fieldValues()).filter(Boolean);
        $('#knowledge-generation-scope').textContent = selected.length ? '当前范围 · ' + selected.join(' · ') : '范围 · 全部已保存的阅读资料';
        $('.knowledge-generate-dialog').showModal();
      }
      if (key === 'generate-close') $('.knowledge-generate-dialog').close();
      if(key==='generate'){collectFilter();const reply=await api('KNOWLEDGE_REVIEW',{kind:$('#knowledge-kind').value,date:$('#knowledge-date').value,dimension:$('#knowledge-dimension').value,filter});selected=reply.id;readingOpen=true;$('.knowledge-generate-dialog').close();await load();notify('回顾已加入任务，完成后保存在本地');}
      if(key==='discard-note'){remarkDrafts.delete(detail.visit.id);saveRemarkDrafts();await show(detail.visit.id);}
      if(key==='copy')await copy(knowledgeMarkdown(detail.summary,{sources:detail.sources}));
      if(key==='single-export')download(knowledgeMarkdown(detail.summary,{sources:detail.sources}),'点译-阅读总结.md','text/markdown;charset=utf-8');
      if(key==='retry'){if(detail.summary&&detail.summary.kind!=='page'){const reply=await api('KNOWLEDGE_REVIEW',{kind:detail.summary.kind,date:detail.summary.range?.start,filter:detail.summary.filter,dimension:detail.summary.dimension,force:true});selected=reply.id;}else await api('KNOWLEDGE_RETRY',{id:detail.visit?.id||detail.summary.id});await load();}
      if(key==='delete'&&confirm('删除这条访问记录？没有其他访问引用的原文、摘要及依赖它的回顾也会一并清理。')){await api('KNOWLEDGE_DELETE',{ids:[detail.visit.id]});remarkDrafts.delete(detail.visit.id);saveRemarkDrafts();resetDetail();await load();}
      if(key==='export')$('.knowledge-export-dialog').showModal();
      if(key==='export-close')$('.knowledge-export-dialog').close();
      if(key==='export-go'){collectFilter();const data=await api('KNOWLEDGE_EXPORT',{filter,originals:$('#knowledge-originals').checked}),format=$('#knowledge-export-format').value,files=knowledgeFiles(data),md=knowledgeBundleMarkdown(data);
        if(format==='zip')download(knowledgeZip(files),'点译-阅读知识.zip','application/zip');
        if(format==='jsonl')download(knowledgeJSONL(data),'点译-阅读知识.jsonl','application/x-ndjson;charset=utf-8');
        if(format==='json')download(JSON.stringify({schemaVersion:1,exportedAt:data.exportedAt,records:knowledgeJSONL(data).split('\n').filter(Boolean).map(line=>JSON.parse(line)),snapshots:data.snapshots,externalSources:data.externalSources},null,2),'点译-阅读知识.json','application/json');
        if(format==='csv')download(knowledgeCSV(data.visits),'点译-阅读轨迹.csv','text/csv;charset=utf-8');
        if(format==='md')download(md,'点译-阅读知识.md','text/markdown;charset=utf-8');
        if(format==='html')download(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none';style-src 'unsafe-inline';img-src data:;base-uri 'none'"><title>点译 · 阅读知识</title><style>body{max-width:760px;margin:40px auto;padding:0 24px;font:16px/1.85 system-ui;color:#263735;overflow-wrap:anywhere}pre{white-space:pre-wrap;background:#f5f7f4;padding:16px}table{border-collapse:collapse}td,th{border:1px solid #dce4df;padding:8px}svg{max-width:100%}.artifact-head{display:none}</style>${await htmlBody(md)}</html>`,'点译-阅读知识.html','text/html;charset=utf-8');
        $('.knowledge-export-dialog').close();notify('知识文件已导出');}
    });
  },{signal});
  host.addEventListener('submit',event=>{if(event.target.id!=='knowledge-note')return;event.preventDefault();event.stopPropagation();const button=event.target.querySelector('button');action(button,async()=>{const id=detail.visit.id,submitted={note:$('#knowledge-note-text').value,project:$('#knowledge-note-project').value,tags:$('#knowledge-note-tags').value};await api('KNOWLEDGE_EDIT',{id,...submitted});if(JSON.stringify(remarkDrafts.get(id))===JSON.stringify(submitted))remarkDrafts.delete(id);saveRemarkDrafts();await load();notify('阅读备注已保存');});},{signal});
  host.addEventListener('input',event=>{if(!event.target.closest('#knowledge-note')||!detail?.visit)return;remarkDrafts.set(detail.visit.id,{note:$('#knowledge-note-text').value,project:$('#knowledge-note-project').value,tags:$('#knowledge-note-tags').value});saveRemarkDrafts();host.querySelector('[data-k=discard-note]').hidden=false;$('#knowledge-draft-status').textContent='有未保存的备注';},{signal});
  host.addEventListener('change',event=>{if(event.target.id==='knowledge-kind-filter'){kind=event.target.value;searchSoon(0);}if(event.target.id==='knowledge-export-format'){const original=$('#knowledge-originals');original.disabled=!['zip','json','jsonl'].includes(event.target.value);if(original.disabled)original.checked=false;}if(event.target.id==='knowledge-version')show(event.target.value).catch(error=>notify(error.message));},{signal});
  const changed=message=>{if(message?.type!=='SHIYI/KNOWLEDGE_CHANGED'||busy||filterTimer||$('#knowledge-note')?.contains(document.activeElement)||host.querySelector('dialog[open]'))return;clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>load().catch(()=>{}),800);};
  chrome.runtime.onMessage.addListener(changed);load().catch(error=>{$('.knowledge-list').innerHTML=`<div class="empty"><h2>读取未完成</h2><p>${esc(error.message)}</p><button class="btn" data-k="filter">重试</button></div>`;});
  return ()=>{readingViews.set(type,{ fields:fieldValues(), filter:collectFilter(), kind, offset, selected, readingOpen, scrollTop: $('.knowledge-reading').scrollTop });controller.abort();clearTimeout(refreshTimer);clearTimeout(filterTimer);chrome.runtime.onMessage.removeListener(changed);};
}
