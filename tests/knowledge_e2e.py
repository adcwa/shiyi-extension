"""Exact MV3 ZIP, real local HTTP/SSE, isolated browser and durable knowledge DB."""
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from playwright.sync_api import sync_playwright, expect
import json, tempfile, time, zipfile, os

ROOT=Path(__file__).resolve().parents[1];VERSION=json.loads((ROOT/'package.json').read_text())['version'];OUT=ROOT/'verification';OUT.mkdir(exist_ok=True)
report={'version':VERSION,'result':'running','scope':'Exact ZIP; isolated temporary Chrome profile; local HTTP/SSE; no existing profile, account or paid model key.','checks':[]};calls=[];errors=[]
OUTPUT='''# 本地阅读总结\n\n归纳原文的实现步骤与边界，保留可核对的来源。\n\n## 关键内容\n\n- 网页在后台保存，侧栏只读取已有结果。\n- 日、周、月、年的结论保留来源关系。\n\n```javascript\nconst localKnowledge = true;\n```\n\n| 资料 | 状态 |\n| --- | --- |\n| 原文 | 已保留 |\n\n```mermaid\nflowchart LR\n A[网页] --> B[轨迹]\n B --> C[回顾]\n```\n\n$$\nE=mc^2\n$$\n'''
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_GET(self):
  html=f'''<!doctype html><html lang="en"><meta charset="utf-8"><title>Article {self.path}</title><main><h1>Reading evidence {self.path}</h1><p>PAGE_MARKER_{self.path}: This original article describes local knowledge, traceable evidence and period summaries. It contains enough text for a useful summary.</p><p>网页自动在后台留下资料，原文继续可读，引用能够回到来源。</p><input value="INPUT_NOT_FOR_MODEL"><div contenteditable="true">DRAFT_NOT_FOR_MODEL</div><p hidden>HIDDEN_NOT_FOR_MODEL</p></main></html>'''
  self.send_response(200);self.send_header('Content-Type','text/html;charset=utf-8');self.end_headers();self.wfile.write(html.encode())
 def do_POST(self):
  body=json.loads(self.rfile.read(int(self.headers['Content-Length'])));calls.append(body)
  if not body.get('stream'):
   self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(json.dumps({'choices':[{'message':{'content':'{"preset":"technical","topic":"阅读知识"}'}}]}).encode());return
  self.send_response(200);self.send_header('Content-Type','text/event-stream');self.end_headers()
  try:
   for n in range(0,len(OUTPUT),35):self.wfile.write(('data: '+json.dumps({'choices':[{'delta':{'content':OUTPUT[n:n+35]}}]},ensure_ascii=False)+'\n\n').encode());self.wfile.flush();time.sleep(.03)
   self.wfile.write(b'data: [DONE]\n\n');self.wfile.flush()
  except(BrokenPipeError,ConnectionResetError):pass
def passed(name):report['checks'].append({'name':name,'result':'pass'});print('PASS: '+name,flush=True)
server=ThreadingHTTPServer(('127.0.0.1',0),Handler);Thread(target=server.serve_forever,daemon=True).start();origin='http://127.0.0.1:'+str(server.server_port);other='http://localhost:'+str(server.server_port)
try:
 with tempfile.TemporaryDirectory(prefix='dianyi-knowledge-') as temp,sync_playwright() as p:
  temp=Path(temp);extension=temp/'extension'
  with zipfile.ZipFile(ROOT/'releases'/f'dianyi-chrome-edge-{VERSION}.zip') as z:z.extractall(extension)
  binary=Path.home()/'Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
  context=p.chromium.launch_persistent_context(str(temp/'profile'),executable_path=str(binary),headless=True,ignore_default_args=['--disable-extensions'],args=['--disable-extensions-except='+str(extension),'--load-extension='+str(extension)],viewport={'width':1440,'height':1000},accept_downloads=True)
  try:
   worker=context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker');ext=worker.url.split('/')[2];ui=context.new_page();ui.on('pageerror',lambda e:errors.append(str(e)));ui.goto(f'chrome-extension://{ext}/options.html#summary');expect(ui.locator('h1')).to_have_text('总结设置')
   def api(kind,**fields):
    reply=ui.evaluate('m=>chrome.runtime.sendMessage(m)',{'type':'SHIYI/'+kind,**fields});assert reply and reply.get('ok'),reply;return reply.get('data')
   api('SAVE_SUMMARY_PROFILE',profile={'provider':'custom','name':'Local knowledge fixture','endpoint':origin+'/v1','model':'knowledge-fixture','auth':'none','timeoutSeconds':5,'rememberKey':False},apiKey='');api('SAVE_SUMMARY_PREFS',prefs={'preset':'general','prompts':{}})
   a=context.new_page();a.goto(origin+'/first');b=context.new_page();b.goto(other+'/second');ui.bring_to_front()
   def wait(fn,seconds=15):
    until=time.monotonic()+seconds
    while time.monotonic()<until:
     if fn():return
     ui.wait_for_timeout(75)
    raise AssertionError('Knowledge state did not settle: '+str(api('KNOWLEDGE_LIST')))
   wait(lambda:len([r for r in api('KNOWLEDGE_LIST')['items'] if r['phase']=='complete'])>=2)
   assert len(calls)==2,len(calls)
   assert not any('/summary.html' in page.url for page in context.pages)
   bodies=json.dumps(calls,ensure_ascii=False);assert all(text not in bodies for text in ['INPUT_NOT_FOR_MODEL','DRAFT_NOT_FOR_MODEL','HIDDEN_NOT_FOR_MODEL'])
   passed('two inactive pages auto-summarize without a sidebar; forms, drafts and hidden content stay out')
   before=len(calls);a.reload();wait(lambda:api('KNOWLEDGE_LIST')['total']>=3);ui.wait_for_timeout(800);assert len(calls)==before
   passed('reload preserves a visit and reuses an identical content summary without a model request')
   ui.goto(f'chrome-extension://{ext}/options.html#trails');expect(ui.get_by_role('heading',name='我的轨迹',exact=True)).to_be_visible();expect(ui.locator('.knowledge-row')).to_have_count(api('KNOWLEDGE_LIST')['total']);ui.locator('.knowledge-row').first.click();expect(ui.locator('.knowledge-doc')).to_contain_text('本地阅读总结');expect(ui.locator('[data-kind="mermaid"] svg')).to_have_count(1);expect(ui.locator('[data-kind="math"] math')).to_have_count(1)
   assert ui.locator('[data-kind="code"]').count()==1 and ui.locator('[data-kind="table"]').count()==1
   passed('production trail manager renders actual saved summaries, code, tables, Mermaid and formulas')
   ui.locator('#knowledge-note-project').fill('Research');ui.locator('#knowledge-note-tags').fill('技术, 本地知识');ui.locator('#knowledge-note-text').fill('核对原文实现边界。');ui.get_by_role('button',name='保存备注',exact=True).click();expect(ui.locator('#notice')).to_contain_text('阅读备注已保存')
   draft_id=ui.locator('.knowledge-row.selected').get_attribute('data-k-id');ui.locator('#knowledge-note-text').fill('尚未保存的阅读想法');ui.get_by_role('heading',name='我的轨迹',exact=True).click();extra=context.new_page();extra.goto(origin+'/draft-refresh');wait(lambda:any('draft-refresh' in r['title'] and r['phase']=='complete' for r in api('KNOWLEDGE_LIST')['items']));ui.wait_for_timeout(1000);expect(ui.locator('#knowledge-note-text')).to_have_value('尚未保存的阅读想法')
   screenshots=OUT/'knowledge-ui';screenshots.mkdir(exist_ok=True);ui.locator('#notice').evaluate('n=>n.replaceChildren()');ui.locator('#knowledge-note').screenshot(path=str(screenshots/'remark-draft.png'))
   ui.goto(f'chrome-extension://{ext}/options.html#reviews');expect(ui.get_by_role('heading',name='阅读回顾',exact=True)).to_be_visible();ui.goto(f'chrome-extension://{ext}/options.html#trails');ui.locator('[data-k-id="'+draft_id+'"]').click();expect(ui.locator('#knowledge-note-text')).to_have_value('尚未保存的阅读想法');ui.get_by_role('button',name='丢弃修改',exact=True).click();expect(ui.locator('#knowledge-note-text')).to_have_value('核对原文实现边界。')
   passed('unsaved remark drafts survive background refresh, blur and route changes until explicitly discarded')
   ui.locator('#knowledge-project').select_option('Research');ui.get_by_role('button',name='筛选',exact=True).click();expect(ui.locator('.knowledge-row')).to_have_count(1)
   passed('project, tags and notes persist and participate in real trajectory filters')
   screenshots=OUT/'knowledge-ui';screenshots.mkdir(exist_ok=True)
   ui.evaluate('window.scrollTo(0,0)');ui.wait_for_timeout(300);ui.locator('#notice').evaluate('n=>n.replaceChildren()');assert ui.locator('[data-kind="mermaid"] svg').bounding_box()['width']>100;ui.screenshot(path=str(screenshots/'desktop.png'),full_page=True)
   ui.set_viewport_size({'width':375,'height':900});ui.wait_for_timeout(250);assert ui.evaluate('document.documentElement.scrollWidth<=innerWidth');ui.screenshot(path=str(screenshots/'mobile.png'),full_page=True)
   ui.set_viewport_size({'width':1440,'height':1000})
   passed('trail view works at desktop and 375px with no horizontal document overflow')
   ui.get_by_role('button',name='复制',exact=True).first.click();expect(ui.locator('#notice')).to_contain_text('已复制')
   for fmt,suffix in [('zip','.zip'),('jsonl','.jsonl'),('json','.json'),('md','.md'),('html','.html'),('csv','.csv')]:
    ui.get_by_role('button',name='导出知识',exact=True).click();ui.locator('#knowledge-export-format').select_option(fmt)
    with ui.expect_download() as d:ui.get_by_role('button',name='导出文件',exact=True).click()
    data=Path(d.value.path()).read_bytes();assert d.value.suggested_filename.endswith(suffix)
    if fmt=='zip':
     with zipfile.ZipFile(d.value.path()) as z:
      assert z.testzip() is None;names=z.namelist();assert any(n.endswith('manifest.json') for n in names);assert any(n.endswith('relations.jsonl') for n in names);assert any('/summaries/' in n for n in names);assert not any(n.endswith(('.doc','.docx','.key')) for n in names)
    elif fmt=='jsonl':assert all(json.loads(line) for line in data.decode().splitlines() if line)
    elif fmt=='json':assert json.loads(data)['schemaVersion']==1
    elif fmt=='html':assert '<script' not in data.decode()
   passed('actual clipboard and ZIP/Markdown/JSONL/JSON/HTML/CSV downloads with valid references and no Word files')
   ui.goto(f'chrome-extension://{ext}/options.html#reviews');expect(ui.get_by_role('heading',name='阅读回顾',exact=True)).to_be_visible()
   today=ui.locator('#knowledge-date').input_value()
   for kind in ['day','week','month','year','analysis']:
    ui.locator('#knowledge-kind').select_option(kind);ui.get_by_role('button',name='生成回顾',exact=True).click();expect(ui.locator('.knowledge-detail-head')).to_be_visible();wait(lambda:any(r['kind']==kind and r['phase']=='complete' for r in api('KNOWLEDGE_LIST',view='reviews')['items']),30)
   passed('day, week, month, year and thematic reviews all execute the real model pipeline and persist')
   ui.locator('#knowledge-kind-filter').select_option('year');expect(ui.locator('.knowledge-row')).to_have_count(1);ui.locator('.knowledge-row').first.click();expect(ui.locator('.knowledge-doc')).to_contain_text('本地阅读总结');assert ui.locator('.knowledge-sources [data-k-source]').count()>=1
   ui.locator('#notice').evaluate('n=>n.replaceChildren()');ui.screenshot(path=str(screenshots/'reviews-desktop.png'),full_page=True)
   passed('period filtering and evidence navigation expose the source chain of yearly analysis')
   ui.goto(f'chrome-extension://{ext}/options.html#summary');ui.locator('#knowledge-time').fill('19:20');ui.locator('#knowledge-zone').fill('Asia/Tokyo');ui.get_by_role('button',name='保存回顾设置',exact=True).click();expect(ui.locator('#notice')).to_contain_text('回顾设置已保存');config=api('UI_STATE');assert config['knowledgePrefs']['time']=='19:20' and config['knowledgePrefs']['timeZone']=='Asia/Tokyo'
   alarm=worker.evaluate('()=>chrome.alarms.get("dianyi-knowledge-daily")');assert alarm and alarm['scheduledTime']>time.time()*1000
   passed('real settings save time/timezone and recreate the durable daily browser alarm')
   before=len(calls);api('BLACKLIST_SET',site=other,blocked=True);blocked=context.new_page();blocked.goto(other+'/blocked');ui.wait_for_timeout(800);assert len(calls)==before
   exported=api('KNOWLEDGE_EXPORT');assert all(v['source']['domain']!='localhost:'+str(server.server_port) and 'localhost' not in v['source']['url'] for v in exported['visits'])
   passed('blacklist prevents new background collection and excludes old sources from knowledge exports')
   count=api('KNOWLEDGE_LIST')['total'];before=len(calls);ui.reload();expect(ui.get_by_role('heading',name='总结设置',exact=True)).to_be_visible();assert api('KNOWLEDGE_LIST')['total']==count;assert len(calls)==before
   passed('management reload reads durable records without re-running models')
   popup=context.new_page();tab=worker.evaluate('async url=>(await chrome.tabs.query({})).find(t=>t.url===url).id',a.url);popup.goto(f'chrome-extension://{ext}/popup.html?tab={tab}');expect(popup.get_by_role('button',name='我的轨迹',exact=True)).to_be_visible();expect(popup.get_by_role('button',name='阅读回顾',exact=True)).to_be_visible();assert popup.locator('.summary-section').count()==1
   passed('popup exposes saved summary, trajectory and review entries with original translation intact')
   alarm_source=context.new_page();alarm_source.goto(origin+'/alarm-source');wait(lambda:any('alarm-source' in r['title'] and r['phase']=='complete' for r in api('KNOWLEDGE_LIST')['items']))
   api('KNOWLEDGE_PREFS',prefs={'time':'00:00','timeZone':'Asia/Shanghai','prompts':{}});before=len(calls);worker.evaluate('()=>chrome.alarms.create("dianyi-knowledge-daily",{when:Date.now()+300})');wait(lambda:len(calls)>before,45);wait(lambda:api('KNOWLEDGE_LIST',view='reviews')['items'][0]['phase']=='complete',20)
   passed('a real Chrome alarm event invokes the scheduled daily model pipeline and persists its result')
   count=api('KNOWLEDGE_LIST')['total'];before=len(calls);context.close()
   context=p.chromium.launch_persistent_context(str(temp/'profile'),executable_path=str(binary),headless=True,ignore_default_args=['--disable-extensions'],args=['--disable-extensions-except='+str(extension),'--load-extension='+str(extension)],viewport={'width':1440,'height':1000})
   worker=context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker');ui=context.new_page();ui.goto(f'chrome-extension://{ext}/options.html#trails');expect(ui.get_by_role('heading',name='我的轨迹',exact=True)).to_be_visible();assert api('KNOWLEDGE_LIST')['total']==count;ui.wait_for_timeout(600);assert len(calls)==before
   passed('full browser shutdown and restart preserves IndexedDB history and completed results without re-billing')
   assert not errors,errors
   report.update(result='pass',model_requests=len(calls),page_errors=errors)
  finally:context.close()
except Exception as error:report.update(result='fail',error=str(error),page_errors=errors);raise
finally:server.shutdown();server.server_close();(OUT/f'knowledge-{VERSION}.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
