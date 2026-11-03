"""OS-native popup/right-click/side-panel resizing in a temporary profile.
Run this harness, operate Chrome through CUA, then write the recorded observations
to verification/summary-native-observations.json to finish. No production hooks.
"""
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from playwright.sync_api import sync_playwright, expect
import json,tempfile,time
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'verification';VERSION=json.loads((ROOT/'package.json').read_text())['version']
calls=[]
HTML='''<!doctype html><meta charset="utf-8"><title>点译 · 总结侧栏实际验收</title><style>body{margin:0;background:#f5f7f3;color:#263735;font:18px/1.9 system-ui}main{max-width:750px;margin:55px auto;padding:35px;background:white}h1{font-size:28px}p{margin:22px 0}</style><main><h1>阅读留在网页，总结在身边。</h1><p>这是一篇用于验收点译正式插件的本地文章。所有请求都发往本机测试服务，不使用真实模型密钥。</p><p>The summary panel streams the main points without translating or changing the original page. Readers can resize the browser sidebar, stop generation, and export the result.</p><p>请从工具栏点译的顶部入口，或网页右键菜单打开总结。</p></main>'''
OUTPUT='''# 让总结与阅读并行\n\n保留网页原文，通过独立侧栏逐步展示主旨、依据与结论。\n\n## 关键体验\n\n- 总结模型独立配置，不影响翻译。\n- 拖动浏览器侧栏分隔线，可调整阅读宽度。\n- 生成过程中可以停止，已有内容可复制和导出。\n\n| 操作 | 结果 |\n| --- | --- |\n| 点击插件顶部 | 打开总结侧栏 |\n| 网页右键 | 一步总结当前页 |\n\n```mermaid\nflowchart LR\n A[网页正文] --> B[独立模型]\n B --> C[流式总结]\n```\n\n```javascript\nconst reading = true;\n```\n\n$$\nE=mc^2\n$$\n'''
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_GET(self):
  self.send_response(200);self.send_header('Content-Type','text/html;charset=utf-8');self.end_headers();self.wfile.write(HTML.encode())
 def do_POST(self):
  payload=json.loads(self.rfile.read(int(self.headers['Content-Length'])));calls.append({'stream':payload.get('stream'),'model':payload['model']})
  if not payload.get('stream'):
   self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(json.dumps({'choices':[{'message':{'content':'{"preset":"technical","topic":"网页阅读工具"}'}}]}).encode());return
  self.send_response(200);self.send_header('Content-Type','text/event-stream');self.end_headers()
  try:
   for n in range(0,len(OUTPUT),15):
    self.wfile.write(('data: '+json.dumps({'choices':[{'delta':{'content':OUTPUT[n:n+15]}}]},ensure_ascii=False)+'\n\n').encode());self.wfile.flush();time.sleep(.12)
   self.wfile.write(b'data: [DONE]\n\n');self.wfile.flush()
  except(BrokenPipeError,ConnectionResetError):pass
server=ThreadingHTTPServer(('127.0.0.1',0),Handler);Thread(target=server.serve_forever,daemon=True).start();origin='http://127.0.0.1:'+str(server.server_port)
report={'version':VERSION,'result':'running','scope':'Actual native Chrome UI, temporary isolated profile, unchanged release; local SSE fixture.','native_menu_replay':False,'observations':[]}
try:
 with tempfile.TemporaryDirectory(prefix='dianyi-native-summary-') as temp,sync_playwright() as p:
  binary=Path.home()/'Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
  extension=ROOT/'releases'/('dianyi-'+VERSION)
  context=p.chromium.launch_persistent_context(temp,executable_path=str(binary),headless=False,ignore_default_args=['--disable-extensions'],args=['--window-size=1200,900','--disable-extensions-except='+str(extension),'--load-extension='+str(extension)],no_viewport=True)
  try:
   worker=context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker');ext=worker.url.split('/')[2];ui=context.new_page();ui.goto('chrome-extension://'+ext+'/options.html#summary');expect(ui.locator('h1')).to_be_visible()
   reply=ui.evaluate('profile=>chrome.runtime.sendMessage({type:"SHIYI/SAVE_SUMMARY_PROFILE",profile,apiKey:""})',{'provider':'custom','name':'本地侧栏验收','endpoint':origin+'/v1','model':'local-summary-fixture','auth':'none','timeoutSeconds':5,'rememberKey':False});assert reply['ok'],reply
   article=context.new_page();article.goto(origin+'/native-summary');expect(article.locator('#shiyi-extension-root')).to_be_attached();article.bring_to_front()
   tab=ui.evaluate('async url=>(await chrome.tabs.query({})).find(t=>t.url===url).id',article.url)
   for page in list(context.pages):
    if page!=article:page.close()
   print(json.dumps({'ready':True,'title':'点译 · 总结侧栏实际验收','browser':str(binary.parent.parent),'tab':tab,'source_width':article.evaluate('innerWidth')},ensure_ascii=False),flush=True)
   deadline=time.monotonic()+900;last=0;geometry=[]
   while time.monotonic()<deadline:
    article.wait_for_timeout(400)
    width=article.evaluate('innerWidth')
    if not geometry or geometry[-1]['width']!=width:geometry.append({'width':width,'model_calls':len(calls)})
    if len(calls)!=last:print('REAL REQUESTS: '+str(len(calls)),flush=True);last=len(calls)
    progress={'version':VERSION,'model_calls':len(calls),'geometry':geometry,'targets':[]}
    (OUT/'summary-native-progress.json').write_text(json.dumps(progress,ensure_ascii=False,indent=2))
    observations=OUT/'summary-native-observations.json'
    if observations.exists():
     report.update(json.loads(observations.read_text()));report['geometry']=geometry;report['model_calls']=len(calls);report['result']='pass' if len(calls)>=4 and len({x['width'] for x in geometry})>=4 else 'fail';break
   else:report['result']='incomplete'
  finally:context.close()
finally:
 server.shutdown();server.server_close();(OUT/('summary-native-'+VERSION+'.json')).write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps(report,ensure_ascii=False),flush=True)
