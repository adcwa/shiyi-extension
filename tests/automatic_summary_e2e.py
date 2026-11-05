"""Automatic cost control from the exact ZIP, using isolated Chrome and local SSE."""
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from playwright.sync_api import sync_playwright, expect
from browser_binary import browser_binary
import json, tempfile, time, zipfile

ROOT=Path(__file__).resolve().parents[1]
VERSION=json.loads((ROOT/'package.json').read_text())['version']
OUT=ROOT/'verification';OUT.mkdir(exist_ok=True)
report={'version':VERSION,'result':'running','scope':'Exact ZIP, isolated temporary Chrome profile, real localhost HTTP/SSE; no paid provider or existing user profile.','checks':[]}
calls=[];errors=[];slow=False
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_GET(self):
  self.send_response(200);self.send_header('Content-Type','text/html;charset=utf-8');self.end_headers()
  self.wfile.write(f'<!doctype html><html><meta charset="utf-8"><title>{self.path}</title><main><h1>Evidence {self.path}</h1><p>Original article {self.path} about local reading knowledge and explicit model usage. Enough visible text to summarize.</p></main></html>'.encode())
 def do_POST(self):
  body=json.loads(self.rfile.read(int(self.headers['Content-Length'])));calls.append(body)
  self.send_response(200);self.send_header('Content-Type','text/event-stream');self.end_headers()
  try:
   self.wfile.write(('data: '+json.dumps({'choices':[{'delta':{'content':'## 手动与自动总结\n\n保留原文依据与本地结果。'}}]},ensure_ascii=False)+'\n\n').encode());self.wfile.flush()
   if slow:time.sleep(3)
   self.wfile.write(b'data: [DONE]\n\n');self.wfile.flush()
  except(BrokenPipeError,ConnectionResetError):pass
def passed(name):
 report['checks'].append({'name':name,'result':'pass'});print('PASS: '+name,flush=True)
server=ThreadingHTTPServer(('127.0.0.1',0),Handler);Thread(target=server.serve_forever,daemon=True).start()
origin=f'http://127.0.0.1:{server.server_port}'
try:
 with tempfile.TemporaryDirectory(prefix='dianyi-automatic-') as temporary,sync_playwright() as p:
  temp=Path(temporary);extension=temp/'extension'
  with zipfile.ZipFile(ROOT/'releases'/f'dianyi-chrome-edge-{VERSION}.zip') as z:z.extractall(extension)
  binary=browser_binary()
  def launch():return p.chromium.launch_persistent_context(str(temp/'profile'),executable_path=binary,headless=True,ignore_default_args=['--disable-extensions'],args=['--disable-extensions-except='+str(extension),'--load-extension='+str(extension)],viewport={'width':1440,'height':950})
  context=launch()
  try:
   worker=context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker');ext=worker.url.split('/')[2]
   ui=context.new_page();ui.on('pageerror',lambda e:errors.append(str(e)));ui.goto(f'chrome-extension://{ext}/options.html#summary');expect(ui.locator('#auto-summary-setting')).not_to_be_checked()
   def api(kind,**fields):
    reply=ui.evaluate('m=>chrome.runtime.sendMessage(m)',{'type':'SHIYI/'+kind,**fields});assert reply['ok'],reply;return reply.get('data')
   def wait(fn):
    deadline=time.monotonic()+15
    while time.monotonic()<deadline:
     if fn():return
     ui.wait_for_timeout(50)
    raise AssertionError('State did not settle: '+str(api('KNOWLEDGE_LIST')))
   assert api('UI_STATE')['knowledgePrefs']['autoSummary'] is False
   assert worker.evaluate('()=>chrome.alarms.get("dianyi-knowledge-daily")') is None
   passed('fresh install visibly defaults off and has no automatic daily alarm')
   api('SAVE_SUMMARY_PROFILE',profile={'provider':'custom','name':'Local automatic fixture','endpoint':origin+'/v1','model':'local-auto','auth':'none','timeoutSeconds':5},apiKey='')
   api('SAVE_SUMMARY_PREFS',prefs={'preset':'general','prompts':{}})
   article=context.new_page();article.goto(origin+'/off-first');article.reload();ui.wait_for_timeout(900)
   assert len(calls)==0;data=api('KNOWLEDGE_EXPORT',originals=True);assert not data['snapshots'] and not data['summaries']
   tab=worker.evaluate('async url=>(await chrome.tabs.query({})).find(t=>t.url===url).id',article.url)
   popup=context.new_page();popup.goto(f'chrome-extension://{ext}/popup.html?tab={tab}')
   expect(popup.locator('#auto-summary-switch')).to_have_attribute('aria-checked','false');expect(popup.locator('#summarize-page')).to_be_enabled()
   assert popup.locator('#page-translate').bounding_box()['y'] < popup.locator('#summarize-page').bounding_box()['y']
   assert popup.locator('#auto-summary-switch').bounding_box()['y'] < 460
   assert popup.locator('#popup').bounding_box()['height'] <= 460
   for label in ['词句库', '我的轨迹', '阅读回顾']:
    expect(popup.get_by_role('button',name=label,exact=True)).to_be_in_viewport()
   shots=OUT/'automatic-summary-ui';shots.mkdir(exist_ok=True);popup.locator('.summary-section').screenshot(path=str(shots/'popup-off.png'))
   passed('configuring a model and browsing or reloading never bills while off; translation comes first and both tasks and local data links fit the popup')
   panel=context.new_page();panel.goto(f'chrome-extension://{ext}/summary.html?tabId={tab}')
   expect(panel.locator('#summary-status')).to_have_text('自动总结已关闭');panel.wait_for_timeout(500);assert len(calls)==0
   panel.locator('#summary-retry').click();expect(panel.locator('#summary-status')).to_have_text('总结完成')
   assert len(calls)==1 and not api('UI_STATE')['knowledgePrefs']['autoSummary']
   panel.reload();expect(panel.locator('#summary-status')).to_have_text('总结完成');ui.wait_for_timeout(300);assert len(calls)==1
   passed('panel restore does not auto-run; its manual summary button works off and reload reuses the result')
   popup.locator('#auto-summary-switch').click();expect(popup.locator('#auto-summary-switch')).to_have_attribute('aria-checked','true')
   assert api('UI_STATE')['knowledgePrefs']['autoSummary'];assert worker.evaluate('()=>chrome.alarms.get("dianyi-knowledge-daily")')
   automatic=context.new_page();automatic.goto(origin+'/enabled');wait(lambda:any('enabled' in r['title'] and r['phase']=='complete' for r in api('KNOWLEDGE_LIST')['items']))
   popup.locator('.summary-section').screenshot(path=str(shots/'popup-on.png'))
   passed('one click enables persisted automation and new pages summarize in the background')
   slow=True;inflight=context.new_page();before=len(calls);inflight.goto(origin+'/slow-auto');wait(lambda:len(calls)==before+1)
   queued=context.new_page();queued.goto(origin+'/queued-auto');ui.wait_for_timeout(200)
   popup.locator('#auto-summary-switch').click();expect(popup.locator('#auto-summary-switch')).to_have_attribute('aria-checked','false')
   before=len(calls);ui.wait_for_timeout(3300);assert len(calls)==before
   data=api('KNOWLEDGE_EXPORT');assert any('slow-auto' in s.get('source',{}).get('title','') and s['phase']=='waiting' for s in data['summaries'])
   assert all('queued-auto' not in c['messages'][-1]['content'] for c in calls)
   assert not worker.evaluate('()=>chrome.alarms.get("dianyi-knowledge-daily")');slow=False
   passed('turning off cancels the in-flight automatic stream, pauses queued work and removes the daily alarm')
   ui.reload();expect(ui.locator('#auto-summary-setting')).not_to_be_checked();ui.locator('#review-advanced > summary').click();ui.locator('#knowledge-time').fill('19:25');ui.get_by_role('button',name='保存回顾设置',exact=True).click();expect(ui.locator('#notice')).to_contain_text('回顾设置已保存')
   api('KNOWLEDGE_PREFS',prefs={'time':'19:30'});assert api('UI_STATE')['knowledgePrefs']['autoSummary'] is False
   worker.evaluate('()=>chrome.alarms.create("dianyi-knowledge-daily",{when:Date.now()+100})');api('KNOWLEDGE_RESUME');ui.wait_for_timeout(700);assert len(calls)==before
   assert not worker.evaluate('()=>chrome.alarms.get("dianyi-knowledge-daily")')
   passed('settings retain off and changing schedule, resuming jobs or firing an old daily alarm never spends quota')
   context.close();context=launch();worker=context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
   ui=context.new_page();ui.goto(f'chrome-extension://{ext}/options.html#summary');expect(ui.locator('#auto-summary-setting')).not_to_be_checked();ui.wait_for_timeout(600)
   assert len(calls)==before;article=context.new_page();article.goto(origin+'/after-restart');ui.wait_for_timeout(400);assert len(calls)==before
   tab=worker.evaluate('async url=>(await chrome.tabs.query({})).find(t=>t.url===url).id',article.url);api('SUMMARY_START',tabId=tab,preset='general')
   wait(lambda:any('after-restart' in r['title'] and r['phase']=='complete' for r in api('KNOWLEDGE_LIST')['items']))
   assert len(calls)==before+1 and not api('UI_STATE')['knowledgePrefs']['autoSummary']
   passed('full browser restart keeps automation off and old jobs paused; explicit summary still works')
   assert not errors,errors;report.update(result='pass',model_requests=len(calls),page_errors=errors)
  finally:context.close()
except Exception as error:report.update(result='fail',error=str(error),page_errors=errors);raise
finally:server.shutdown();server.server_close();(OUT/f'automatic-summary-{VERSION}.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
