"""Observe real annotation DOM stability under repeated terms and live text.

No model is configured or called. The source document and glossary are local
fixtures; counters measure actual mark/meaning replacement, not screenshots.
"""
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from playwright.sync_api import sync_playwright, expect
import json, sys, tempfile, time

ROOT=Path(__file__).resolve().parents[1]
VERSION=json.loads((ROOT/'package.json').read_text())['version']
OUT=ROOT/'verification';OUT.mkdir(exist_ok=True)
HTML='''<!doctype html><meta charset="utf-8"><title>Repeated-word stability fixture</title><style>body{margin:32px;color:#263735;background:white;font:18px/1.9 system-ui}main{max-width:850px}</style><main><p id="repeated">Curiosity opens doors. Curiosity makes reading better. <span id="tick">0</span></p><p id="unrelated">Live counter: <span id="other-tick">0</span></p></main><script>window.beginTicks=id=>{let n=0;window.tickTimer=setInterval(()=>document.getElementById(id).firstChild.data=String(++n),45)};window.stopTicks=()=>clearInterval(tickTimer);</script>'''
STRUCTURED=HTML.replace('</main>', '<p id="phrase">Keep <em>cognitive</em> <strong>load</strong> low. <span id="phrase-tick">0</span></p></main>').replace('window.beginTicks=', 'window.originalMainHTML=document.querySelector("main").innerHTML;window.originalSourceNode=document.getElementById("repeated").firstChild;window.beginTicks=')
DENSE=HTML.replace('Curiosity opens doors. Curiosity makes reading better.', ''.join('<span>Curiosity </span>' for _ in range(180)))

class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def do_GET(self):
        content=STRUCTURED if self.path.startswith('/structured') else DENSE if self.path.startswith('/dense') else HTML.replace('Curiosity makes reading better.','Reading makes reading better.') if self.path.startswith('/single') else HTML
        self.send_response(200);self.send_header('Content-Type','text/html;charset=utf-8');self.end_headers();self.wfile.write(content.encode())
server=ThreadingHTTPServer(('127.0.0.1',0),Handler);Thread(target=server.serve_forever,daemon=True).start()
origin='http://127.0.0.1:'+str(server.server_port)
report={'version':VERSION,'scope':'Real unmodified MV3 extension, local repeated-word document, no configured model or model requests.','measurements':[],'checks':[],'failures':[],'result':'running'}
try:
    with tempfile.TemporaryDirectory(prefix='shiyi-word-stability-') as folder,sync_playwright() as p:
        browser=next((Path.home()/'Library/Caches/ms-playwright').glob('chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'))
        extension=ROOT/'releases'/('shiyi-'+VERSION)
        context=p.chromium.launch_persistent_context(folder,executable_path=str(browser),headless=True,ignore_default_args=['--disable-extensions'],args=['--disable-extensions-except='+str(extension),'--load-extension='+str(extension)],viewport={'width':1100,'height':900})
        try:
            worker=context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker');ext=worker.url.split('/')[2]
            ui=context.new_page();ui.goto('chrome-extension://'+ext+'/options.html#translation');expect(ui.get_by_label('每批翻译块数',exact=True)).to_be_visible()
            def message(kind,**extra):
                result=ui.evaluate('data=>chrome.runtime.sendMessage(data)',{'type':'SHIYI/'+kind,**extra});assert result['ok'],result;return result['data']
            entry={'id':'repeat-curiosity','identity':'zh-CN\x1fcuriosity','text':'Curiosity','translation':'好奇心','kind':'word','sourceLanguage':'en','targetLanguage':'zh-CN','style':'regular','source':{'domain':'127.0.0.1','url':'','title':'Local stability fixture'},'createdAt':1,'updatedAt':1}
            assert ui.evaluate('''entry=>new Promise((resolve,reject)=>{const o=indexedDB.open('shiyi-vocabulary');o.onsuccess=()=>{const db=o.result,tx=db.transaction('entries','readwrite');tx.objectStore('entries').put(entry);tx.oncomplete=()=>{db.close();resolve(true)};tx.onerror=()=>reject(tx.error)}})''',entry)
            page=context.new_page();page.goto(origin+'/repeated');expect(page.locator('#repeated [data-shiyi-mark]')).to_have_count(2)
            def measure(label,tick=None,expected=2):
                page.evaluate('''()=>{window.stability={markAdded:0,markRemoved:0,meaningAdded:0,meaningRemoved:0};window.initialMarks=[...document.querySelectorAll('[data-shiyi-mark]')];window.probe=new MutationObserver(records=>{const count=(nodes,selector)=>[...nodes].reduce((sum,node)=>sum+(node.nodeType===1?Number(node.matches(selector))+node.querySelectorAll(selector).length:0),0);for(const r of records){stability.markAdded+=count(r.addedNodes,'[data-shiyi-mark]');stability.markRemoved+=count(r.removedNodes,'[data-shiyi-mark]');stability.meaningAdded+=count(r.addedNodes,'[data-shiyi-meaning]');stability.meaningRemoved+=count(r.removedNodes,'[data-shiyi-meaning]')}});probe.observe(document.querySelector('main'),{childList:true,subtree:true})}''')
                if tick:page.evaluate('id=>beginTicks(id)',tick)
                page.wait_for_timeout(900)
                if tick:page.evaluate('stopTicks()')
                page.wait_for_timeout(100)
                data=page.evaluate('''()=>{probe.disconnect();return {...stability,marks:document.querySelectorAll('[data-shiyi-mark]').length,nested:document.querySelectorAll('[data-shiyi-mark] [data-shiyi-mark]').length,retained:initialMarks.filter(n=>n.isConnected).length,initial:initialMarks.length,meanings:document.querySelectorAll('[data-shiyi-meaning]').length}}''')
                report['measurements'].append({'case':label,**data});print(json.dumps({'case':label,**data}),flush=True)
                if data['nested'] or data['marks']!=expected:report['failures'].append(label+': duplicate or missing annotations')
                if data['markRemoved'] or data['meaningRemoved']:report['failures'].append(label+': unchanged visible annotations are repeatedly removed and rebuilt')
                if not data['nested'] and data['marks']==expected and not data['markRemoved'] and not data['meaningRemoved']:report['checks'].append(label)
                return data
            page.wait_for_timeout(300);measure('static repeated words')
            measure('counter changes in another paragraph','other-tick')
            measure('counter changes beside repeated words','tick')
            prefs=message('UI_STATE')['prefs'];message('SAVE_PREFS',prefs={**prefs,'displayMode':'inline'})
            expect(page.locator('#repeated [data-shiyi-meaning]')).to_have_count(2);page.wait_for_timeout(200)
            measure('inline meanings beside a live counter','tick')
            page.goto(origin+'/single');expect(page.locator('#repeated [data-shiyi-mark]')).to_have_count(1);page.wait_for_timeout(200)
            measure('single occurrence control with live counter','tick',expected=1)
            if '--baseline' not in sys.argv:
                page.goto(origin+'/dense');expect(page.locator('#repeated [data-shiyi-mark]')).to_have_count(180);page.wait_for_timeout(200)
                measure('180 repeated words and inline meanings with live counter','tick',expected=180)
                phrase={**entry,'id':'repeat-phrase','identity':'zh-CN\x1fcognitive load','text':'cognitive load','translation':'认知负荷','kind':'phrase'}
                assert ui.evaluate('''entry=>new Promise((resolve,reject)=>{const o=indexedDB.open('shiyi-vocabulary');o.onsuccess=()=>{const db=o.result,tx=db.transaction('entries','readwrite');tx.objectStore('entries').put(entry);tx.oncomplete=()=>{db.close();resolve(true)};tx.onerror=()=>reject(tx.error)}})''',phrase)
                page.goto(origin+'/structured');expect(page.locator('#phrase [data-shiyi-mark]')).to_have_count(3);expect(page.locator('#phrase [data-shiyi-meaning]')).to_have_count(1)
                measure('phrase across emphasis stays stable beside live text','phrase-tick',expected=5)
                page.evaluate('document.getElementById("tick").textContent="Curiosity"');expect(page.locator('#repeated [data-shiyi-mark]')).to_have_count(3)
                page.evaluate('document.getElementById("tick").textContent="42"');expect(page.locator('#repeated [data-shiyi-mark]')).to_have_count(2)
                report['checks'].append('Actual word insertion and removal still update annotations')
                page.evaluate('''()=>{const mark=document.querySelector('#repeated [data-shiyi-mark]'),meaning=mark.nextSibling;meaning.nextSibling.data='ful'+meaning.nextSibling.data}''')
                expect(page.locator('#repeated [data-shiyi-mark]')).to_have_count(1)
                page.evaluate('''()=>{const p=document.getElementById('repeated');p.firstChild.data=p.firstChild.data.replace('Curiosityful','Curiosity')}''')
                expect(page.locator('#repeated [data-shiyi-mark]')).to_have_count(2)
                report['checks'].append('Injected meanings do not hide source word-boundary changes')
                page.evaluate('document.querySelector("#phrase em").textContent="emotional"');expect(page.locator('#phrase [data-shiyi-mark]')).to_have_count(0);expect(page.locator('#phrase [data-shiyi-meaning]')).to_have_count(0)
                page.evaluate('document.querySelector("#phrase em").textContent="cognitive"');expect(page.locator('#phrase [data-shiyi-mark]')).to_have_count(3)
                report['checks'].append('Cross-element phrase changes remove stale fragments and restore the valid phrase')
                page.evaluate('''()=>{document.getElementById('tick').textContent='0';document.getElementById('phrase-tick').textContent='0'}''')
                page.wait_for_timeout(120);message('BLACKLIST_SET',site=origin,blocked=True);expect(page.locator('[data-shiyi-mark],[data-shiyi-meaning]')).to_have_count(0)
                assert page.evaluate('document.querySelector("main").innerHTML===originalMainHTML&&document.getElementById("repeated").firstChild===originalSourceNode')
                report['checks'].append('Pause restores exact source HTML and original text-node identity after live updates')
                message('BLACKLIST_SET',site=origin,blocked=False);expect(page.locator('#repeated [data-shiyi-mark]')).to_have_count(2)
                page.locator('#repeated [data-shiyi-mark]').first.hover();page.locator('#shiyi-extension-root').get_by_role('button',name='取消标记并从词库删除',exact=True).click()
                expect(page.locator('#repeated [data-shiyi-mark]')).to_have_count(0)
                page.locator('#shiyi-extension-root').get_by_role('button',name='撤销',exact=True).click();expect(page.locator('#repeated [data-shiyi-mark]')).to_have_count(2)
                report['checks'].append('Repeated-word delete and undo still synchronize all occurrences')
            report['result']='fail' if report['failures'] else 'pass'
        finally:context.close()
except Exception as error:
    report['result']='fail';report['failure']=str(error);raise
finally:
    server.shutdown();server.server_close()
    name='repeated-word-baseline-'+VERSION if '--baseline' in sys.argv else 'repeated-word-'+VERSION
    (OUT/(name+'.json')).write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'result':report['result'],'failures':report['failures']},ensure_ascii=False),flush=True)
assert report['result']=='pass',report['failures']
