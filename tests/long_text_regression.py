"""Minimal live-extension regression for long glossary entries rendered inline.

Seed one post-translation record in the local extension database. No model or
external server is contacted. Old versions underline a whole paragraph and append
a long parenthesis inside it; the fixed reader must use an independent block.
"""
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from playwright.sync_api import sync_playwright, expect
import json, os, shutil, tempfile, sys

ROOT = Path(__file__).resolve().parents[1]
VERSION = json.loads((ROOT / 'package.json').read_text())['version']
OUT = ROOT / 'verification'; OUT.mkdir(exist_ok=True)
sentences = [
    'Good reading tools give complicated ideas enough space to breathe. ',
    'A paragraph can contain emphasis, links, and several different lines of thought. ',
    'When a long translation is inserted into the same line, the article becomes difficult to follow. ',
    'Readers should be able to compare each original paragraph with its translation, or read the translation alone.'
]
SOURCE = ''.join(sentences)
TRANSLATION = '好的阅读工具应该为复杂想法留出足够的空间。一个段落可能包含强调文字、链接和多条思路。如果把长译文继续挤在原文后面的括号中，文章就很难连贯阅读。读者应该能够按段对照原文与译文，也可以只阅读译文。'
HTML = '<!doctype html><html><head><meta charset="utf-8"><title>Long paragraph regression</title><style>body{font:20px/1.8 Georgia;color:#263735;background:#f5f5f0}main{max-width:670px;margin:40px auto;padding:32px;background:white}h1{font-size:30px}p{margin:22px 0}</style></head><body><main><h1>A paragraph needs its own space.</h1><p id="sample">'+sentences[0]+'<em>'+sentences[1]+'</em>'+sentences[2]+sentences[3]+'</p><p id="after">The next paragraph should keep its original structure.</p></main></body></html>'
if '--plain' in sys.argv: HTML = HTML.replace('<em>', '').replace('</em>', '')
SUFFIX = '-plain' if '--plain' in sys.argv else '-refresh' if '--refresh' in sys.argv else ''
class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def do_GET(self):
        self.send_response(200);self.send_header('Content-Type','text/html;charset=utf-8');self.end_headers();self.wfile.write(HTML.encode())

def binary():
    if os.environ.get('SHIYI_TEST_CHROMIUM'): return os.environ['SHIYI_TEST_CHROMIUM']
    for folder in sorted((Path.home()/'Library/Caches/ms-playwright').glob('chromium-*'),key=lambda p:int(p.name.split('-')[-1]),reverse=True):
        p=folder/'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
        if p.exists(): return str(p)
    return None

server=ThreadingHTTPServer(('127.0.0.1',0),Handler);Thread(target=server.serve_forever,daemon=True).start();origin='http://127.0.0.1:'+str(server.server_port)
receipt={'version':VERSION,'source_characters':len(SOURCE),'result':'running'}
try:
    with tempfile.TemporaryDirectory(prefix='shiyi-long-text-') as temp,sync_playwright() as p:
        temp=Path(temp);extension=temp/'extension';shutil.copytree(ROOT/'releases'/('shiyi-'+VERSION),extension)
        context=p.chromium.launch_persistent_context(str(temp/'profile'),executable_path=binary(),headless=True,ignore_default_args=['--disable-extensions'],args=['--disable-extensions-except='+str(extension),'--load-extension='+str(extension)],viewport={'width':1100,'height':1000})
        try:
            worker=context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker',timeout=15000);ext=worker.url.split('/')[2];ui=context.new_page();ui.goto('chrome-extension://'+ext+'/options.html#library');expect(ui.locator('h1')).to_be_visible()
            entry={'id':'long-regression','identity':'zh-CN\x1f'+SOURCE.lower(),'text':SOURCE,'translation':TRANSLATION,'kind':'sentence','sourceLanguage':'en','targetLanguage':'zh-CN','style':'regular','modelName':'Local regression fixture','source':{'domain':'127.0.0.1','url':origin,'title':'Regression'},'context':'','createdAt':1,'updatedAt':1}
            ui.evaluate('''entry=>new Promise((resolve,reject)=>{const q=indexedDB.open('shiyi-vocabulary');q.onsuccess=()=>{const db=q.result,tx=db.transaction('entries','readwrite');tx.objectStore('entries').put(entry);tx.oncomplete=()=>{db.close();resolve(true)};tx.onerror=()=>reject(tx.error)}})''',entry)
            ui.evaluate('''async()=>{const r=await chrome.runtime.sendMessage({type:'SHIYI/UI_STATE'});return chrome.runtime.sendMessage({type:'SHIYI/SAVE_PREFS',prefs:{...r.data.prefs,displayMode:'inline'}})}''')
            article=context.new_page();article.goto(origin+'/article');before=article.locator('#sample').inner_html()
            article.wait_for_function('document.querySelector("[data-shiyi-meaning],[data-shiyi-block-translation]")')
            receipt['metrics']=article.evaluate('''()=>({underline_fragments:document.querySelectorAll('#sample [data-shiyi-mark]').length,inline_parentheses:document.querySelectorAll('#sample [data-shiyi-meaning]').length,translated_blocks:document.querySelectorAll('[data-shiyi-block-translation]').length,source_height:document.getElementById('sample').getBoundingClientRect().height,source_structure_unchanged:document.getElementById('sample').querySelector('em')!==null})''')
            if '--refresh' in sys.argv:
                for _ in range(3):
                    ui.evaluate('''async()=>{const r=await chrome.runtime.sendMessage({type:'SHIYI/UI_STATE'});return chrome.runtime.sendMessage({type:'SHIYI/SAVE_PREFS',prefs:r.data.prefs})}''')
                    article.wait_for_timeout(100)
                receipt['after_rescan']=article.evaluate('''()=>({underline_fragments:document.querySelectorAll('#sample [data-shiyi-mark]').length,inline_parentheses:document.querySelectorAll('#sample [data-shiyi-meaning]').length})''')
            article.screenshot(path=str(OUT/('long-text-'+VERSION+SUFFIX+'.png')),full_page=True)
            assert receipt['metrics']['underline_fragments']==0,'Long paragraph is still underlined as multiple word fragments'
            assert receipt['metrics']['inline_parentheses']==0,'Long translation is still appended inside the source paragraph'
            assert receipt['metrics']['translated_blocks']==1,'Expected one independent translation block'
            assert article.locator('[data-shiyi-block-translation]').inner_text().find(TRANSLATION)>=0
            assert article.locator('#sample').inner_html()==before,'Original paragraph structure must remain untouched'
            receipt['result']='pass'
        finally: context.close()
except Exception as error:
    receipt['result']='fail';receipt['failure']=str(error);raise
finally:
    server.shutdown();server.server_close();(OUT/('long-text-'+VERSION+SUFFIX+'.json')).write_text(json.dumps(receipt,ensure_ascii=False,indent=2));print(json.dumps(receipt,ensure_ascii=False),flush=True)
