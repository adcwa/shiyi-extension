"""Qwen-MT wire protocol and Chinese bilingual suppression in real MV3 Chrome.

No real key, provider request or user's browser profile is used.
"""
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread, Lock
from playwright.sync_api import sync_playwright, expect
import json, re, shutil, tempfile, time

ROOT=Path(__file__).resolve().parents[1];VERSION=json.loads((ROOT/'package.json').read_text())['version'];OUT=ROOT/'verification'
report={'version':VERSION,'checks':[],'errors':[],'result':'running','scope':'Real isolated Chromium MV3; deterministic local HTTP for both native MT and generic chat.'}
calls=[];guard=Lock();control={'drop':False,'active':0,'peak':0}
CN='这段原文已经是中文，不需要再次显示。'
TECH='使用 OpenAI API 连接 qwen-mt-flash 模型。'
TABLE={'Read both languages':'双语阅读','Settings':'设置','Hello world.':'你好，世界。','Use':'使用','the guide':'指南','to read.':'来阅读。','Read guide':'阅读指南','日本語':'日语','これは日本語です。':'这是日语。','curiosity':'好奇心'}
PAGE='''<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Mixed language reading</title><style>body{font:18px/1.8 system-ui;color:#273c35;background:white;margin:35px}main{max-width:760px;margin:auto}p{margin:16px 0}h1{font-size:30px}a{color:#086c61}nav{display:flex;gap:20px;font-size:14px}button{font:14px system-ui;padding:8px}</style></head><body><main><nav><a id="cn-nav" href="#cn">项目设置</a><a href="#settings">Settings</a></nav><h1>Read both languages</h1><h2>中文内容</h2><p id="cn">'''+CN+'''</p><p id="tech">'''+TECH+'''</p><p id="split">这段<em>中文</em>内容保持不变。</p><p id="en">Hello world.</p><p id="linked">Use <a id="guide" href="/guide">the guide</a> to read.</p><p id="mixed">中文说明：<a href="/read">Read guide</a></p><p id="ja" lang="ja">日本語</p><p id="kana">これは日本語です。</p><p id="word">curiosity</p><p id="number">2026</p></main><script>window.originalCN=document.getElementById('cn').firstChild;document.getElementById('guide').addEventListener('click',e=>{e.preventDefault();window.linkClicks=(window.linkClicks||0)+1});</script></body></html>'''
ONLY_CN='<!doctype html><meta charset="utf-8"><html lang="zh-CN"><body><h1>中文页面</h1><p>这些内容已经是中文，不需要再次翻译。</p><button>保存设置</button></body></html>'
def translated(text,target='Chinese'):
    if target=='English':return 'EN: '+text
    value=text.strip()
    return TABLE.get(value, '重复改写：'+text if re.search('[\u4e00-\u9fff]',text) else '译：'+text)
class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def do_GET(self):
        self.send_response(200);self.send_header('Content-Type','text/html;charset=utf-8');self.end_headers();self.wfile.write((ONLY_CN if self.path.startswith('/only-cn') else PAGE).encode())
    def do_POST(self):
        body=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        with guard:calls.append(body);control['active']+=1;control['peak']=max(control['peak'],control['active'])
        try:
            if body['model'].startswith('qwen-mt-'):
                if len(body['messages'])!=1 or body['messages'][0]['role']!='user' or 'translation_options' not in body or 'enable_thinking' in body or re.search('[\u4e00-\u9fff]',body.get('translation_options',{}).get('domains','')):
                    self.send_response(400);self.end_headers();return
                source=body['messages'][0]['content'];target=body['translation_options']['target_lang']
                marks=list(re.finditer(r'⟪DY[0-9a-f]+_(?:\d+|END)⟫',source))
                if marks:
                    if control['drop']:output='本次响应丢失了映射标记'
                    else:
                        chunks=[match.group()+'\n'+translated(source[match.end():marks[i+1].start()].strip(),target) for i,match in enumerate(marks[:-1])]
                        output='\n'.join(reversed(chunks))+'\n'+marks[-1].group()
                else:output=translated(source,target)
            else:
                data=json.loads(body['messages'][-1]['content']);target='English' if data['targetLanguage']=='English' else 'Chinese'
                def block(parts):return {'parts':[{'id':p['id'],'text':translated(p['text'],target) if p['text'].strip() else p['text']} for p in reversed(parts)]}
                output=json.dumps({'blocks':[{'id':b['id'],**block(b['parts'])} for b in reversed(data['blocks'])]} if data.get('task')=='blocks' else block(data['parts']),ensure_ascii=False)
            self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(json.dumps({'choices':[{'message':{'content':output}}]}).encode())
        finally:
            with guard:control['active']-=1
def passed(name):report['checks'].append({'name':name,'result':'pass'});print('PASS:',name,flush=True)
def message(ui,kind,**payload):
    result=ui.evaluate('data=>chrome.runtime.sendMessage(data)',{'type':'SHIYI/'+kind,**payload});assert result['ok'],result;return result['data']
def complete(ui,tab,empty=False):
    deadline=time.monotonic()+20;state=None
    while time.monotonic()<deadline:
        state=message(ui,'UI_STATE',tabId=tab)['tab']['page']
        if state and state['active'] and state['phase']=='complete' and not state['running'] and (empty or state['completed']>0):return state
        ui.wait_for_timeout(40)
    raise AssertionError(state)
server=ThreadingHTTPServer(('127.0.0.1',0),Handler);Thread(target=server.serve_forever,daemon=True).start();origin='http://127.0.0.1:'+str(server.server_port)
try:
    with tempfile.TemporaryDirectory(prefix='dianyi-mt-cn-') as folder,sync_playwright() as playwright:
        folder=Path(folder);extension=folder/'extension';shutil.copytree(ROOT/'releases'/('dianyi-'+VERSION),extension)
        binary=next((Path.home()/'Library/Caches/ms-playwright').glob('chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'))
        ctx=playwright.chromium.launch_persistent_context(str(folder/'profile'),executable_path=str(binary),headless=True,ignore_default_args=['--disable-extensions'],args=['--disable-extensions-except='+str(extension),'--load-extension='+str(extension)],viewport={'width':1200,'height':1000})
        try:
            worker=ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker');base='chrome-extension://'+worker.url.split('/')[2]
            ui=ctx.new_page();ui.goto(base+'/options.html#model');expect(ui.locator('h1')).to_be_visible();ui.get_by_role('button',name='通义千问',exact=True).click()
            expect(ui.locator('#current-model')).to_have_text('qwen-mt-flash');expect(ui.locator('#model-key')).to_have_value('')
            link=ui.locator('.model-key-entry').get_by_role('link',name='获取 Key',exact=False);expect(link).to_have_attribute('href','https://help.aliyun.com/zh/model-studio/get-api-key')
            a=ui.locator('#model-key').bounding_box();b=link.bounding_box();assert b['x']>=a['x']+a['width'] and abs((a['y']+a['height']/2)-(b['y']+b['height']/2))<10
            assert not calls and not message(ui,'UI_STATE')['profile']['hasKey']
            ui.screenshot(path=str(OUT/'qwen-mt-setup.png'),animations='disabled',caret='initial')
            passed('Qwen defaults to qwen-mt-flash with an empty key field and official Get Key link beside the input; setup makes no model request')
            ui.locator('#model-advanced summary').click();expect(ui.locator('#model-id')).to_have_value('qwen-mt-flash');assert ui.locator('#model-id option[value="qwen-flash"]').count()==1
            ui.locator('#model-key').fill('never-save-this-fixture');ui.locator('#model-id').select_option('qwen-flash');expect(ui.locator('#model-key')).to_have_value('never-save-this-fixture')
            for width in [375,768,1200]:
                ui.set_viewport_size({'width':width,'height':1000});assert ui.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
            ui.set_viewport_size({'width':1200,'height':1000});assert not calls
            passed('Generic Qwen remains selectable, changing models retains the typed key without saving, and the adjacent key link fits 375–1200px')
            profile={'provider':'custom','name':'Native MT fixture','endpoint':origin+'/v1','model':'qwen-mt-flash','auth':'none','timeoutSeconds':20,'rememberKey':False}
            message(ui,'SAVE_PROFILE',profile=profile)
            page=ctx.new_page();page.on('pageerror',lambda e:report['errors'].append(str(e)));page.goto(origin+'/mixed');expect(page.locator('#shiyi-extension-root')).to_be_attached()
            tab=ui.evaluate('async url=>(await chrome.tabs.query({})).find(t=>t.url===url).id',page.url)
            page.evaluate('''()=>{const n=document.getElementById('word').firstChild,r=document.createRange();r.selectNodeContents(n);getSelection().removeAllRanges();getSelection().addRange(r);document.getElementById('word').dispatchEvent(new PointerEvent('pointerup',{bubbles:true,button:0}))}''')
            page.locator('#shiyi-extension-root').get_by_role('button',name='翻译为中文',exact=True).click();expect(page.locator('#word [data-shiyi-mark]')).to_have_count(1)
            assert calls[-1]['messages']==[{'role':'user','content':'curiosity'}] and calls[-1]['translation_options']['target_lang']=='Chinese'
            passed('Real native MT word selection uses a single raw user message and translation_options, accepts plain output and saves the correct meaning')
            page.keyboard.press('Escape');page.evaluate('getSelection().removeAllRanges()')
            message(ui,'PAGE_COMMAND',tabId=tab,action='translate',mode='bilingual');state=complete(ui,tab);assert not state['failed'],state
            for selector in ['#cn','#tech','#split','#cn-nav']:
                assert page.locator(selector+' [data-shiyi-block-translation]').count()==0
                if selector!='#cn-nav':assert page.locator(selector+' + [data-shiyi-block-translation]').count()==0
            assert page.locator('#cn').inner_text()==CN and page.locator('#tech').inner_text()==TECH
            expect(page.locator('#en + [data-shiyi-block-translation]')).to_have_text('你好，世界。')
            assert CN not in json.dumps(calls,ensure_ascii=False) and TECH not in json.dumps(calls,ensure_ascii=False)
            passed('Native Chinese paragraphs, split Chinese text and technical-name Chinese remain single copies and are not sent for translation; English still gets its translation')
            expect(page.locator('#mixed + [data-shiyi-block-translation]')).to_have_text('阅读指南')
            passed('Mixed Chinese and English within one paragraph only appends the foreign fragment translation, preserving the existing Chinese once')
            expect(page.locator('#ja + [data-shiyi-block-translation]')).to_have_text('日语');expect(page.locator('#kana + [data-shiyi-block-translation]')).to_have_text('这是日语。')
            passed('Japanese language hints and kana prevent Japanese text from being incorrectly skipped as Chinese')
            page.screenshot(path=str(OUT/'chinese-bilingual.png'),animations='disabled',caret='initial')
            message(ui,'PAGE_COMMAND',tabId=tab,action='mode',mode='translation');expect(page.locator('#mixed')).to_have_text('中文说明：阅读指南');assert page.locator('#cn').inner_text()==CN and page.evaluate('originalCN===document.getElementById("cn").firstChild')
            page.locator('#guide').click();assert page.evaluate('linkClicks')==1
            message(ui,'PAGE_COMMAND',tabId=tab,action='mode',mode='bilingual')
            passed('Translation-only also keeps original Chinese untouched and preserves original text nodes and link events')
            cached=ui.evaluate('''async tabId=>{const [result]=await chrome.scripting.executeScript({target:{tabId},func:()=>{const owner=document.getElementById('cn');return globalThis.ShiyiPageMap.snapshot({owner,slots:[{node:owner.firstChild,source:owner.textContent,locked:false}],values:['旧中文重复译文'],translation:'旧中文重复译文'})}});return result.result}''',tab)
            ui.evaluate('''block=>new Promise((resolve,reject)=>{const r=indexedDB.open('shiyi-vocabulary');r.onsuccess=()=>{const db=r.result,tx=db.transaction('pages','readwrite'),store=tx.objectStore('pages'),q=store.getAll();q.onsuccess=()=>{const page=q.result[0];page.blocks.push(block);store.put(page)};tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>reject(tx.error)}})''',cached)
            before=len(calls);page.reload();complete(ui,tab);assert len(calls)==before and '旧中文重复译文' not in page.locator('main').inner_text()
            passed('Refresh ignores previously saved duplicate Chinese mappings while restoring valid foreign translations with zero additional requests')
            control['drop']=True;message(ui,'PAGE_COMMAND',tabId=tab,action='retranslate',mode='bilingual');fallback=complete(ui,tab);assert not fallback['failed'],fallback
            expect(page.locator('#linked + [data-shiyi-block-translation]')).to_contain_text('指南');assert page.locator('#cn').inner_text()==CN and control['peak']<=2
            control['drop']=False
            passed('Lost MT batch framing falls back to independently bound fragments, preserving links and IDs with at most two concurrent HTTP requests')
            profile['model']='chat-fixture';message(ui,'SAVE_PROFILE',profile=profile);message(ui,'PAGE_COMMAND',tabId=tab,action='translate',mode='bilingual');complete(ui,tab)
            assert page.locator('#cn + [data-shiyi-block-translation]').count()==0 and page.locator('#tech + [data-shiyi-block-translation]').count()==0
            expect(page.locator('#mixed + [data-shiyi-block-translation]')).to_have_text('阅读指南')
            passed('Chinese duplicate suppression also applies to ordinary Chat Completions models rather than only Qwen-MT')
            prefs=message(ui,'UI_STATE')['prefs'];prefs['targetLanguage']='en';message(ui,'SAVE_PREFS',prefs=prefs);message(ui,'PAGE_COMMAND',tabId=tab,action='translate',mode='bilingual');complete(ui,tab)
            expect(page.locator('#cn + [data-shiyi-block-translation]')).to_contain_text('EN:');assert page.locator('#cn').inner_text()==CN
            passed('Chinese still translates when the target language is English')
            prefs['targetLanguage']='zh-CN';message(ui,'SAVE_PREFS',prefs=prefs);page.goto(origin+'/only-cn');expect(page.locator('#shiyi-extension-root')).to_be_attached();before=len(calls)
            message(ui,'PAGE_COMMAND',tabId=tab,action='translate',mode='bilingual');empty=complete(ui,tab,empty=True)
            assert empty['total']==0 and len(calls)==before and page.locator('[data-shiyi-block-translation]').count()==0
            assert not report['errors'],report['errors'];report['requests']=len(calls);report['result']='pass'
            passed('An all-Chinese page completes without model requests or duplicate translation blocks and produces no uncaught errors')
        finally:ctx.close()
except Exception as error:report['result']='fail';report['failure']=str(error);raise
finally:
    server.shutdown();server.server_close();(OUT/'mt-chinese-e2e.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'result':report['result'],'checks':len(report['checks']),'failure':report.get('failure')},ensure_ascii=False),flush=True)
