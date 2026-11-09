(() => {
  if (globalThis.__dianyiKnowledgeObserver) return;
  globalThis.__dianyiKnowledgeObserver = true;
  let timer, captured = false, href = location.href;
  function schedule() {
    if (href !== location.href) { href = location.href; captured = false; }
    if (captured) return;
    clearTimeout(timer);
    timer = setTimeout(() => chrome.runtime.sendMessage({type:'SHIYI/KNOWLEDGE_READY'}).then(reply=>{if(reply?.ok&&reply.data?.id)captured=true;}).catch(()=>{}),1000);
  }
  new MutationObserver(records=>{
    if(records.some(record=>{
      const target=record.target.nodeType===1?record.target:record.target.parentElement;
      if(target?.closest('[data-shiyi-root],[data-shiyi-meaning],[data-shiyi-block-translation]'))return false;
      return record.type!=='childList'||[...record.addedNodes,...record.removedNodes].some(node=>!node.matches?.('[data-shiyi-block-loading]'));
    }))schedule();
  }).observe(document.documentElement,{subtree:true,childList:true,characterData:true});
  addEventListener('popstate',()=>{captured=false;schedule();});addEventListener('pageshow',schedule);schedule();
})();
