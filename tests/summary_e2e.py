"""Unmodified MV3 package, real loopback HTTP/SSE; no external provider key."""
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread, Lock
from playwright.sync_api import sync_playwright, expect
import json, tempfile, time, os, zipfile

ROOT=Path(__file__).resolve().parents[1]
VERSION=json.loads((ROOT/'package.json').read_text())['version']
OUT=ROOT/'verification';OUT.mkdir(exist_ok=True)
report={'version':VERSION,'scope':'Unmodified extracted ZIP, real local HTTP/SSE fixture; no paid provider credentials.','checks':[],'result':'running'}
calls=[];control={'mode':'ok'};lock=Lock();errors=[]
DOC='''# 网页总结\n\n这是一份基于网页资料的总结，保留重点、依据与限制。\n\n## 技术步骤\n\n先读取正文，再通过流式接口展示结果。\n\n```javascript\nconst ready = true;\nconsole.log(ready);\n```\n\n| 方案 | 优点 |\n| --- | --- |\n| 流式输出 | 逐步可见 |\n| =HYPERLINK(1) | 安全导出 |\n\n```mermaid\nflowchart LR\n A[读取正文] --> B[总结模型]\n B --> C[流式展示]\n```\n\n$$\nE = mc^2\n$$\n\n'''+''.join('## 要点 '+str(n)+'\n\n资料归纳需要核对原文依据，区分事实与推论。'*2+'\n\n' for n in range(1,14))+'<img src=x onerror=alert(1)>\n\n资料中的 HTML 应作为文字显示。'
HTML='''<!doctype html><meta charset="utf-8"><title>Readable streaming article</title><main><h1>Streaming summary</h1><p id="original">Original evidence: streaming responses arrive incrementally and keep the reader in control.</p><p>Comparison of formats, implementation details and research limitations.</p><p>普通中文正文也可以总结，不能把它当成翻译任务。</p><pre><code>const source = "original code";</code></pre><input value="INPUT_MUST_NOT_SEND"><div contenteditable="true">EDITOR_MUST_NOT_SEND</div><p hidden>HIDDEN_MUST_NOT_SEND</p></main>'''
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_GET(self):
  body=HTML.replace('</main>',('<p>'+('Long source content. '*4000)+'</p></main>') if self.path.startswith('/long') else '</main>')
  secret='<p>ROOT_SECRET_MUST_NOT_SEND confidential unsubmitted content.</p>'
  roots={'/hidden-root':'<article hidden>'+secret+'</article>','/aria-root':'<article aria-hidden="true">'+secret+'</article>','/display-root':'<article style="display:none">'+secret+'</article>','/editor-root':'<article contenteditable="true">'+secret+'</article>','/ancestor-root':'<section hidden><article>'+secret+'</article></section>'}
  for route,hidden in roots.items():
   if self.path.startswith(route):body=body.replace('<main>',hidden+'<main>')
  self.send_response(200);self.send_header('Content-Type','text/html;charset=utf-8');self.end_headers();self.wfile.write(body.encode())
 def do_POST(self):
  payload=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
  with lock:calls.append({'payload':payload,'authorization':self.headers.get('Authorization'),'cookie':self.headers.get('Cookie')});mode=control['mode']
  try:
   if mode=='403':
    self.send_response(403);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(b'{"error":{"code":"PermissionDenied","message":"never reflect fixture-secret"}}');return
   if not payload.get('stream'):
    content=payload['messages'][-1]['content']
    if 'page_excerpt' in content:result={'preset':'technical','topic':'流式阅读'}
    else:
     data=json.loads(content)
     def parts(values):return [{'id':v['id'],'text':'译文替换 '+v['text'] if v['text'].strip() else v['text']} for v in values]
     result={'blocks':[{'id':b['id'],'parts':parts(b['parts'])} for b in data['blocks']]} if data.get('task')=='blocks' else {'parts':parts(data['parts'])} if data.get('task')=='block' else {'translation':'固定短词释义','kind':'word','sourceLanguage':'en'}
    self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(json.dumps({'choices':[{'message':{'content':json.dumps(result,ensure_ascii=False)}}]}).encode());return
   self.send_response(200);self.send_header('Content-Type','text/event-stream');self.send_header('Cache-Control','no-cache');self.end_headers()
   output='连接测试成功：侧栏可流式总结网页。' if '连接测试资料' in payload['messages'][-1]['content'] else DOC
   for at in range(0,len(output),50):
    chunk='data: '+json.dumps({'choices':[{'delta':{'content':output[at:at+50]}}]},ensure_ascii=False)+'\r\n\r\n'
    data=chunk.encode();self.wfile.write(data[:13]);self.wfile.flush();self.wfile.write(data[13:]);self.wfile.flush();time.sleep(.25 if mode=='slow' else .15 if mode=='brokenLate' else .045)
    if mode=='broken' and at>300 or mode=='brokenLate' and at>len(output)-130:return
   self.wfile.write(b'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');self.wfile.flush()
  except(BrokenPipeError,ConnectionResetError):pass
def passed(name,detail=None):
 report['checks'].append({'name':name,'result':'pass',**({'detail':detail} if detail else {})});print('PASS:',name,flush=True)
server=ThreadingHTTPServer(('127.0.0.1',0),Handler);Thread(target=server.serve_forever,daemon=True).start();origin='http://127.0.0.1:'+str(server.server_port)
browser=Path.home()/'Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
try:
 with tempfile.TemporaryDirectory(prefix='dianyi-summary-') as temp,sync_playwright() as p:
  temp=Path(temp);extension=temp/'extension'
  with zipfile.ZipFile(ROOT/'releases'/('dianyi-chrome-edge-'+VERSION+'.zip')) as z:z.extractall(extension)
  context=p.chromium.launch_persistent_context(str(temp/'profile'),executable_path=str(browser),headless=os.environ.get('DIANYI_HEADED')!='1',ignore_default_args=['--disable-extensions'],args=['--disable-extensions-except='+str(extension),'--load-extension='+str(extension)],viewport={'width':1200,'height':900},accept_downloads=True)
  try:
   worker=context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker');ext=worker.url.split('/')[2]
   ui=context.new_page();ui.on('pageerror',lambda e:errors.append(str(e)));ui.goto('chrome-extension://'+ext+'/options.html#summary')
   expect(ui.get_by_role('heading',name='总结设置',exact=True)).to_be_visible();expect(ui.locator('#current-model')).to_have_text('qwen-flash')
   def message(kind,**payload):
    reply=ui.evaluate('data=>chrome.runtime.sendMessage(data)',{'type':'SHIYI/'+kind,**payload});assert reply.get('ok'),reply;return reply['data']
   original=message('UI_STATE')['profile'];assert not message('UI_STATE')['summaryProfile']['configured'];assert len(calls)==0
   ui.get_by_role('button',name='自定义服务',exact=True).click();ui.get_by_label('服务地址',exact=True).fill(origin+'/v1');ui.get_by_label('模型名称',exact=True).fill('summary-fixture');ui.get_by_label('API Key',exact=True).fill('summary-fixture-key');ui.get_by_role('button',name='连接并保存',exact=True).click()
   expect(ui.locator('#connection-result')).to_contain_text('已连接并保存',timeout=12000);state=message('UI_STATE');assert state['summaryProfile']['configured'] and state['summaryProfile']['hasKey'];assert state['profile']==original
   passed('independent summary setup validates actual SSE and preserves translation config')
   profile={'provider':'custom','name':'Translation fixture','endpoint':origin+'/v1','model':'translation-fixture','auth':'bearer','timeoutSeconds':5,'rememberKey':False}
   message('SAVE_PROFILE',profile=profile,apiKey='translation-fixture-key')
   ui.locator('#prompt-technical').evaluate("n=>n.closest('details').open=true");ui.locator('#prompt-technical').fill('CUSTOM_TECHNICAL: 提炼技术步骤和依据。');ui.get_by_role('button',name='保存总结偏好',exact=True).click();expect(ui.locator('#notice')).to_contain_text('总结偏好已保存')
   passed('summary prompts persist in original options entrance')
   article=context.new_page();article.on('pageerror',lambda e:errors.append(str(e)));article.goto(origin+'/article?private=hidden');expect(article.locator('#shiyi-extension-root')).to_be_attached()
   tab=ui.evaluate('async url=>(await chrome.tabs.query({})).find(t=>t.url===url).id',article.url)
   panel=context.new_page();panel.on('pageerror',lambda e:errors.append(str(e)));panel.goto('chrome-extension://'+ext+'/summary.html');panel.set_viewport_size({'width':390,'height':900})
   def activate():ui.evaluate('id=>chrome.tabs.update(id,{active:true})',tab);panel.wait_for_timeout(200)
   activate();before=len(calls);message('SUMMARY_START',tabId=tab,preset='auto')
   expect(panel.locator('#summary-status')).to_contain_text('正在生成',timeout=12000);expect(panel.locator('#summary-doc')).to_contain_text('网页总结')
   assert panel.locator('#summary-stop').is_visible();assert len(calls)==before+2;assert calls[-1]['authorization']=='Bearer summary-fixture-key';assert calls[-1]['cookie'] is None
   body=calls[-1]['payload'];assert body['stream'] is True and 'CUSTOM_TECHNICAL' in body['messages'][0]['content'];source=body['messages'][-1]['content'];assert 'Original evidence' in source and 'original code' in source
   assert all(s not in source for s in ['INPUT_MUST_NOT_SEND','EDITOR_MUST_NOT_SEND','HIDDEN_MUST_NOT_SEND','?private=hidden'])
   passed('auto topic routing uses 2 requests, actual incremental SSE and scoped original source')
   expect(panel.locator('#summary-status')).to_have_text('总结完成',timeout=15000);expect(panel.locator('[data-kind="mermaid"] svg')).to_have_count(1);expect(panel.locator('[data-kind="math"] math')).to_have_count(1);expect(panel.locator('[data-kind="code"]')).to_have_count(1);expect(panel.locator('[data-kind="table"]')).to_have_count(1)
   assert panel.locator('#summary-doc img, #summary-doc script').count()==0
   assert panel.locator('form,input,select,textarea,[data-open="model"],[data-page-mode]').count()==0
   passed('local Markdown/code/table/Mermaid/math render under MV3 CSP; sidebar has no settings or translation')
   for width in [320,390,600]:
    panel.set_viewport_size({'width':width,'height':900});panel.wait_for_timeout(150);assert panel.evaluate('document.documentElement.scrollWidth<=innerWidth');panel.screenshot(path=str(OUT/('summary-'+str(width)+'.png')))
   passed('summary reading remains usable at 320, 390 and 600px')
   panel.set_viewport_size({'width':390,'height':720})
   panel.locator('#summary-scroller').evaluate('n=>n.scrollTop=650');panel.wait_for_timeout(100);contentTop=panel.locator('#summary-scroller').evaluate('n=>n.scrollTop')
   panel.get_by_role('button',name='制品 4',exact=True).click();panel.locator('#summary-scroller').evaluate('n=>n.scrollTop=90');panel.wait_for_timeout(100);artifactTop=panel.locator('#summary-scroller').evaluate('n=>n.scrollTop')
   panel.get_by_role('button',name='总结内容',exact=True).click();assert abs(panel.locator('#summary-scroller').evaluate('n=>n.scrollTop')-contentTop)<2
   panel.get_by_role('button',name='制品 4',exact=True).click();assert abs(panel.locator('#summary-scroller').evaluate('n=>n.scrollTop')-artifactTop)<2
   assert panel.locator('#summary-scroller').get_attribute('tabindex')=='0'
   passed('content/artifact views keep independent reading anchors and keyboard access')
   panel.set_viewport_size({'width':600,'height':900})
   panel.get_by_role('button',name='制品 4',exact=True).click();panel.locator('#summary-scroller').evaluate('n=>n.scrollTop=0');panel.screenshot(path=str(OUT/'summary-artifacts.png'))
   with panel.expect_download() as download:
    panel.locator('[data-kind="table"]').get_by_role('button',name='导出对照表 · CSV',exact=True).click();panel.get_by_role('button',name='表格（.csv）',exact=True).click()
   data=Path(download.value.path()).read_text(encoding='utf-8-sig');assert "'=HYPERLINK" in data
   with panel.expect_download() as download:
    panel.locator('[data-kind="mermaid"]').get_by_role('button',name='导出流程图 · Mermaid',exact=True).click();panel.get_by_role('button',name='图形（.svg）',exact=True).click()
   data=Path(download.value.path()).read_text();assert '<svg' in data and '<script' not in data
   with panel.expect_download() as download:
    panel.locator('[data-kind="code"]').get_by_role('button',name='导出代码 · javascript',exact=True).click();panel.get_by_role('button',name='代码（.js）',exact=True).click()
   assert 'const ready' in Path(download.value.path()).read_text()
   with panel.expect_download() as download:
    panel.locator('[data-kind="math"]').get_by_role('button',name='导出公式 · LaTeX',exact=True).click();panel.get_by_role('button',name='公式源码（.tex）',exact=True).click()
   assert 'mc^2' in Path(download.value.path()).read_text()
   passed('CSV formula protection and actual SVG/code/LaTeX downloads')
   panel.locator('#copy-summary').click();expect(panel.locator('#notice')).to_have_text('已复制')
   panel.locator('[data-kind="code"]').get_by_role('button',name='复制代码 · javascript',exact=True).click();expect(panel.locator('#notice')).to_have_text('已复制')
   for fmt,extensionName in [('Markdown（.md）','.md'),('可阅读文档（.html）','.html')]:
    with panel.expect_download() as download:panel.locator('#export-summary').click();panel.get_by_role('button',name=fmt,exact=True).click()
    data=Path(download.value.path()).read_text();assert '网页总结' in data and '?private=hidden' not in data
    if extensionName=='.html':assert '<svg' in data and '<math' in data and '<script' not in data
   passed('whole/per-artifact copy and standalone Markdown/HTML exports')
   panel.reload();activate();expect(panel.locator('#summary-status')).to_have_text('总结完成');assert len(calls)==before+2
   passed('reopening sidebar restores session result without another model request')
   message('PAGE_COMMAND',tabId=tab,action='translate',mode='translation')
   deadline=time.monotonic()+15
   while time.monotonic()<deadline:
    value=message('UI_STATE',tabId=tab)['tab']['page']
    if value and value['phase']=='complete':break
    panel.wait_for_timeout(100)
   assert '译文替换' in article.locator('#original').inner_text()
   before=len(calls);message('SUMMARY_START',tabId=tab,preset='technical');expect(panel.locator('#summary-status')).to_have_text('总结完成',timeout=15000)
   assert len(calls)==before+1 and 'Original evidence' in calls[-1]['payload']['messages'][-1]['content'] and '译文替换' not in calls[-1]['payload']['messages'][-1]['content']
   passed('translation-only mode summarizes original source, manual scene uses 1 request')
   for route in ['hidden-root','aria-root','display-root','editor-root','ancestor-root']:
    article.goto(origin+'/'+route);activate();message('SUMMARY_START',tabId=tab,preset='general');expect(panel.locator('#summary-status')).to_have_text('总结完成',timeout=15000)
    sent=calls[-1]['payload']['messages'][-1]['content'];assert 'ROOT_SECRET_MUST_NOT_SEND' not in sent and 'Original evidence' in sent,route
   article.evaluate('document.querySelector("main").contentEditable="true"');before=len(calls);message('SUMMARY_START',tabId=tab,preset='general');expect(panel.locator('#summary-status')).to_have_text('生成未完成');assert len(calls)==before
   article.evaluate('document.querySelector("main").contentEditable="false"')
   passed('hidden, aria-hidden, display-none and editable roots/ancestors never expose drafts')
   control['mode']='slow';message('SUMMARY_START',tabId=tab,preset='general');expect(panel.locator('#summary-doc')).to_contain_text('基于网页资料',timeout=10000);panel.locator('#summary-stop').click();expect(panel.locator('#summary-status')).to_contain_text('已停止');partial=panel.locator('#summary-doc').inner_text();panel.wait_for_timeout(600);assert panel.locator('#summary-doc').inner_text()==partial
   passed('stop aborts live transport, retains partial output and rejects late deltas')
   control['mode']='broken';message('SUMMARY_START',tabId=tab,preset='general');expect(panel.locator('#summary-status')).to_have_text('生成未完成',timeout=12000);assert panel.locator('#summary-doc').inner_text();expect(panel.locator('#summary-message')).to_contain_text('连接意外中断');assert panel.locator('#copy-summary').is_enabled()
   panel.screenshot(path=str(OUT/'summary-interrupted.png'));passed('abrupt disconnect shows recovery with copyable partial output')
   control['mode']='brokenLate';panel.set_viewport_size({'width':390,'height':550});message('SUMMARY_START',tabId=tab,preset='general')
   expect(panel.locator('#summary-doc')).to_contain_text('要点 3',timeout=12000)
   panel.locator('#summary-scroller').evaluate('n=>n.scrollTop=300');panel.wait_for_timeout(60)
   anchorScript='''()=>{const s=document.querySelector('#summary-scroller'),top=s.getBoundingClientRect().top;const n=[...document.querySelector('#summary-doc').children].find(n=>n.getBoundingClientRect().bottom>top+4);return {text:n.textContent,offset:n.getBoundingClientRect().top-top}}'''
   anchor=panel.evaluate(anchorScript);expect(panel.locator('#summary-status')).to_have_text('生成未完成',timeout=12000);after=panel.evaluate(anchorScript);assert anchor['text']==after['text'] and abs(anchor['offset']-after['offset'])<2,(anchor,after)
   passed('late stream errors preserve the reader anchor while adding recovery details')
   control['mode']='403';before=len(calls);message('SUMMARY_START',tabId=tab,preset='general');expect(panel.locator('#summary-status')).to_have_text('生成未完成');assert 'fixture-secret' not in panel.locator('#summary-message').inner_text();assert len(calls)==before+1
   passed('403 preserves useful diagnosis and does not auto-retry or echo raw secrets')
   control['mode']='ok';article.goto(origin+'/long');activate();message('SUMMARY_START',tabId=tab,preset='general');expect(panel.locator('#scope-note')).to_contain_text('60,000');expect(panel.locator('#summary-status')).to_have_text('总结完成',timeout=15000)
   passed('long input is explicitly bounded and truncation is visible')
   article.goto(origin+'/new-page');expect(panel.locator('#scope-note')).to_contain_text('来源网页已刷新或切换');before=len(calls);panel.wait_for_timeout(300);assert len(calls)==before
   passed('navigation marks old result and never automatically charges for new page')
   message('BLACKLIST_SET',site=origin,blocked=True);before=len(calls);message('SUMMARY_START',tabId=tab,preset='general');expect(panel.locator('#summary-message')).to_contain_text('黑名单');assert len(calls)==before
   message('BLACKLIST_SET',site=origin,blocked=False);message('CLEAR_SUMMARY_KEY');assert message('UI_STATE')['profile']['hasKey'];before=len(calls);message('SUMMARY_START',tabId=tab);expect(panel.locator('#summary-message')).to_contain_text('总结设置');assert len(calls)==before
   passed('blacklist and cleared summary credentials prevent requests; translation key stays independent')
   toolbar=context.new_page();toolbar.goto('chrome-extension://'+ext+'/popup.html?tab='+str(tab));expect(toolbar.locator('.summary-section')).to_be_visible();assert toolbar.locator('.popup-section').first.get_attribute('class').find('summary-section')>=0
   passed('popup summary entrance is first; original translation remains below')
   assert not errors,errors
   report['result']='pass';report['model_requests']=len(calls);report['page_errors']=errors
  finally:context.close()
except Exception as error:
 report['result']='fail';report['error']=str(error);report['page_errors']=errors;raise
finally:
 server.shutdown();server.server_close();(OUT/('summary-'+VERSION+'.json')).write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
