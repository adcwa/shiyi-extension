"""Headed OS-native menu acceptance in a throwaway Chrome profile.

Run, then operate the real browser context menus. No event replay or test hooks;
the loop records the live extension state and closes after the full native flow.
"""
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from playwright.sync_api import sync_playwright, expect
import json, tempfile, time

ROOT=Path(__file__).resolve().parents[1];VERSION=json.loads((ROOT/'package.json').read_text())['version'];OUT=ROOT/'verification';OUT.mkdir(exist_ok=True)
HTML='''<!doctype html><html><head><meta charset="utf-8"><title>点译 · 原生右键验收</title><style>body{background:#f5f5f0;color:#263735;font:25px/1.9 Georgia,serif;margin:0}main{max-width:850px;margin:50px auto;padding:40px;background:white;border:1px solid #dfe6dc;border-radius:12px}h1{font-size:36px;line-height:1.3;font-weight:400}small{font:12px system-ui;color:#006665}p{margin:25px 0}</style></head><body><main><small>点译 / 本地原生菜单验收</small><h1>Right-click, then keep reading.</h1><p id="sample">A moment of curiosity can change the way we read.</p><p>Words stay in the local glossary. A whole page can be read in two languages.</p></main></body></html>'''
calls=[]
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_GET(self):
  self.send_response(200);self.send_header('Content-Type','text/html;charset=utf-8');self.end_headers();self.wfile.write(HTML.encode())
 def do_POST(self):
  body=json.loads(self.rfile.read(int(self.headers['Content-Length'])));data=json.loads(body['messages'][-1]['content']);calls.append(data.get('task','word'))
  if data.get('task') in ('block','blocks'):
   def translated(parts):return [{'id':part['id'],'text':'译文：'+part['text']} for part in parts]
   result={'blocks':[{'id':block['id'],'parts':translated(block['parts'])} for block in data['blocks']]} if data['task']=='blocks' else {'parts':translated(data['parts'])}
  else:result={'translation':'好奇心；求知欲','sourceLanguage':'en','kind':'word'}
  self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(json.dumps({'choices':[{'message':{'content':json.dumps(result,ensure_ascii=False)}}]}).encode())
server=ThreadingHTTPServer(('127.0.0.1',0),Handler);Thread(target=server.serve_forever,daemon=True).start();origin='http://127.0.0.1:'+str(server.server_port)
binary=next(folder/'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' for folder in sorted((Path.home()/'Library/Caches/ms-playwright').glob('chromium-*'),key=lambda p:int(p.name.split('-')[-1]),reverse=True) if (folder/'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing').exists())
report={'version':VERSION,'result':'running','real_native_clicks':True,'events':[],'model_calls':0}
try:
 with tempfile.TemporaryDirectory(prefix='shiyi-native-menu-') as tmp,sync_playwright() as playwright:
  extension=ROOT/'releases'/('shiyi-'+VERSION)
  context=playwright.chromium.launch_persistent_context(tmp,executable_path=str(binary),headless=False,ignore_default_args=['--disable-extensions'],args=['--disable-extensions-except='+str(extension),'--load-extension='+str(extension)],viewport={'width':1180,'height':840})
  try:
   worker=context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker',timeout=15000);ext=worker.url.split('/')[2];ui=context.new_page();ui.goto('chrome-extension://'+ext+'/options.html#model');expect(ui.locator('h1')).to_be_visible()
   response=ui.evaluate('profile=>chrome.runtime.sendMessage({type:"SHIYI/SAVE_PROFILE",profile,apiKey:""})',{'provider':'custom','name':'本地原生菜单验收','endpoint':origin+'/v1/chat/completions','model':'local-native-check','auth':'none','timeoutSeconds':5,'rememberKey':False});assert response['ok'],response
   article=context.new_page();article.goto(origin+'/native-menu');expect(article.locator('#shiyi-extension-root')).to_be_attached();article.bring_to_front();tab=ui.evaluate('async url=>(await chrome.tabs.query({})).find(tab=>tab.url===url).id',article.url)
   rect=article.evaluate('''()=>{const text=document.querySelector('#sample').firstChild,index=text.data.indexOf('curiosity'),range=document.createRange();range.setStart(text,index);range.setEnd(text,index+9);getSelection().removeAllRanges();getSelection().addRange(range);const rect=range.getBoundingClientRect();return{x:rect.left+rect.width/2,y:rect.top+rect.height/2}}''')
   article.mouse.click(rect['x'],rect['y'],button='right')
   print(json.dumps({'ready':True,'application':str(binary.parent.parent),'title':'点译 · 原生右键验收','flow':'translate selected word; translate page; disable website; enable website'},ensure_ascii=False),flush=True)
   seen=set();deadline=time.monotonic()+600
   while time.monotonic()<deadline:
    article.wait_for_timeout(250)
    state=ui.evaluate('id=>chrome.runtime.sendMessage({type:"SHIYI/UI_STATE",tabId:id})',tab)['data'];page=state['tab']['page'] or {}
    event=None
    if state['count']>=1 and 'selection' not in seen:event='selection'
    elif page.get('active') and not page.get('running') and page.get('completed',0)>0 and 'page' not in seen:event='page'
    elif state['tab']['blocked'] and 'blocked' not in seen:event='blocked'
    elif 'blocked' in seen and state['tab']['enabled'] and 'restored' not in seen:event='restored'
    if event:
     seen.add(event);report['events'].append(event);print('NATIVE PASS: '+event,flush=True)
     article.screenshot(path=str(OUT/('native-menu-'+event+'.png')),caret='initial')
    if seen=={'selection','page','blocked','restored'}:report['result']='pass';break
   else:report['result']='incomplete'
  finally:context.close()
finally:
 server.shutdown();server.server_close();report['model_calls']=len(calls);(OUT/'native-context-menu.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(report,ensure_ascii=False),flush=True)
