const encoder = new TextEncoder();
const fileId = id => String(id).replace(/[^A-Za-z0-9_-]/g, '_');
const stamp = value => new Date(value).toISOString();
const metadata = value => '---\n' + Object.entries(value).filter(([,v])=>v!==undefined).map(([key,v])=>`${key}: ${JSON.stringify(v)}`).join('\n')+'\n---\n\n';
const sourceFile = id => `summaries/${fileId(id)}.md`;
export function knowledgeMarkdown(record,{linkFiles=false,sources=[]}={}) {
  const title=record.title||record.source?.title||'网页总结';
  const references=[...new Set([...(record.sourceIds||[]),...(record.contextIds||[])])];
  return metadata({schemaVersion:1,id:record.id,kind:record.kind,revision:record.revision,createdAt:stamp(record.createdAt),source:record.source?.url,sourceIds:record.sourceIds||[],contextIds:record.contextIds||[],period:record.range,model:record.model,phase:record.phase,missing:record.missing||0})+`# ${title}\n\n${record.text||''}\n\n`+(record.source?.url?`来源：[${record.source.title||record.source.domain}](${record.source.url})\n\n`:'')+(references.length?`## 来源与依据\n\n${references.map(id=>{const source=sources.find(s=>s.id===id);return linkFiles?`- [${source?.title||id}](${fileId(id)}.md)`:source?.url?`- [${source.title||id}](${source.url})`:`- 来源 ID：${id}`;}).join('\n')}\n`:'');
}
const visitProjection = v => ({type:'visit',id:v.id,visitedAt:v.visitedAt,source:v.source,parentId:v.parentId,documentId:v.documentId,summaryId:v.summaryId,project:v.project,tags:v.tags,note:v.note,error:v.error});
const summaryProjection = s => Object.fromEntries(['id','kind','revision','logicalKey','documentId','title','source','sourceIds','inputIds','contextIds','annotations','range','filter','dimension','visitCount','missing','phase','text','error','createdAt','updatedAt','completedAt','model','connectionName','requestAttempts','usage','signature','truncated','chars'].filter(key=>s[key]!==undefined).map(key=>[key,s[key]]));
const jsonl = records => records.map(v=>JSON.stringify(v)).join('\n')+(records.length?'\n':'');
export function knowledgeFiles(data) {
  const visits=data.visits.map(visitProjection),summaries=data.summaries.map(summaryProjection),documents=data.documents.map(d=>({type:'document',id:d.id,source:d.source,contentHash:d.contentHash,capturedAt:d.capturedAt,chars:d.chars,truncated:d.truncated}));
  const relations=[...visits.flatMap(v=>[{from:v.id,to:v.summaryId||v.documentId,kind:'visited'},...(v.parentId?[{from:v.id,to:v.parentId,kind:'followed'}]:[])]),...summaries.flatMap(s=>[...(s.sourceIds||[]).map(id=>({from:s.id,to:id,kind:'evidence'})),...(s.contextIds||[]).map(id=>({from:s.id,to:id,kind:'context'})),...(s.inputIds||[]).map(id=>({from:s.id,to:id,kind:'input'}))])].filter(r=>r.to);
  const manifest={schemaVersion:1,format:'dianyi-knowledge',exportedAt:stamp(data.exportedAt),timeZone:data.timeZone,visits:visits.length,summaries:summaries.length,files:Object.fromEntries([...summaries,...(data.externalSources||[])].map(s=>[s.id,sourceFile(s.id)])),externalSources:data.externalSources||[]};
  const files={'README.md':'# 点译 · 我的阅读知识\n\n此文件夹包含阅读轨迹、分层总结和引用关系。Markdown 可独立阅读，JSONL 可用于程序处理。\n\n- `manifest.json`：结构版本及文件索引。\n- `visits.jsonl`：访问与备注。\n- `summaries.jsonl`：页面及周期总结。\n- `relations.jsonl`：来源、上下文与输入关系。\n- `external-sources.jsonl`：本次筛选范围之外的引用元信息，不包含其正文或访问轨迹。\n\n数据仅代表已保存的资料和模型结果；缺失资料、部分完成和截取状态以各记录为准。模型结果应回到来源核对。\n',
    'manifest.json':JSON.stringify(manifest,null,2),'visits.jsonl':jsonl(visits),'documents.jsonl':jsonl(documents),'summaries.jsonl':jsonl(summaries),'relations.jsonl':jsonl(relations),'external-sources.jsonl':jsonl(data.externalSources||[]),'timeline.csv':knowledgeCSV(visits)};
  for(const s of summaries)files[sourceFile(s.id)]=knowledgeMarkdown(s,{linkFiles:true});
  for(const s of data.externalSources||[])if(!files[sourceFile(s.id)])files[sourceFile(s.id)]=metadata({id:s.id,contextOnly:true,source:s.url})+`# ${s.title||s.id}\n\n仅导出引用元信息，正文不在本次筛选范围内。\n\n${s.url?`[打开原文](${s.url})`:''}\n`;
  if(data.snapshots?.length)files['originals.jsonl']=jsonl(data.snapshots);
  return files;
}
export function knowledgeCSV(visits) {
  const cell=value=>{let s=String(value??'');if(/^[=+\-@\t\r]/.test(s.trimStart()))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
  return '\uFEFF'+[['ID','访问时间','标题','来源','项目','标签','备注','摘要ID'],...visits.map(v=>[v.id,stamp(v.visitedAt),v.source.title,v.source.url,v.project,(v.tags||[]).join(', '),v.note,v.summaryId])].map(row=>row.map(cell).join(',')).join('\r\n');
}
export function knowledgeJSONL(data) {return jsonl([...data.visits.map(visitProjection),...data.documents.map(d=>({type:'document',id:d.id,source:d.source,contentHash:d.contentHash,capturedAt:d.capturedAt})),...data.summaries.map(s=>({type:'summary',...summaryProjection(s)})),...(data.externalSources||[]).map(s=>({type:'external-source',...s})),...(data.snapshots||[]).map(s=>({type:'snapshot',id:s.id,text:s.text}))]);}
export function knowledgeBundleMarkdown(data) {
  const byId=new Map([...data.summaries.map(s=>[s.id,{title:s.title||s.source?.title,url:s.source?.url}]),...(data.externalSources||[]).map(s=>[s.id,s])]);
  const notes=(data.visits||[]).filter(v=>v.note||v.project||v.tags?.length).map(v=>`### ${v.source.title||'阅读备注'}\n\n${stamp(v.visitedAt)} · ${[v.project,...(v.tags||[])].filter(Boolean).join(' · ')}\n\n${v.note||''}\n\n[打开原网页](${v.source.url})`).join('\n\n');
  return metadata({schemaVersion:1,exportedAt:stamp(data.exportedAt),timeZone:data.timeZone})+'# 我的阅读知识\n\n'+data.summaries.filter(s=>s.kind!=='rollup').map(s=>`## ${s.title||s.source?.title||'网页总结'}\n\n> ${s.kind} · ${stamp(s.createdAt)} · ${s.phase}\n\n${s.text||''}\n\n`+(s.source?.url?`[打开原网页](${s.source.url})\n\n`:'')+[...(s.sourceIds||[]),...(s.contextIds||[])].map(id=>{const source=byId.get(id);return source?.url?`- [${source.title||id}](${source.url})`:`- 来源 ID：${id}`;}).join('\n')).join('\n\n---\n\n')+(notes?'\n\n## 我的阅读备注\n\n'+notes:'');
}
export function knowledgeZip(files) {
  const table=Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
  const crc=bytes=>{let n=0xffffffff;for(const b of bytes)n=table[(n^b)&255]^(n>>>8);return(n^0xffffffff)>>>0;};
  const blocks=[],directory=[];let offset=0;
  for(const [path,text]of Object.entries(files)){
    const name=encoder.encode('dianyi-knowledge/'+path),body=encoder.encode(text),sum=crc(body),local=new Uint8Array(30),l=new DataView(local.buffer),central=new Uint8Array(46),c=new DataView(central.buffer);
    l.setUint32(0,0x04034b50,true);l.setUint16(4,20,true);l.setUint16(6,0x800,true);l.setUint32(14,sum,true);l.setUint32(18,body.length,true);l.setUint32(22,body.length,true);l.setUint16(26,name.length,true);
    c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(8,0x800,true);c.setUint32(16,sum,true);c.setUint32(20,body.length,true);c.setUint32(24,body.length,true);c.setUint16(28,name.length,true);c.setUint32(42,offset,true);
    blocks.push(local,name,body);directory.push(central,name);offset+=local.length+name.length+body.length;
  }
  const size=directory.reduce((n,b)=>n+b.length,0),end=new Uint8Array(22),e=new DataView(end.buffer);e.setUint32(0,0x06054b50,true);e.setUint16(8,Object.keys(files).length,true);e.setUint16(10,Object.keys(files).length,true);e.setUint32(12,size,true);e.setUint32(16,offset,true);
  const result=new Uint8Array(offset+size+end.length);let at=0;for(const block of [...blocks,...directory,end]){result.set(block,at);at+=block.length;}return result;
}
