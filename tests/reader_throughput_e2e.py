"""Measure the actual installed reader on 120 unique short blocks.

A local deterministic endpoint adds 80ms per request. This isolates scheduling,
request count and layout, and does not predict a vendor's token generation rate.
Use --baseline before a change to preserve the failing comparison report.
"""
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread, Lock
from playwright.sync_api import sync_playwright, expect
import json, os, shutil, sys, tempfile, time
ROOT=Path(__file__).resolve().parents[1]
VERSION=json.loads((ROOT/'package.json').read_text())['version']
OUT=ROOT/'verification';OUT.mkdir(exist_ok=True)
ARTICLE='<!doctype html><meta charset="utf-8"><title>120 blocks</title><style>body{margin:28px;background:#fff;color:#283a35;font:17px/1.8 system-ui}main{max-width:760px;margin:auto}p{margin:18px 0}</style><main>'+''.join('<p id="p'+str(i)+'">Reading paragraph '+str(i)+' preserves every useful detail and link.</p>' for i in range(120))+'</main>'
calls=[];lock=Lock();state={'active':0,'peak':0}
class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def do_GET(self):
        self.send_response(200);self.send_header('Content-Type','text/html;charset=utf-8');self.end_headers();self.wfile.write(ARTICLE.encode())
    def do_POST(self):
        raw=json.loads(self.rfile.read(int(self.headers.get('Content-Length',0))));data=json.loads(raw['messages'][-1]['content'])
        with lock:calls.append(data);state['active']+=1;state['peak']=max(state['peak'],state['active'])
        try:
            time.sleep(.08)
            def translate(parts):return [{'id':p['id'],'text':'阅读时保留每个有用的细节。 '+p['text']} for p in parts]
            if data.get('task')=='blocks':result={'blocks':[{'id':b['id'],'parts':translate(b['parts'])} for b in data['blocks']]}
            else:
                parts=translate(data['parts']);result={'translation':''.join(p['text'] for p in parts),'parts':parts}
            self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(json.dumps({'choices':[{'message':{'content':json.dumps(result,ensure_ascii=False)}}]}).encode())
        except (BrokenPipeError,ConnectionResetError):pass
        finally:
            with lock:state['active']-=1
server=ThreadingHTTPServer(('127.0.0.1',0),Handler);Thread(target=server.serve_forever,daemon=True).start()
origin='http://127.0.0.1:'+str(server.server_port)
report={'version':VERSION,'scope':'Actual MV3 reader; 120 unique short paragraphs; fixed local 80ms endpoint delay, not real LLM throughput.'}
try:
    with tempfile.TemporaryDirectory(prefix='shiyi-throughput-') as folder,sync_playwright() as p:
        folder=Path(folder);extension=folder/'extension';shutil.copytree(ROOT/'releases'/('shiyi-'+VERSION),extension)
        cache=Path.home()/'Library/Caches/ms-playwright';browser=next(cache.glob('chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'))
        ctx=p.chromium.launch_persistent_context(str(folder/'profile'),executable_path=str(browser),headless=True,ignore_default_args=['--disable-extensions'],args=['--disable-extensions-except='+str(extension),'--load-extension='+str(extension)],viewport={'width':1200,'height':900})
        try:
            worker=ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker');ext=worker.url.split('/')[2]
            ui=ctx.new_page();ui.goto('chrome-extension://'+ext+'/options.html#model');expect(ui.get_by_label('API Key',exact=True)).to_be_visible()
            def message(kind,**extra):
                result=ui.evaluate('data=>chrome.runtime.sendMessage(data)',{'type':'SHIYI/'+kind,**extra});assert result['ok'],result;return result['data']
            profile={'provider':'custom','name':'Local throughput fixture','endpoint':origin+'/v1/chat/completions','model':'throughput-fixture','auth':'none','timeoutSeconds':5,'rememberKey':False}
            message('SAVE_PROFILE',profile=profile)
            article=ctx.new_page();article.goto(origin+'/120-blocks');expect(article.locator('#shiyi-extension-root')).to_be_attached()
            tab=ui.evaluate('async url=>(await chrome.tabs.query({})).find(t=>t.url===url).id',article.url)
            article.locator('#p100').scroll_into_view_if_needed()
            article.evaluate('''()=>{window.firstTranslationMs=null;window.firstVisibleTranslationMs=null;window.firstTranslatedOwner=null;window.readerStarted=performance.now();new MutationObserver(()=>{const nodes=[...document.querySelectorAll('[data-shiyi-block-translation]')];if(firstTranslationMs===null&&nodes.length){firstTranslationMs=performance.now()-readerStarted;firstTranslatedOwner=nodes[0].previousElementSibling?.id}if(firstVisibleTranslationMs===null&&nodes.some(n=>{const r=n.getBoundingClientRect();return r.bottom>0&&r.top<innerHeight}))firstVisibleTranslationMs=performance.now()-readerStarted}).observe(document.body,{childList:true,subtree:true})}''')
            start=time.monotonic();message('PAGE_COMMAND',tabId=tab,action='translate',mode='bilingual')
            deadline=start+30
            while time.monotonic()<deadline:
                current=message('UI_STATE',tabId=tab)['tab']['page']
                if current and current['phase']=='complete' and not current['running']:break
                ui.wait_for_timeout(25)
            else:raise AssertionError(current)
            assert current['completed']==120 and current['failed']==0,current
            report.update({'blocks':120,'model_requests':len(calls),'peak_concurrent_requests':state['peak'],'elapsed_ms':round((time.monotonic()-start)*1000,1),'first_translation_ms':round(article.evaluate('firstTranslationMs'),1),'blocks_per_request':[len(c.get('blocks',[])) or 1 for c in calls]})
            report['first_visible_translation_ms']=round(article.evaluate('firstVisibleTranslationMs'),1)
            report['first_translated_owner']=article.evaluate('firstTranslatedOwner')
            report['bilingual_style']=article.evaluate('''()=>{const original=document.getElementById('p0'),translation=document.querySelector('[data-shiyi-block-translation]'),a=getComputedStyle(original),b=getComputedStyle(translation);return {source_color:a.color,translation_color:b.color,background:b.backgroundColor,border_px:parseFloat(b.borderInlineStartWidth)}}''')
            before=len(calls);message('PAGE_COMMAND',tabId=tab,action='restore');message('PAGE_COMMAND',tabId=tab,action='translate',mode='bilingual')
            deadline=time.monotonic()+10
            while time.monotonic()<deadline:
                cached=message('UI_STATE',tabId=tab)['tab']['page']
                if cached and cached['phase']=='complete' and not cached['running']:break
                ui.wait_for_timeout(25)
            report['cached_additional_requests']=len(calls)-before
            failures=[]
            if report['model_requests']>20:failures.append('120 short blocks should use at most 20 model requests instead of one request per block')
            if int(report['first_translated_owner'][1:])<80:failures.append('The currently visible paragraphs should translate before off-screen page headers')
            if report['bilingual_style']['source_color']==report['bilingual_style']['translation_color']:failures.append('Original and translation should have distinct readable colors')
            if report['bilingual_style']['border_px']!=0 or report['bilingual_style']['background']!='rgba(0, 0, 0, 0)':failures.append('Translated blocks should use text color only, without backgrounds or borders')
            if report['cached_additional_requests']!=0:failures.append('A repeated page translation should not request cached blocks')
            report['result']='fail' if failures else 'pass';report['failures']=failures
        finally:ctx.close()
finally:
    server.shutdown();server.server_close()
    label='reader-throughput-baseline-'+VERSION if '--baseline' in sys.argv else 'reader-throughput-'+VERSION
    (OUT/(label+'.json')).write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps(report,ensure_ascii=False,indent=2),flush=True)
assert report.get('result')=='pass',report.get('failures')
