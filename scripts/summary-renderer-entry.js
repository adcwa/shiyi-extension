import MarkdownIt from 'markdown-it';
import mermaid from 'mermaid';
import katex from 'katex';

const md = new MarkdownIt({ html:false, linkify:false, typographer:false, breaks:false });
const escape = md.utils.escapeHtml;
const hash = text => { let value=2166136261; for (const ch of text) value=Math.imul(value^ch.codePointAt(0),16777619); return (value>>>0).toString(36); };
let svgSequence=0;
mermaid.initialize({ startOnLoad:false, securityLevel:'strict', suppressErrorRendering:true, theme:'base', htmlLabels:false, flowchart:{htmlLabels:false,useMaxWidth:true}, themeVariables:{fontFamily:'-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif',fontSize:'13px',primaryColor:'#eaf3ee',primaryTextColor:'#263735',primaryBorderColor:'#8aac9d',lineColor:'#527769',secondaryColor:'#f5f5f0',tertiaryColor:'#ffffff',background:'#ffffff'} });
const math = (text, displayMode=false) => katex.renderToString(text,{displayMode,output:'mathml',throwOnError:false,trust:false,maxExpand:500,strict:'ignore'});
function artifactOpen(item) {
  const toggles=['mermaid','math'].includes(item.kind)?`<button type="button" data-artifact-action="source" data-id="${item.id}" aria-label="查看${item.title}源码">源码</button>`:'';
  return `<section class="artifact" data-artifact="${item.id}" data-kind="${item.kind}"><header class="artifact-head"><span class="artifact-title">${escape(item.title)}</span><span class="artifact-tools">${toggles}<button type="button" data-artifact-action="copy" data-id="${item.id}" aria-label="复制${item.title}">复制</button><button type="button" data-artifact-action="download" data-id="${item.id}" aria-label="导出${item.title}">导出</button></span></header>`;
}
md.renderer.rules.image = (tokens,index) => `<span class="muted">[图片：${escape(tokens[index].content||'原文图片')}]</span>`;
const linkOpen=md.renderer.rules.link_open;
md.renderer.rules.link_open=(tokens,index,options,env,self)=>{tokens[index].attrSet('target','_blank');tokens[index].attrSet('rel','noopener noreferrer');return linkOpen?linkOpen(tokens,index,options,env,self):self.renderToken(tokens,index,options);};
md.inline.ruler.after('escape','summary_math',(state,silent)=>{
  const at=state.pos;if(state.src[at]!=='$'||state.src[at+1]==='$')return false;
  const end=state.src.indexOf('$',at+1);if(end<0||end-at>2000||state.src.slice(at,end).includes('\n'))return false;
  if(!silent){const token=state.push('math_inline','math',0);token.content=state.src.slice(at+1,end);}
  state.pos=end+1;return true;
});
md.renderer.rules.math_inline=(tokens,index)=>math(tokens[index].content);
md.block.ruler.before('fence','summary_math_block',(state,start,end,silent)=>{
  const line=n=>state.src.slice(state.bMarks[n]+state.tShift[n],state.eMarks[n]);
  if(!/^\$\$\s*$/.test(line(start)))return false;
  let finish=start+1;while(finish<end&&!/^\$\$\s*$/.test(line(finish)))finish++;
  if(finish>=end)return false;if(silent)return true;
  const token=state.push('math_block','math',0);token.block=true;token.map=[start,finish+1];token.content=state.getLines(start+1,finish,0,false).trim();state.line=finish+1;return true;
},{alt:['paragraph','reference','blockquote','list']});
md.renderer.rules.math_block=(tokens,index,options,env)=>{
  const item=env.add('math',tokens[index].content,'公式 · LaTeX');
  return artifactOpen(item)+`<div class="artifact-preview">${math(item.source,true)}</div><pre class="artifact-source" hidden><code>${escape(item.source)}</code></pre></section>`;
};
md.renderer.rules.fence=(tokens,index,options,env)=>{
  const token=tokens[index],lang=token.info.trim().split(/\s/)[0].toLowerCase()||'text',source=token.content.trimEnd();
  const closing=env.lines[(token.map?.[1]||0)-1]||'';
  if(env.streaming&&!new RegExp('^\\s*'+token.markup[0]+'{3,}\\s*$').test(closing))return `<pre class="stream-code"><code>${escape(source)}</code></pre>`;
  const kind=lang==='mermaid'?'mermaid':['latex','tex','math'].includes(lang)?'math':'code';
  const item=env.add(kind,source,kind==='mermaid'?'流程图 · Mermaid':kind==='math'?'公式 · LaTeX':`代码 · ${lang}`,lang);
  const preview=kind==='mermaid'?'<span class="rendering">正在绘制图形…</span>':kind==='math'?math(source,true):'';
  return artifactOpen(item)+(kind==='code'?`<pre class="artifact-source"><code>${escape(source)}</code></pre>`:`<div class="artifact-preview">${preview}</div><pre class="artifact-source" hidden><code>${escape(source)}</code></pre>`)+ '</section>';
};
md.renderer.rules.table_open=(tokens,index,options,env)=>{
  const token=tokens[index],source=env.lines.slice(token.map?.[0]||0,token.map?.[1]||0).join('\n');
  const item=env.add('table',source,'对照表 · CSV');
  return artifactOpen(item)+'<div class="table-scroll"><table>';
};
md.renderer.rules.table_close=()=>'</table></div></section>';
function parse(source,{streaming=false}={}){
  const artifacts=[],seen=new Map();
  const env={streaming,lines:source.split('\n'),add(kind,text,title,lang=''){const base=kind+'-'+hash(text);const n=seen.get(base)||0;seen.set(base,n+1);const item={id:base+'-'+n,kind,source:text,title,lang};artifacts.push(item);return item;}};
  return {html:md.render(source,env),artifacts};
}
function cleanSVG(svg){
  const parsed=new DOMParser().parseFromString(svg,'image/svg+xml');
  for(const node of parsed.querySelectorAll('script,foreignObject,iframe,object,embed,a,image'))node.remove();
  for(const node of parsed.querySelectorAll('*'))for(const attr of [...node.attributes])if(/^on/i.test(attr.name)||['href','xlink:href'].includes(attr.name)&&!attr.value.startsWith('#'))node.removeAttribute(attr.name);
  return new XMLSerializer().serializeToString(parsed.documentElement);
}
const diagramCache=new Map();
async function diagram(source){
  if(source.length>12000)throw new Error('图形源码过长，请复制源码后使用专门的图形工具打开。');
  if(!diagramCache.has(source))diagramCache.set(source,mermaid.render('dy-diagram-'+(++svgSequence),source).then(value=>cleanSVG(value.svg)));
  if(diagramCache.size>64)diagramCache.delete(diagramCache.keys().next().value);
  return diagramCache.get(source);
}
function csv(source){
  const tokens=md.parse(source,{}),rows=[];let row=null;
  for(const token of tokens){if(token.type==='tr_open')row=[];if(token.type==='inline'&&row)row.push(token.children?.map(item=>item.content||'').join('')||token.content);if(token.type==='tr_close'&&row){rows.push(row);row=null;}}
  return '\ufeff'+rows.map(row=>row.map(cell=>'"'+(/^[\s\u0000-\u001f]*[=+\-@]/.test(cell)?"'"+cell:cell).replaceAll('"','""')+'"').join(',')).join('\r\n');
}
globalThis.DianyiDocs={parse,diagram,math,csv,escape};
