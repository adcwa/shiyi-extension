"""Real-extension regression for compact navigation and opt-in tiny companion.

Run --baseline against the immutable 0.6.0 ZIP. The fixture contains the small
control/paragraph/flex/grid patterns from the reported sidebar, without account
data or a real model service.
"""
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from playwright.sync_api import sync_playwright, expect
import json, os, shutil, sys, tempfile, time, zipfile

ROOT = Path(__file__).resolve().parents[1]
VERSION = '0.6.0' if '--baseline' in sys.argv else json.loads((ROOT/'package.json').read_text())['version']
OUT = ROOT/'verification'
report = {'version':VERSION, 'checks':[], 'failures':[], 'errors':[], 'scope':'Isolated real MV3 Chromium with a deterministic local HTTP model.'}
calls = []
MINIMAL = '--minimal' in sys.argv
TRANSLATIONS = {'Pinned':'已固定','Issues':'议题','Merge requests':'合并请求','Manage':'管理','Plan':'计划','Code':'代码','Build':'构建','Secure':'安全','Settings':'设置','Read':'阅读','More':'更多','A compact navigation, a readable article.':'紧凑导航，舒适阅读。','Save changes':'保存更改','Reading should leave room for ideas, while navigation stays compact.':'阅读为想法留出空间，导航保持紧凑。'}
PAGE = '''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Compact bilingual layout</title><style>
*{box-sizing:border-box}body{margin:0;color:#31323b;background:#fff;font:14px/1.5 system-ui}aside{width:232px;padding:20px 12px;background:#faf2f1;min-height:100vh;border-right:1px solid #e3dcdb}h2{font-size:14px;margin:0 0 22px}.row{display:flex;align-items:center;gap:8px;padding:7px 8px;min-height:36px;color:inherit;text-decoration:none;border-radius:5px;margin-bottom:4px}.row:hover{background:#efe4e2}.row svg{width:16px;height:16px;flex:none}.label{flex:1;min-width:0}.label p{margin:0;line-height:20px}.badge{display:inline-grid;place-items:center;min-width:20px;height:20px;border-radius:10px;background:#ffd7d0;font-size:12px}.direct{flex-wrap:wrap}.direct>.caption{flex:1;min-width:128px}.grid{display:grid;grid-template-columns:16px minmax(0,1fr) auto}.divider{height:1px;background:#e5dcda;margin:16px 0}main{position:absolute;top:36px;left:280px;max-width:650px;padding:0 20px;font:18px/1.8 Georgia,serif}h1{font-size:30px;font-weight:400;line-height:1.4}main p{margin:18px 0}.save{display:inline-flex;align-items:center;gap:6px;padding:8px 14px;font:14px/20px system-ui;border:1px solid #d4dfd7;border-radius:6px;background:white}main a{color:#17685f}@media(max-width:600px){main{position:static;margin:20px 0}aside{min-height:0;width:232px}}
</style></head><body><aside><h2>dsh-super-agent-playground</h2><nav id="navigation">
<a class="row direct" id="pinned" href="#pin"><svg aria-hidden="true"><path d="M3 3 13 13M3 13 13 3" stroke="currentColor"/></svg><span class="caption">Pinned</span></a>
<a class="row" id="issues" href="#issues"><svg aria-hidden="true"></svg><div class="label"><p>Issues</p></div><span class="badge">0</span></a>
<a class="row grid" id="merges" href="#merges"><svg aria-hidden="true"></svg><div class="label"><p>Merge requests</p></div><span class="badge">1</span></a>
<div class="divider"></div>
<a class="row direct" id="manage" href="#manage"><svg aria-hidden="true"></svg><span class="caption">Manage</span><span aria-hidden="true">›</span></a>
<a class="row" id="plan" href="#plan"><svg aria-hidden="true"></svg><div class="label"><p>Plan</p></div><span aria-hidden="true">›</span></a>
<a class="row grid" id="code" href="#code"><svg aria-hidden="true"></svg><div class="label"><p>Code</p></div><span aria-hidden="true">›</span></a>
<a class="row direct" id="build" href="#build"><svg aria-hidden="true"></svg><span class="caption">Build</span></a>
<a class="row" id="secure" href="#secure"><svg aria-hidden="true"></svg><div class="label"><p>Secure</p></div></a>
</nav></aside><main><h1>A compact navigation, a readable article.</h1><p id="article">Reading should leave room for ideas, while navigation stays compact.</p><button class="save" id="save"><svg width="14" height="14" aria-hidden="true"></svg><span>Save changes</span></button><p id="linked">Read <a href="/guide">the guide</a> and keep links working.</p></main><script>document.querySelectorAll('nav a').forEach(a=>a.addEventListener('click',e=>e.preventDefault()));document.getElementById('save').addEventListener('click',()=>window.saved=(window.saved||0)+1);window.sourceNode=document.getElementById('article').firstChild;</script></body></html>'''

if MINIMAL:
    start=PAGE.index('<nav id="navigation">');end=PAGE.index('</nav>',start)
    row=PAGE[PAGE.index('<a class="row grid" id="merges"'):];row=row[:row.index('</a>')+4]
    PAGE=PAGE[:start]+'<nav id="navigation">'+row+PAGE[end:]

class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args): pass
    def do_GET(self):
        self.send_response(200);self.send_header('Content-Type','text/html;charset=utf-8');self.end_headers();self.wfile.write(PAGE.encode())
    def do_POST(self):
        data=json.loads(json.loads(self.rfile.read(int(self.headers['Content-Length'])))['messages'][-1]['content']);calls.append(data)
        def output(parts):
            return {'parts':[{'id':p['id'],'text':TRANSLATIONS.get(p['text'].strip(),p['text'] if not p['text'].strip() or p['text'].strip().isdigit() else '译：'+p['text'])} for p in parts]}
        result={'blocks':[{'id':b['id'],**output(b['parts'])} for b in data['blocks']]} if data.get('task')=='blocks' else output(data['parts'])
        self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(json.dumps({'choices':[{'message':{'content':json.dumps(result,ensure_ascii=False)}}]}).encode())
def binary():
    if os.environ.get('SHIYI_TEST_CHROMIUM'):return os.environ['SHIYI_TEST_CHROMIUM']
    return str(next((Path.home()/'Library/Caches/ms-playwright').glob('chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing')))
def check(name,ok,detail=None):
    report['checks'].append({'name':name,'result':'pass' if ok else 'fail',**({'detail':detail} if detail is not None else {})})
    if not ok:report['failures'].append(name)
    print(('PASS: ' if ok else 'FAIL: ')+name+((' '+json.dumps(detail,ensure_ascii=False)) if detail is not None else ''),flush=True)
def measure(page):
    return page.evaluate('''()=>({height:document.getElementById('navigation').getBoundingClientRect().height,rows:Object.fromEntries([...document.querySelectorAll('#navigation .row')].map(n=>[n.id,{height:n.getBoundingClientRect().height,badge:n.querySelector('.badge')?.getBoundingClientRect().x,html:n.innerHTML}]))})''')

server=ThreadingHTTPServer(('127.0.0.1',0),Handler);Thread(target=server.serve_forever,daemon=True).start();origin='http://127.0.0.1:'+str(server.server_port)
try:
    with tempfile.TemporaryDirectory(prefix='dianyi-compact-') as folder,sync_playwright() as playwright:
        folder=Path(folder);extension=folder/'extension'
        if '--baseline' in sys.argv:
            with zipfile.ZipFile(ROOT/'releases/dianyi-chrome-edge-0.6.0.zip') as archive:archive.extractall(extension)
        else:shutil.copytree(ROOT/'releases'/('dianyi-'+VERSION),extension)
        context=playwright.chromium.launch_persistent_context(str(folder/'profile'),executable_path=binary(),headless=True,ignore_default_args=['--disable-extensions'],args=['--disable-extensions-except='+str(extension),'--load-extension='+str(extension)],viewport={'width':1120,'height':900})
        try:
            worker=context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker');base='chrome-extension://'+worker.url.split('/')[2]
            ui=context.new_page();ui.goto(base+'/options.html#model');expect(ui.locator('h1')).to_be_visible()
            def message(kind,**payload):
                result=ui.evaluate('data=>chrome.runtime.sendMessage(data)',{'type':'SHIYI/'+kind,**payload});assert result['ok'],result;return result['data']
            message('SAVE_PROFILE',profile={'provider':'custom','name':'Compact fixture','endpoint':origin+'/v1','model':'compact-fixture','auth':'none','timeoutSeconds':5,'rememberKey':False})
            page=context.new_page();page.on('pageerror',lambda e:report['errors'].append(str(e)));page.goto(origin+'/sidebar');expect(page.locator('#shiyi-extension-root')).to_be_attached();page.wait_for_timeout(120)
            root=page.locator('#shiyi-extension-root');check('Companion is hidden on a fresh page before the toolbar popup opens',not root.locator('[data-pet-toggle]').is_visible())
            page.evaluate('''()=>{const edge=document.createElement('div');edge.id='edge-cases';edge.style.cssText='max-width:230px;font:14px/1.5 system-ui;margin-top:24px';edge.innerHTML='<nav><a class="row" id="anonymous" href="#settings"><svg aria-hidden="true"></svg>Settings<span class="badge" style="margin-inline-start:auto">3</span></a></nav><button id="dual" class="save"><span>Read</span><span>More</span></button>';document.querySelector('main').append(edge);window.navSource=document.getElementById('anonymous').childNodes[1]}''')
            page.evaluate('''()=>{const row=document.createElement('a');row.id='nowrap';row.className='row grid';row.style.width='208px';row.href='#nowrap';row.innerHTML='<svg aria-hidden="true"></svg><div class="label"><p style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Merge requests</p></div><span class="badge">2</span>';document.querySelector('#edge-cases nav').append(row)}''')
            before=measure(page);original=page.locator('body').inner_html();page.screenshot(path=str(OUT/('compact-original-'+VERSION+('-minimal' if MINIMAL else '')+'.png')),animations='disabled',caret='initial')
            tab=ui.evaluate('async url=>(await chrome.tabs.query({})).find(t=>t.url===url).id',page.url)
            popup=context.new_page();popup.goto(base+'/popup.html?tab='+str(tab));expect(popup.get_by_role('button',name='翻译当前页面',exact=True)).to_be_visible();page.wait_for_timeout(150)
            toggle=root.locator('[data-pet-toggle]');check('Opening the toolbar popup reveals the companion without a model call',toggle.is_visible() and not calls)
            if toggle.is_visible():
                size=root.locator('.companion-cat').bounding_box();check('Companion artwork is one third of the previous 72 by 80px size',size['width']<=25 and size['height']<=28,{'width':size['width'],'height':size['height']})
                toggle.click();close=root.get_by_role('button',name='关闭小猫',exact=True)
                check('Companion exposes an explicit close action',close.is_visible())
                if close.is_visible():
                    close.click();page.wait_for_timeout(1250);check('Closing the companion hides it and popup polling does not reveal it',not toggle.is_visible());popup.reload();page.wait_for_timeout(120);check('Reopening the toolbar popup reveals the companion again',toggle.is_visible())
            popup.get_by_role('button',name='翻译当前页面',exact=True).click()
            deadline=time.monotonic()+15
            while time.monotonic()<deadline:
                state=message('UI_STATE',tabId=tab)['tab']['page']
                if state and state['active'] and state['phase']=='complete' and not state['running']:break
                ui.wait_for_timeout(30)
            assert state['completed']>0 and not state['failed'],state
            after=measure(page);report['navigation']={'before_height':before['height'],'after_height':after['height'],'row_heights':{key:[value['height'],after['rows'][key]['height']] for key,value in before['rows'].items()}}
            check('Bilingual navigation adds no empty rows; long labels use at most one compact extra line',after['height']<=before['height']*(1.6 if MINIMAL else 1.15),report['navigation'])
            check('Issues and merge-count badges stay at their original horizontal positions',all(abs(before['rows'][key]['badge']-after['rows'][key]['badge'])<=2 for key in (['merges'] if MINIMAL else ['issues','merges'])))
            check('Every navigation label has its Chinese translation',all(text in page.locator('#navigation').inner_text() for text in (['合并请求'] if MINIMAL else ['已固定','议题','合并请求','管理','计划','代码','构建','安全'])))
            check('Standalone numeric badges never get a duplicate translation',page.locator('#navigation [data-shiyi-block-translation]').evaluate_all('nodes=>nodes.every(n=>!/^\\d+$/.test(n.textContent.trim()))'))
            check('Numeric badges are absent from the appended translations',all(not any(char.isdigit() for char in text) for text in page.locator('#navigation [data-shiyi-block-translation]').all_inner_texts()))
            check('Anonymous flex labels keep their source node and put the translation beside the label, not in the icon or badge',page.evaluate('navSource.isConnected&&navSource.data==="Settings"') and page.locator('#anonymous [data-shiyi-block-translation]').inner_text()=='设置' and page.locator('#anonymous .badge').inner_text()=='3')
            check('Multiple label fragments in one button keep independent aligned translations',page.locator('#dual [data-shiyi-block-translation]').all_inner_texts()==['阅读','更多'])
            check('Nowrap and ellipsis labels get one compact second line without clipping or entering badge columns',page.locator('#nowrap .label p').evaluate('n=>n.scrollWidth<=n.clientWidth+1&&getComputedStyle(n.querySelector("[data-shiyi-block-translation]")).display==="block"') and page.locator('#nowrap').bounding_box()['height']<=56)
            check('The article retains a block translation with text color only and a 2px font reduction',page.locator('#article + [data-shiyi-block-translation]').evaluate('n=>getComputedStyle(n).backgroundColor==="rgba(0, 0, 0, 0)"&&parseFloat(getComputedStyle(n).fontSize)===16'))
            page.screenshot(path=str(OUT/('compact-bilingual-'+VERSION+('-minimal' if MINIMAL else '')+'.png')),animations='disabled',caret='initial')
            message('PAGE_COMMAND',tabId=tab,action='mode',mode='translation')
            check('Translation-only leaves numeric badges unchanged and preserves anonymous source-node identity',page.evaluate('navSource.isConnected&&navSource.parentElement.id==="anonymous"') and page.locator('#anonymous .badge').inner_text()=='3')
            message('PAGE_COMMAND',tabId=tab,action='restore')
            check('All compact fragments and temporary label wrappers restore exact original HTML',page.locator('body').inner_html()==original and page.evaluate('navSource.parentElement.id==="anonymous"'))
            message('PAGE_COMMAND',tabId=tab,action='translate',mode='bilingual')
            expect(page.locator('#article + [data-shiyi-block-translation]')).to_be_visible()
            before_reload=len(calls);page.reload();expect(page.locator('#article + [data-shiyi-block-translation]')).to_be_visible();page.wait_for_timeout(150)
            check('Refresh restores the compact layout from local mappings without a model call and keeps the companion hidden',len(calls)==before_reload and not root.locator('[data-pet-toggle]').is_visible() and measure(page)['height']<=before['height']*(1.6 if MINIMAL else 1.15))
            message('PAGE_COMMAND',tabId=tab,action='mode',mode='translation');page.locator('#save').click();check('Translation-only preserves button handlers and original source text nodes',page.evaluate('saved===1&&sourceNode===document.getElementById("article").firstChild'))
            message('PAGE_COMMAND',tabId=tab,action='restore');check('Restoring source returns navigation to its original height',abs(measure(page)['height']-before['height'])<1)
            check('No uncaught errors',not report['errors'],report['errors'])
        finally:context.close()
finally:
    server.shutdown();server.server_close();report['result']='fail' if report['failures'] else 'pass'
    name=('compact-baseline-'+VERSION if '--baseline' in sys.argv else 'compact-layout-'+VERSION)+('-minimal' if MINIMAL else '')
    (OUT/(name+'.json')).write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'result':report['result'],'failures':report['failures']},ensure_ascii=False),flush=True)
assert not report['failures'],report['failures']
