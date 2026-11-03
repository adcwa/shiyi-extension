(() => {
  'use strict';
  const $=selector=>document.querySelector(selector),D=window.DianyiDemo,R=window.DianyiDocs,S=window.DianyiStream;
  const esc=R.escape;
  const glyphs={logo:'M5 10 4 3l6 4h4l6-4-1 7c5 8 0 11-7 11S0 18 5 10ZM8 13h.01M16 13h.01m-6 3 2 1 2-1m-2 1v2',close:'m6 6 12 12M6 18 18 6',settings:'m9 3-1 3-3 1-2 3 2 2v3l3 2 1 3h6l1-3 3-2v-3l2-2-2-3-3-1-1-3ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',book:'M12 6C9 4 5 4 3 5v14c3-1 6 0 9 2 3-2 6-3 9-2V5c-3-1-6-1-9 1Zm0 0v15',back:'m14 5-7 7 7 7',file:'M6 3h8l4 4v14H6V3Zm8 0v5h5M9 12h6M9 16h6',spark:'m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z',copy:'M8 8h12v13H8V8ZM4 16H2V3h12v2',download:'M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5',check:'m5 12 4 4L19 6',alert:'M12 3 2 21h20L12 3Zm0 6v5m0 3h.01',arrow:'M5 12h14m-6-6 6 6-6 6',stop:'M6 6h12v12H6Z',edit:'m15 4 5 5M4 20l5-1L21 7l-5-5L4 14v6Z',trash:'M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7',up:'M6 18 18 6M6 6h12v12'};
  const icon=name=>`<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${glyphs[name]||glyphs.file}"/></svg>`;
  glyphs.eye='M2 12S6 5 12 5s10 7 10 7-4 7-10 7S2 12 2 12ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z';
  const languages={'zh-CN':'简体中文',en:'English',ja:'日本語',ko:'한국어',fr:'Français',de:'Deutsch',es:'Español'};
  const providers={qwen:{name:'通义千问',endpoint:'https://dashscope.aliyuncs.com/compatible-mode/v1',summary:'qwen-flash',translation:'qwen-mt-flash',keyUrl:'https://help.aliyun.com/zh/model-studio/get-api-key'},deepseek:{name:'DeepSeek',endpoint:'https://api.deepseek.com',summary:'deepseek-flash',translation:'deepseek-flash',keyUrl:'https://platform.deepseek.com/'},openai:{name:'OpenAI',endpoint:'https://api.openai.com/v1',summary:'gpt-6-luna',translation:'gpt-6-luna',keyUrl:'https://platform.openai.com/'},custom:{name:'自定义服务',endpoint:'',summary:'',translation:'',keyUrl:''}};
  const newSummary=()=>({phase:'idle',text:'',kind:'',topic:'',view:'content',source:D.title,url:D.url,error:'',confirm:false});
  const defaultModel=scope=>({provider:'qwen',model:providers.qwen[scope],endpoint:providers.qwen.endpoint,ready:true,remember:false});
  const state={open:true,mode:'summary',screen:'main',preset:'auto',focus:'',scene:'normal',summary:newSummary(),models:{summary:defaultModel('summary'),translation:defaultModel('translation')},modelScope:'summary',draft:null,modelMessage:'',modelBusy:false,terms:D.terms.map(term=>({...term})),query:'',editing:'',translation:false,translationMode:'bilingual',target:'zh-CN',display:'hover',blacklisted:false,modelFocus:false,changed:false,promptOverrides:{},controller:null,follow:true,artifacts:new Map(),copyTarget:null,selectedText:'',deleted:null};
  let noticeTimer,hoverTimer,generation=0;
  const sourceViews=new Set();
  const readingPositions=new Map();
  function rememberReadingPosition(){
    const scroller=$('#summary-scroller');if(!scroller||!scroller.clientHeight)return;
    const children=[...scroller.querySelector('#summary-doc').children],top=scroller.getBoundingClientRect().top;
    const index=children.findIndex(node=>node.getBoundingClientRect().bottom>top+4);
    readingPositions.set(scroller.dataset.resultId+':'+scroller.dataset.resultView,{top:scroller.scrollTop,index,offset:index<0?0:children[index].getBoundingClientRect().top-top});
    if(readingPositions.size>12)readingPositions.delete(readingPositions.keys().next().value);
  }
  function restoreReadingPosition(){
    const scroller=$('#summary-scroller');if(!scroller)return;
    if(state.summary.phase==='idle'){scroller.scrollTop=0;return;}
    const previous=readingPositions.get(generation+':'+state.summary.view);if(!previous)return;
    const anchor=scroller.querySelector('#summary-doc').children[previous.index];
    if(anchor)scroller.scrollTop+=anchor.getBoundingClientRect().top-scroller.getBoundingClientRect().top-previous.offset;
    else scroller.scrollTop=previous.top;
  }
  $('#source-article').innerHTML=D.article;
  const headings=['保留网页，让理解更近一步。','先阅读、识别，再总结','让读者掌控生成过程','让制品回到它的依据'];
  $('#source-article').querySelectorAll('h1,h2').forEach((node,index)=>{node.classList.add('translatable');node.dataset.translate=headings[index]||node.textContent;});
  function toast(text,undo){clearTimeout(noticeTimer);$('#notice').hidden=false;$('#notice').innerHTML=`<span>${esc(text)}</span>${undo?'<button type="button" data-action="undo-delete">撤销</button>':''}`;noticeTimer=setTimeout(()=>{$('#notice').hidden=true;},4500);}
  function header(){return `<header class="panel-head">${state.screen==='main'?`<div class="brand"><span class="brand-logo">${icon('logo')}</span>点译</div>`:`<button class="icon-button" data-action="back" aria-label="返回${state.mode==='summary'?'总结':'翻译'}">${icon('back')}</button><strong class="head-title">${state.screen==='model'?state.modelScope==='summary'?'总结模型':'翻译模型':state.screen==='prompt'?'总结提示词':'我的词句库'}</strong>`}<div class="head-actions">${state.screen==='main'?`<button class="icon-button" data-action="library" aria-label="打开词句库">${icon('book')}</button><button class="icon-button" data-action="open-model" aria-label="设置${state.mode==='summary'?'总结':'翻译'}模型">${icon('settings')}</button>`:''}<button class="icon-button" data-action="close" aria-label="关闭侧栏">${icon('close')}</button></div></header>`;}
  function modes(){return `<nav class="panel-modes" role="tablist" aria-label="阅读任务"><button role="tab" aria-selected="${state.mode==='summary'}" data-action="mode-summary">网页总结</button><button role="tab" aria-selected="${state.mode==='translation'}" data-action="mode-translation">网页翻译</button></nav>`;}
  const busy=()=>['reading','classifying','streaming'].includes(state.summary.phase);
  function modelRow(scope){const m=state.models[scope];return `<div class="model-summary"><span>${scope==='summary'?'总结模型':'翻译模型'} · ${esc(m.model||'未设置')}${m.ready?'':' · 需要连接'}</span><button class="text-button" data-action="open-model">${m.ready?'单独设置':'去配置'} ${icon('up')}</button></div>`;}
  function sourceInfo(){return `<div class="source-link">${icon('file')}<div><strong title="${esc(D.title)}">${state.changed?'另一篇示例网页':D.title}</strong><small>reading.example · 当前网页</small></div></div>`;}
  function summaryControls(){
    const s=state.summary,ready=state.models.summary.ready;
    if(s.phase!=='idle'&&!s.showOptions&&!s.confirm&&!state.changed){
      return `<section class="panel-static compact-controls">${sourceInfo()}<div class="summary-toolbar"><div><label class="field-label" for="summary-preset">总结方式</label><select class="input" id="summary-preset">${Object.entries(D.prompts).filter(([key])=>key!=='general'||state.preset==='general').map(([key,value])=>`<option value="${key}" ${state.preset===key?'selected':''}>${value.name}</option>`).join('')}</select></div><button class="icon-button" data-action="summary-options" aria-label="调整总结要求">${icon('edit')}</button>${s.phase==='error'?'':`<button class="button small ${busy()?'':'primary'}" data-action="${busy()?'stop-summary':'start-summary'}">${icon(busy()?'stop':'spark')}${busy()?'停止生成':'重新总结'}</button>`}</div>${modelRow('summary')}</section>`;
    }
    const changed=state.changed?`<div class="warning-box"><strong>当前网页已变更</strong><p>下方仍是上一页的结果，不会自动总结新页面。</p><button class="text-button" data-action="new-page">总结新网页 ${icon('arrow')}</button></div>`:'';
    return `<section class="panel-static">${s.showOptions?'<button class="text-button" data-action="collapse-options">收起设置</button>':''}${sourceInfo()}<div class="preset-row"><div><label class="field-label" for="summary-preset">总结方式</label><select class="input" id="summary-preset">${Object.entries(D.prompts).filter(([key])=>key!=='general'||state.preset==='general').map(([key,value])=>`<option value="${key}" ${state.preset===key?'selected':''}>${value.name}</option>`).join('')}</select></div><button class="icon-button" data-action="prompt" aria-label="查看或编辑总结提示词">${icon('edit')}</button></div><p class="field-help">${esc(D.prompts[state.preset].advice)}</p><details class="focus-input"><summary>补充关注点（选填）</summary><textarea class="input" id="summary-focus" maxlength="1000" placeholder="例如：重点说明实现步骤和局限">${esc(state.focus)}</textarea></details>${changed}${s.confirm?`<div class="warning-box"><strong>重新总结会使用模型额度</strong><p>将按当前预设重新生成并替换本页结果。</p><div class="reading-actions"><button class="button small primary" data-action="confirm-summary">确认重新总结</button><button class="text-button" data-action="cancel-confirm">取消</button></div></div>`:`<div class="start-row"><button class="button primary" data-action="${busy()?'stop-summary':!ready?'open-model':'start-summary'}" ${state.scene==='empty'||state.changed?'disabled':''}>${icon(busy()?'stop':'spark')}${busy()?'停止生成':!ready?'配置总结模型':s.text?'重新总结':'开始总结'}</button></div>`}${modelRow('summary')}</section>`;
  }
  function statusText(){const s=state.summary;return s.phase==='reading'?'正在读取当前网页…':s.phase==='classifying'?'正在识别主题与内容类型…':s.phase==='streaming'?'正在生成总结…':s.phase==='complete'?'总结完成':s.phase==='stopped'?'已停止 · 已生成内容保留':s.phase==='error'?'生成未完成':'准备就绪';}
  function outputTop(){return `<div class="output-top" id="output-top" ${state.summary.phase==='idle'?'hidden':''}><div class="status-line ${busy()?'running':''}" id="summary-status" role="status" aria-live="polite">${statusText()}</div>${state.summary.topic?`<p class="field-help">识别主题：${esc(state.summary.topic)}</p>`:''}<div class="output-tabs" id="output-tabs" ${state.summary.text?'':'hidden'}><button class="${state.summary.view==='content'?'active':''}" data-action="view-content">总结内容</button><button class="${state.summary.view==='artifacts'?'active':''}" data-action="view-artifacts">制品 <span id="artifact-count">0</span></button></div></div>`;}
  function quotaBox(){return `<div class="warning-box" role="alert"><h3>${icon('alert')}模型免费额度已耗尽</h3><p>检查百炼的账户余额与“免费额度用完即停”。确认继续付费后，再自行调整计费设置。</p><p>已生成的内容会保留，原网页不受影响。</p><a class="text-button" href="https://help.aliyun.com/zh/model-studio/new-free-quota" target="_blank" rel="noopener noreferrer">查看额度处理方法 ${icon('up')}</a><details><summary>错误详情</summary><code>HTTP 403 · insufficient_quota\n请求编号：demo-quota-request</code><button class="text-button" data-action="copy-error">复制错误详情</button></details><div class="reading-actions"><button class="button small" data-action="start-summary">处理后重新测试</button><button class="text-button" data-action="open-model">更换总结模型</button></div></div>`;}
  function summaryError(){return state.summary.error==='quota'?quotaBox():`<div class="warning-box" role="alert"><h3>${icon('alert')}生成中断</h3><p>已接收的内容已保留，可以复制或导出；准备好后可重新生成。</p><button class="button small" data-action="start-summary">重新生成</button></div>`;}
  function render(){
    rememberReadingPosition();
    const existingScroller=$('#summary-scroller');
    const retainedScroller=state.open&&state.screen==='main'&&state.mode==='summary'&&existingScroller?.dataset.resultId===String(generation)&&existingScroller.dataset.resultView===state.summary.view?existingScroller:null;
    $('#workspace').classList.toggle('panel-closed',!state.open);
    if(!state.open)return;
    const panel=$('#side-panel');
    if(state.screen==='model'){panel.innerHTML=header()+modelForm();return;}
    if(state.screen==='prompt'){panel.innerHTML=header()+promptForm();return;}
    if(state.screen==='library'){panel.innerHTML=header()+`<div class="panel-content"><label class="sr-only" for="term-search">搜索词句或释义</label><input type="search" id="term-search" class="input library-search" placeholder="搜索词句或释义" value="${esc(state.query)}"><div id="term-list"></div></div><footer class="output-footer"><span>示例词库 · 仅本机交互</span><button class="text-button" data-action="export-library">导出词库 ${icon('download')}</button></footer>`;renderTerms();return;}
    if(state.mode==='translation'){panel.innerHTML=header()+modes()+translationView();return;}
    panel.innerHTML=header()+modes()+summaryControls()+outputTop()+`<div class="panel-content" id="summary-scroller"><div id="summary-error">${state.summary.phase==='error'?summaryError():''}</div><div id="summary-empty"></div><div class="summary-doc" id="summary-doc" aria-label="总结结果"></div><button class="new-output" id="new-output" data-action="bottom" hidden>有新内容 · 回到底部</button></div><footer class="output-footer"><span id="output-note">仅基于当前网页</span><div class="buttons"><button class="text-button" data-action="copy-summary" ${state.summary.text?'':'disabled'}>${icon('copy')}复制</button><button class="button small" data-action="export-summary" ${state.summary.text?'':'disabled'}>${icon('download')}导出</button></div></footer>`;
    if(retainedScroller){$('#summary-scroller').replaceWith(retainedScroller);$('#summary-error').innerHTML=state.summary.phase==='error'?summaryError():'';}
    else $('#summary-scroller').addEventListener('scroll',event=>{state.follow=event.currentTarget.scrollHeight-event.currentTarget.scrollTop-event.currentTarget.clientHeight<70;});
    $('#summary-scroller').dataset.resultId=generation;$('#summary-scroller').dataset.resultView=state.summary.view;
    updateSummary();restoreReadingPosition();
  }
  function patch(parent,fresh){
    const existing=[...parent.childNodes],next=[...fresh.childNodes];
    next.forEach((node,index)=>{
      const old=existing[index];
      if(old?.nodeType===1&&node.nodeType===1&&old.dataset.artifact&&old.dataset.artifact===node.dataset.artifact)return;
      if(old?.isEqualNode(node))return;
      if(old&&old.nodeType===node.nodeType&&old.nodeName===node.nodeName&&old.nodeType===1){for(const attr of [...old.attributes])if(!node.hasAttribute(attr.name))old.removeAttribute(attr.name);for(const attr of node.attributes)old.setAttribute(attr.name,attr.value);patch(old,node);}
      else if(old)old.replaceWith(node);else parent.append(node);
    });
    for(let index=next.length;index<existing.length;index++)existing[index].remove();
  }
  function updateSummary(){
    if(!state.open||state.screen!=='main'||state.mode!=='summary')return;
    const s=state.summary,doc=$('#summary-doc'),scroll=$('#summary-scroller');if(!doc)return;
    const parsed=R.parse(s.text,{streaming:s.phase!=='complete'});state.artifacts=new Map(parsed.artifacts.map(item=>[item.id,item]));
    let html=parsed.html;
    if(s.view==='artifacts'){
      const template=document.createElement('template');template.innerHTML=html;
      html=[...template.content.querySelectorAll('.artifact')].map(node=>node.outerHTML).join('')||'<p class="muted">完整图形、代码、表格或公式到达后，会显示在这里。</p>';
    }
    const template=document.createElement('template');template.innerHTML=html;patch(doc,template.content);
    for(const el of doc.querySelectorAll('.artifact')){
      const source=el.querySelector('.artifact-source'),preview=el.querySelector('.artifact-preview'),toggle=el.querySelector('[data-artifact-action="source"]');
      if(source&&preview){const show=sourceViews.has(el.dataset.artifact);source.hidden=!show;preview.hidden=show;if(toggle)toggle.textContent=show?'预览':'源码';}
    }
    $('#artifact-count').textContent=parsed.artifacts.length;
    $('#output-tabs').hidden=!s.text;
    $('#summary-status').textContent=statusText()+(s.kind?` · ${D.prompts[s.kind].name}`:'');
    $('#summary-status').classList.toggle('running',busy());
    const empty=$('#summary-empty');
    empty.innerHTML=s.text?'':state.scene==='empty'?`<div class="empty-state">${icon('file')}<h2>这页没有足够的正文</h2><p>请打开有可读内容的文章再总结。表单、输入框和隐藏内容不会被纳入。</p><button class="button" data-action="close">返回网页</button></div>`:busy()?`<div class="empty-state"><h2>${s.phase==='classifying'?'先理解这篇网页':'正在准备内容'}</h2><p>${s.phase==='classifying'?'判断核心主题，随后应用对应的总结提示词。':'仅处理当前页已加载的可读正文。'}</p></div>`:s.phase==='error'?'':`<div class="empty-state">${icon('spark')}<h2>抓住重点，继续阅读</h2><p>提炼当前网页的主旨、关键观点和依据。网页保持原样，总结在这里展开。</p><ul><li>自动模式先识别主题，再按相应预设输出。</li><li>生成时可以停止，已有内容仍可复制和导出。</li><li>图形、代码、表格和公式保留可复制源码。</li></ul><div class="help-note">此原型的识别、总结和流速为固定示例。复制与文件导出可实际体验；不会发送网页或真实模型请求。</div></div>`;
    $('#output-note').textContent=s.phase==='stopped'?'部分结果 · 已保留':s.phase==='complete'?'示例结果 · 仅基于本页':'仅基于当前网页';
    document.querySelectorAll('[data-action="copy-summary"],[data-action="export-summary"]').forEach(button=>button.disabled=!s.text);
    if(s.text&&state.follow&&['streaming','complete'].includes(s.phase))scroll.scrollTop=scroll.scrollHeight;else if(s.text&&s.phase==='streaming')$('#new-output').hidden=false;
    for(const el of doc.querySelectorAll('[data-kind="mermaid"]')){
      if(el.dataset.mounted)continue;el.dataset.mounted='true';const item=state.artifacts.get(el.dataset.artifact);
      R.diagram(item.source).then(svg=>{if(!el.isConnected)return;el.querySelector('.artifact-preview').innerHTML=svg;if(state.follow)scroll.scrollTop=scroll.scrollHeight;}).catch(()=>{if(el.isConnected)el.querySelector('.artifact-preview').innerHTML='<span class="muted">图形未能预览，仍可查看和复制源码。</span>';});
    }
  }
  const delay=(ms,signal)=>new Promise((resolve,reject)=>{const done=()=>{signal?.removeEventListener('abort',abort);resolve();};const timer=setTimeout(done,ms);const abort=()=>{clearTimeout(timer);reject(new DOMException('Aborted','AbortError'));};if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});});
  async function startSummary(force=false){
    if(busy()||state.changed||state.scene==='empty')return;
    if(!state.models.summary.ready){openModel('summary');return;}
    if(state.summary.text&&!force){state.summary.confirm=true;render();return;}
    state.controller?.abort();const controller=new AbortController(),run=++generation;state.controller=controller;
    state.summary={...newSummary(),phase:'reading'};state.follow=true;render();
    try{
      await delay(280,controller.signal);
      if(state.preset==='auto'){state.summary.phase='classifying';render();await delay(850,controller.signal);state.summary.kind='technical';state.summary.topic='网页阅读与流式总结';}
      else state.summary.kind=state.preset;
      if(state.scene==='quota'){state.summary.phase='error';state.summary.error='quota';render();return;}
      state.summary.phase='streaming';render();const decoder=new S.SSEDecoder();
      for await(const chunk of S.demoStream(D.outputs[state.summary.kind]||D.outputs.general,controller.signal)){
        if(run!==generation)return;
        for(const text of decoder.push(chunk))state.summary.text+=text;
        updateSummary();
      }
      for(const text of decoder.push(undefined,true))state.summary.text+=text;
      if(!decoder.done)throw new Error('Stream ended before completion');
      if(run!==generation)return;state.summary.phase='complete';render();
    }catch(error){if(run!==generation)return;state.summary.phase=error.name==='AbortError'?'stopped':'error';state.summary.error=error.name==='AbortError'?'':'stream';render();}
  }
  function stopSummary(){if(!busy())return;state.controller?.abort();state.summary.phase='stopped';render();}
  function translationView(){
    const total=$('#source-article').querySelectorAll('.translatable').length;
    return `<section class="panel-static">${sourceInfo()}<label class="field-label" for="translation-target">目标语言</label><select class="input" id="translation-target">${Object.entries(languages).map(([key,name])=>`<option value="${key}" ${key===state.target?'selected':''}>${name}</option>`).join('')}</select><div class="reading-actions"><div class="segmented" role="group" aria-label="译文显示方式"><button class="${state.translationMode==='bilingual'?'active':''}" data-action="bilingual">双语对照</button><button class="${state.translationMode==='translation'?'active':''}" data-action="translation-only">仅译文</button></div></div><button class="button primary full" data-action="translate-page">${state.blacklisted?'恢复此网站并翻译':state.translation?'重新翻译示例':'翻译当前页面'}</button>${modelRow('translation')}</section><div class="panel-content"><div class="empty-state"><h2>${state.translation?'译文已显示在网页中':'按块阅读，随时核对原文'}</h2><p>${state.translation?`已完成 ${total} 个示例块。切换显示方式复用已有结果。`:'原文与译文按块对应，保留链接。双语译文小 2px，仅译文保持原字号。'}</p>${state.translation?'<div class="reading-actions"><button class="button small" data-action="restore">恢复原文</button><button class="text-button" data-action="reload-local">刷新并加载本地结果</button></div>':''}</div><div class="reading-settings"><div class="setting-row"><label for="display-mode">短词释义显示</label><select id="display-mode"><option value="hover" ${state.display==='hover'?'selected':''}>悬浮释义</option><option value="inline" ${state.display==='inline'?'selected':''}>括号释义</option></select></div><div class="setting-row"><label for="translation-color">译文颜色</label><input id="translation-color" type="color" value="#245e4d"></div><div class="setting-row"><span>当前网站</span><button class="text-button" data-action="blacklist">${state.blacklisted?'恢复使用':'加入黑名单'}</button></div><p class="field-help">普通网页默认开启。总结和翻译使用各自的模型，不会互相覆盖。</p></div></div>`;
  }
  function applyTranslation(){
    for(const node of $('#source-article').querySelectorAll('.translatable')){
      let output=node.nextElementSibling;
      if(!output?.classList.contains('article-translation')){
        output=document.createElement(node.tagName);output.className='article-translation';output.textContent=node.dataset.translate;
        if(node.querySelector('a')){output.append(' 查看');const a=node.querySelector('a').cloneNode(false);a.textContent='流式说明';output.append(a,'。');}
        node.after(output);
      }
      const original=parseFloat(getComputedStyle(node).fontSize)||18;output.style.fontSize=`${state.translationMode==='translation'?original:Math.max(1,original-2)}px`;
    }
    $('#source-article').classList.toggle('translation-only',state.translationMode==='translation');
  }
  function restore(){state.translation=false;$('#source-article').classList.remove('translation-only');$('#source-article').querySelectorAll('.article-translation').forEach(node=>node.remove());render();}
  function openModel(scope){state.modelScope=scope||state.mode;state.modelScope=state.modelScope==='translation'?'translation':'summary';state.draft={...state.models[state.modelScope],key:''};state.modelMessage='';state.screen='model';render();}
  function collectDraft(){const form=$('#model-form');if(!form)return;for(const key of ['model','endpoint','key'])state.draft[key]=form.querySelector(`[name="${key}"]`)?.value||'';state.draft.remember=!!form.querySelector('[name="remember"]')?.checked;}
  function modelForm(){
    const d=state.draft,scope=state.modelScope,provider=providers[d.provider],summary=scope==='summary';
    return `<div class="panel-content"><section class="settings-section"><h2>${summary?'为总结单独连接模型':'翻译模型连接'}</h2><p>${summary?'使用通用对话模型进行归纳与分析。这份配置不会修改你的翻译模型。':'划词与整页翻译使用这份配置，不影响总结模型。'}</p><form id="model-form"><div class="provider-buttons" role="group" aria-label="${summary?'总结':'翻译'}模型服务商">${Object.entries(providers).map(([key,p])=>`<button type="button" data-provider="${key}" class="${key===d.provider?'active':''}" aria-pressed="${key===d.provider}">${p.name}</button>`).join('')}</div><div class="field"><label class="field-label" for="model-id">模型名称</label><input id="model-id" name="model" class="input" required value="${esc(d.model)}" placeholder="${summary?'例如 qwen-flash':'例如 qwen-mt-flash'}"><p class="field-help">${summary?'总结不使用 qwen-mt-* 专用翻译型号。':'千问 MT 使用专用翻译协议。'}</p></div><div class="field"><div class="term-top"><label class="field-label" for="model-key">API Key</label>${provider.keyUrl?`<a href="${provider.keyUrl}" target="_blank" rel="noopener noreferrer" class="text-button">获取 Key ${icon('up')}</a>`:''}</div><div class="key-row"><input id="model-key" name="key" type="password" class="input" value="${esc(d.key)}" placeholder="原型只需输入示例文字" autocomplete="off"><button class="icon-button" type="button" data-action="toggle-key" aria-label="显示或隐藏示例密钥">${icon('eye')}</button></div><p class="field-help">这是交互演示，请勿输入真实 Key。原型不保存或发送密钥。</p></div><label class="check-row"><input type="checkbox" name="remember" ${d.remember?'checked':''}>在此浏览器长期记住密钥</label><p class="field-help">正式版本默认仅会话保存；此原型只展示选项，不保存 Key。</p><details class="advanced" ${d.provider==='custom'?'open':''}><summary>服务地址与连接参数</summary><div class="field"><label class="field-label" for="model-endpoint">服务地址（Base URL）</label><input class="input" type="url" id="model-endpoint" name="endpoint" required value="${esc(d.endpoint)}" placeholder="https://your-model.example/v1"><p class="field-help">支持公共地址或工作空间专属域名。正式连接时自动补齐 /chat/completions。</p></div></details><div class="settings-status" id="model-result" role="status">${esc(state.modelMessage)}</div><button class="button primary full" type="submit" ${state.modelBusy?'disabled':''}>${state.modelBusy?'正在测试连接…':'连接并保存'}</button></form></section><div class="model-isolation"><strong>另一份配置保持不变</strong>${summary?'翻译模型':'总结模型'}：${esc(state.models[summary?'translation':'summary'].model||'尚未配置')}<p class="field-help">本页测试为本地示例，不会发送任何模型请求。</p></div></div>`;
  }
  async function saveModel(event){
    event.preventDefault();if(state.modelBusy)return;collectDraft();const d=state.draft;
    if(state.modelScope==='summary'&&/^qwen-mt-/i.test(d.model)){$('#model-result').textContent='这是专用翻译型号，请选择支持总结的通用模型。';$('#model-id').focus();return;}
    try{const url=new URL(d.endpoint);if(url.username||url.password||url.search||url.hash||!['https:','http:'].includes(url.protocol))throw Error();}catch{$('#model-result').textContent='请填写不含账号、密钥或查询参数的服务地址。';return;}
    state.modelBusy=true;state.modelMessage='正在验证示例连接…';render();await delay(600);
    state.modelBusy=false;
    if(state.scene==='quota'){state.modelMessage='免费额度已耗尽（演示）。可切换顶部“正常总结”场景体验恢复后的操作。';render();return;}
    const {key,...saved}=state.draft;state.models[state.modelScope]={...saved,ready:true};state.draft.key='';state.modelMessage='已连接并保存（示例）。另一份模型配置没有改变。';render();toast('示例模型已连接，返回后可开始生成');
  }
  function promptForm(){const key=state.preset;return `<div class="panel-content"><section class="settings-section"><h2>${D.prompts[key].name}</h2><p>${key==='auto'?'自动模式先识别主题，再应用相应预设；识别不是逐句翻译。':'选择预设只改变下一次生成方式，不会自动重跑已有总结。'}</p><label class="field-label" for="prompt-text">预设提示词</label><textarea id="prompt-text" class="input" rows="12" maxlength="4000">${esc(state.promptOverrides[key]||D.prompts[key].text)}</textarea><div class="reading-actions"><button class="button primary" data-action="save-prompt">保存提示词</button><button class="text-button" data-action="reset-prompt">恢复预设</button></div><p class="field-help">提示词编辑在原型内保留。固定示例输出用于验证交互，不代表实际模型按修改后的要求生成。</p></section></div>`;}
  function renderTerms(){
    const list=$('#term-list');if(!list)return;const terms=state.terms.filter(term=>(term.text+' '+term.translation).toLowerCase().includes(state.query.toLowerCase()));
    list.innerHTML=`<p class="library-count">${terms.length} 个示例词句</p>`+(terms.length?terms.map(term=>`<div class="term-row"><div class="term-top"><strong>${esc(term.text)}</strong><span class="term-actions"><button class="icon-button" data-edit-term="${term.id}" aria-label="编辑 ${esc(term.text)}">${icon('edit')}</button><button class="icon-button" data-delete-term="${term.id}" aria-label="删除 ${esc(term.text)}">${icon('trash')}</button></span></div><p>${esc(term.translation)}</p><small>${term.kind} · 本地释义</small>${state.editing===term.id?`<div class="term-edit"><label class="sr-only" for="edit-meaning">修改释义</label><textarea id="edit-meaning" class="input">${esc(term.translation)}</textarea><div class="buttons"><button class="button small primary" data-save-term="${term.id}">保存</button><button class="text-button" data-action="cancel-edit">取消</button></div></div>`:''}</div>`).join(''):`<div class="empty-state"><h2>${state.query?'没有匹配的词句':'词库还没有内容'}</h2><p>${state.query?'试试搜索中文释义，或清空关键词。':'回到网页选择一个短词，点击语言胶囊即可体验。'}</p>${state.query?'<button class="button" data-action="clear-search">清空搜索</button>':''}</div>`);
  }
  async function copy(text){
    try{await navigator.clipboard.writeText(text);}catch{const input=document.createElement('textarea');input.value=text;input.style.cssText='position:fixed;left:-10000px';document.body.append(input);input.select();const ok=document.execCommand('copy');input.remove();if(!ok){toast('复制未获浏览器允许，请查看源码后手动复制');return;}}
    toast('已复制');
  }
  function download(text,name,type='text/plain;charset=utf-8'){const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);}
  function summaryMarkdown(){return `# ${state.summary.source}\n\n> 点译交互原型 · 示例输出${state.summary.phase==='complete'?'':' · 部分结果'}\n> 来源：${state.summary.url}\n> 总结方式：${D.prompts[state.summary.kind||'general'].name}\n\n${state.summary.text}`;}
  async function summaryHTML(){
    const parsed=R.parse(summaryMarkdown(),{streaming:state.summary.phase!=='complete'}),holder=document.createElement('div');holder.innerHTML=parsed.html;
    for(const item of parsed.artifacts){const el=holder.querySelector(`[data-artifact="${item.id}"]`);el?.querySelector('.artifact-head')?.remove();el?.querySelector('.artifact-source[hidden]')?.remove();if(item.kind==='mermaid')try{el.querySelector('.artifact-preview').innerHTML=await R.diagram(item.source);}catch{el.querySelector('.artifact-preview').textContent=item.source;}}
    return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'"><title>点译 · 网页总结示例</title><style>body{max-width:780px;margin:40px auto;padding:0 24px;font:16px/1.85 system-ui;color:#263735}h1{font-size:26px}h2{font-size:21px;margin-top:32px}pre{padding:16px;background:#f4f6f2;overflow:auto;white-space:pre-wrap;font-size:13px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #dce4df;padding:9px;text-align:left}svg{max-width:100%;height:auto}math{font-size:21px}a{color:#006665}</style>${holder.innerHTML}</html>`;
  }
  function exportMenu(button,item){
    state.copyTarget=item||null;
    let formats=[['md','Markdown（.md）'],['html','可阅读文档（.html）']];
    if(item?.kind==='mermaid')formats=[['mmd','Mermaid 源码（.mmd）'],['svg','图形（.svg）']];
    else if(item?.kind==='table')formats=[['csv','表格（.csv）'],['md','表格源码（.md）']];
    else if(item?.kind==='math')formats=[['tex','公式源码（.tex）']];
    else if(item){const ext=({javascript:'js',typescript:'ts',python:'py',json:'json',css:'css',html:'html'})[item.lang]||'txt';formats=[['code','代码（.'+ext+'）']];}
    const menu=$('#export-menu');menu.innerHTML=formats.map(([key,name])=>`<button type="button" data-export-format="${key}">${name}</button>`).join('');const rect=button.getBoundingClientRect();menu.style.left=Math.max(10,Math.min(innerWidth-200,rect.right-190))+'px';menu.style.top=Math.max(10,rect.top-formats.length*38-18)+'px';menu.showPopover();
  }
  async function doExport(format){
    const item=state.copyTarget;$('#export-menu').hidePopover();
    if(!item){if(format==='html')download(await summaryHTML(),'点译-网页总结示例.html','text/html;charset=utf-8');else download(summaryMarkdown(),'点译-网页总结示例.md','text/markdown;charset=utf-8');return;}
    if(format==='svg'){try{download(await R.diagram(item.source),'点译-流程图.svg','image/svg+xml;charset=utf-8');}catch{toast('图形未就绪，可先导出 Mermaid 源码');}return;}
    if(format==='csv'){download(R.csv(item.source),'点译-对照表.csv','text/csv;charset=utf-8');return;}
    const ext=format==='code'?({javascript:'js',typescript:'ts',python:'py',json:'json',css:'css',html:'html'})[item.lang]||'txt':format;download(item.source,`点译-制品.${ext}`);
  }
  function updateMarks(){
    for(const node of $('#source-article').querySelectorAll('[data-word]')){const term=state.terms.find(t=>t.text.toLowerCase()===node.dataset.word.toLowerCase());node.classList.toggle('saved-word',!!term);let inline=node.nextElementSibling;if(inline?.classList.contains('word-inline'))inline.remove();if(term&&state.display==='inline'){inline=document.createElement('span');inline.className='word-inline';inline.textContent='（'+term.translation+'）';node.after(inline);}}
  }
  function deleteTerm(id){const at=state.terms.findIndex(t=>t.id===id);if(at<0)return;state.deleted={at,term:state.terms[at]};state.terms.splice(at,1);$('#word-tooltip').innerHTML='';updateMarks();renderTerms();toast('已删除词句，并取消本页标记',true);}
  function showMeaning(term,rect){const target=$('#word-tooltip');const left=Math.min(innerWidth-310,Math.max(10,rect.left)),top=Math.max(8,Math.min(innerHeight-210,rect.bottom+9));target.innerHTML=`<div class="meaning-tooltip" style="left:${Math.max(10,left)}px;top:${top}px"><p class="meaning">${esc(term.translation)}</p><p class="original">${esc(term.text)} · 本地释义</p><footer><button data-delete-term="${term.id}">取消标记并删除</button><button data-action="library" data-focus-term="${term.id}">编辑</button></footer></div>`;}
  function resetDemo(scene='normal'){
    state.controller?.abort();generation++;state.scene=scene;state.screen='main';state.mode='summary';state.open=true;state.summary=newSummary();state.changed=scene==='changed';state.models.summary.ready=scene!=='first';state.draft=null;state.modelBusy=false;state.modelMessage='';state.follow=true;$('#demo-scene').value=scene;
    if(scene==='quota'){state.summary.phase='error';state.summary.error='quota';}
    $('#address-text').textContent=scene==='changed'?'reading.example/notes/another-page':'reading.example/notes/streaming';render();
  }
  document.addEventListener('click',async event=>{
    const button=event.target.closest('button');if(!button)return;
    if(button.dataset.provider){collectDraft();const provider=providers[button.dataset.provider];state.draft={...state.draft,provider:button.dataset.provider,model:provider[state.modelScope],endpoint:provider.endpoint,key:''};state.modelMessage='';render();return;}
    if(button.dataset.editTerm){state.editing=button.dataset.editTerm;renderTerms();return;}
    if(button.dataset.deleteTerm){deleteTerm(button.dataset.deleteTerm);return;}
    if(button.dataset.saveTerm){const term=state.terms.find(t=>t.id===button.dataset.saveTerm),value=$('#edit-meaning')?.value.trim();if(value){term.translation=value;state.editing='';renderTerms();updateMarks();toast('释义已更新');}return;}
    if(button.dataset.exportFormat){await doExport(button.dataset.exportFormat);return;}
    if(button.dataset.artifactAction){const item=state.artifacts.get(button.dataset.id);if(!item)return;if(button.dataset.artifactAction==='copy')await copy(item.source);else if(button.dataset.artifactAction==='download')exportMenu(button,item);else{const artifact=button.closest('.artifact'),source=artifact.querySelector('.artifact-source'),preview=artifact.querySelector('.artifact-preview');source.hidden=!source.hidden;preview.hidden=!source.hidden;if(source.hidden)sourceViews.delete(item.id);else sourceViews.add(item.id);button.textContent=source.hidden?'源码':'预览';}return;}
    switch(button.dataset.action){
      case 'open-summary':state.open=true;state.mode='summary';state.screen='main';render();break;
      case 'open-translation':state.open=true;state.mode='translation';state.screen='main';render();break;
      case 'close':state.open=false;render();break;
      case 'back':state.screen='main';state.draft=null;render();break;
      case 'mode-summary':state.mode='summary';render();break;
      case 'mode-translation':state.mode='translation';render();break;
      case 'open-model':openModel();break;
      case 'library':state.open=true;state.screen='library';state.query='';if(button.dataset.focusTerm)state.editing=button.dataset.focusTerm;render();break;
      case 'start-summary':await startSummary();break;
      case 'confirm-summary':state.summary.confirm=false;await startSummary(true);break;
      case 'cancel-confirm':state.summary.confirm=false;render();break;
      case 'stop-summary':stopSummary();break;
      case 'view-content':state.summary.view='content';state.follow=false;render();break;
      case 'view-artifacts':state.summary.view='artifacts';state.follow=false;render();break;
      case 'bottom':state.follow=true;$('#summary-scroller').scrollTop=$('#summary-scroller').scrollHeight;$('#new-output').hidden=true;break;
      case 'copy-summary':await copy(summaryMarkdown());break;
      case 'export-summary':exportMenu(button);break;
      case 'copy-error':await copy('HTTP 403 · insufficient_quota\n请求编号：demo-quota-request');break;
      case 'new-page':state.changed=false;state.summary=newSummary();render();toast('已切换到新网页，请主动开始总结');break;
      case 'prompt':state.screen='prompt';render();break;
      case 'summary-options':state.summary.showOptions=true;render();break;
      case 'collapse-options':state.summary.showOptions=false;render();break;
      case 'save-prompt':{const value=$('#prompt-text').value.trim();if(!value){toast('提示词不能为空');return;}state.promptOverrides[state.preset]=value;state.screen='main';render();toast('已保存，下一次生成生效');break;}
      case 'reset-prompt':delete state.promptOverrides[state.preset];$('#prompt-text').value=D.prompts[state.preset].text;toast('已恢复预设');break;
      case 'toggle-key':$('#model-key').type=$('#model-key').type==='password'?'text':'password';break;
      case 'translate-page':state.blacklisted=false;state.translation=true;applyTranslation();render();toast('已显示示例译文，原文可随时恢复');break;
      case 'restore':restore();toast('已恢复原文');break;
      case 'reload-local':applyTranslation();toast('已从本地示例结果恢复，未重新生成');break;
      case 'bilingual':state.translationMode='bilingual';if(state.translation)applyTranslation();render();break;
      case 'translation-only':state.translationMode='translation';if(state.translation)applyTranslation();render();break;
      case 'blacklist':state.blacklisted=!state.blacklisted;if(state.blacklisted)restore();else render();toast(state.blacklisted?'已在此网站停用':'已恢复此网站');break;
      case 'clear-search':state.query='';$('#term-search').value='';renderTerms();break;
      case 'cancel-edit':state.editing='';renderTerms();break;
      case 'export-library':download(JSON.stringify({example:true,entries:state.terms},null,2),'点译-示例词库.json','application/json');break;
      case 'undo-delete':if(state.deleted){state.terms.splice(state.deleted.at,0,state.deleted.term);state.deleted=null;updateMarks();renderTerms();toast('已恢复词句');}break;
      case 'close-selection':$('#selection-tools').innerHTML='';break;
      case 'translate-selection':{const text=state.selectedText;let term=state.terms.find(t=>t.text.toLowerCase()===text.toLowerCase());if(!term){term={id:'term-'+Date.now(),text,translation:'这是一条示例释义，可在词库中编辑。',kind:text.includes(' ')?'短语':'单词'};state.terms.unshift(term);}const rect=button.getBoundingClientRect();$('#selection-tools').innerHTML='';showMeaning(term,rect);toast('已保存到示例词库');break;}
    }
  });
  document.addEventListener('submit',event=>{if(event.target.id==='model-form')saveModel(event);});
  document.addEventListener('change',event=>{
    if(event.target.id==='demo-scene'){resetDemo(event.target.value);return;}
    if(event.target.id==='summary-preset'){state.preset=event.target.value;state.summary.confirm=false;render();if(state.summary.text)toast('预设已选择；点击重新总结后才会生成');}
    if(event.target.id==='translation-target'){state.target=event.target.value;if(state.translation)restore();toast('已选择目标语言，不会自动翻译');}
    if(event.target.id==='display-mode'){state.display=event.target.value;updateMarks();}
    if(event.target.id==='selection-language'){state.target=event.target.value;$('#selection-tools .selection-main').textContent=state.target==='zh-CN'?'中文':languages[state.target];}
  });
  document.addEventListener('input',event=>{if(event.target.id==='term-search'){state.query=event.target.value;renderTerms();}if(event.target.id==='summary-focus')state.focus=event.target.value;if(event.target.id==='translation-color')document.documentElement.style.setProperty('--translation',event.target.value);});
  $('#reset-demo').onclick=()=>{restore();state.terms=D.terms.map(t=>({...t}));state.models={summary:defaultModel('summary'),translation:defaultModel('translation')};state.preset='auto';updateMarks();resetDemo();toast('示例已重置');};
  document.addEventListener('mouseup',event=>{
    if(!event.target.closest('#source-article')||state.translation||state.blacklisted)return;const selection=getSelection(),text=selection.toString().trim();if(!text||!selection.rangeCount)return;if(text.length>140){toast('长选区可在“网页翻译”中按块阅读');return;}
    state.selectedText=text;const rect=selection.getRangeAt(0).getBoundingClientRect(),left=Math.max(6,Math.min(innerWidth-146,rect.left)),top=Math.max(8,Math.min(innerHeight-42,rect.bottom+8));$('#selection-tools').innerHTML=`<div class="selection-capsule" style="left:${left}px;top:${top}px"><button class="selection-main" data-action="translate-selection" aria-label="翻译选中文本">${state.target==='zh-CN'?'中文':languages[state.target]}</button><select id="selection-language" aria-label="选择目标语言">${Object.entries(languages).map(([key,name])=>`<option value="${key}" ${state.target===key?'selected':''}>${name}</option>`).join('')}</select><button class="close-small" data-action="close-selection" aria-label="关闭划词工具">${icon('close')}</button></div>`;
  });
  document.addEventListener('mouseover',event=>{const word=event.target.closest('.saved-word');if(word&&!state.blacklisted){clearTimeout(hoverTimer);const term=state.terms.find(t=>t.text.toLowerCase()===word.dataset.word.toLowerCase());if(term)showMeaning(term,word.getBoundingClientRect());}if(event.target.closest('.meaning-tooltip'))clearTimeout(hoverTimer);});
  document.addEventListener('mouseout',event=>{if(event.target.closest('.saved-word,.meaning-tooltip'))hoverTimer=setTimeout(()=>{$('#word-tooltip').innerHTML='';},450);});
  document.addEventListener('focusin',event=>{const word=event.target.closest('.saved-word');if(word&&!state.blacklisted){const term=state.terms.find(t=>t.text===word.dataset.word);if(term)showMeaning(term,word.getBoundingClientRect());}});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'){$('#selection-tools').innerHTML='';$('#word-tooltip').innerHTML='';} });
  window.addEventListener('beforeunload',()=>state.controller?.abort());
  render();
})();
