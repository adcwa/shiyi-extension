"""Actual MV3 page-reader acceptance, using only an isolated loopback model.

The fixture deliberately verifies alignment, cancel races and DOM identity. It
does not claim to evaluate a real vendor's translation quality.
"""
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread, Lock, Event
from playwright.sync_api import sync_playwright, expect
import json, os, shutil, tempfile, time

ROOT = Path(__file__).resolve().parents[1]
VERSION = json.loads((ROOT/'package.json').read_text())['version']
OUT = ROOT/'verification'; OUT.mkdir(exist_ok=True)
report = {'version': VERSION, 'checks': [], 'errors': [], 'result': 'running', 'scope': 'Real isolated Chromium MV3 extension, real HTTP transport to a local deterministic model fixture. No real provider keys.'}
calls, control, guard = [], {'mode': 'ok', 'active': 0, 'peak': 0}, Lock()
P1 = 'Curiosity begins when we give an unfamiliar idea a little more room. '
P2 = 'Reading with intention'
P3 = ' lets us keep the shape of a thought, instead of rushing past it. A useful translation should sit beside the paragraph it belongs to, with enough space for both languages to breathe. It should also let us read the translation on its own, without taking away the links or the small details that make a page useful.'
TRANSLATIONS = {
    'margin.': '留白。', 'Stories': '文章', 'About': '关于', 'THE ART OF READING': '阅读的艺术',
    'Make space for a slower kind of reading.': '为从容阅读，留一点空间。',
    P1: '好奇心，始于为陌生的想法多留一点空间。', P2: '有意识地阅读',
    P3: '，让我们看清思绪的形状，而非匆匆掠过。好的译文应该跟随它所属的段落，让两种语言都有舒展的空间。我们也可以选择只看译文，同时保留网页中有用的链接与细节。',
    'A page is more than its paragraphs.': '网页，不只有段落。', 'Explore ': '阅读', 'the reading guide': '阅读指南', ' and keep the original links working.': '，原有链接依然可用。',
    'Compare one paragraph at a time.': '逐段对照，理解更轻松。', 'Switch to the translation when you want to stay in the flow.': '只看译文，保持阅读的连贯。',
    'Remember to keep ': '记得保留 ', ' exactly as written.': ' 的原样。', 'Topic': '主题', 'Notes': '说明', 'Paragraphs': '段落', 'A quieter rhythm': '更从容的节奏', 'Save this article': '收藏文章', 'Your note': '你的笔记',
    'Retry this sentence if a model returns incomplete fragments: ': '如果模型的片段不完整，可以重试这句话：', 'the important link': '重要链接',
    'A newly loaded paragraph can be translated on request.': '新加载的段落，也可以继续翻译。', 'Site changed this paragraph while translation was in progress.': '翻译期间，网页更新了这个段落。'
}
ARTICLE = '''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>margin. · Reading in two languages</title><style>
*{box-sizing:border-box}body{margin:0;background:#f4f5ef;color:#273c35;font:18px/1.85 Georgia,serif}main{max-width:820px;margin:28px auto;padding:32px 52px;background:#fff;border:1px solid #e0e5da;border-radius:14px}nav{display:flex;align-items:center;gap:20px;border-bottom:1px solid #e0e7dc;padding-bottom:16px;margin-bottom:28px}nav strong{font-size:27px;margin-right:auto}nav a{font:12px/1.7 system-ui}a{color:#006665}h1{font-size:43px;line-height:1.2;font-weight:400;letter-spacing:-1px;margin:12px 0 25px}h2{font-size:26px;font-weight:400;margin:34px 0 15px}p{margin:20px 0}small{font:10px/1.7 system-ui;letter-spacing:1.8px;color:#627362}li{margin:9px 0}table{width:100%;border-collapse:collapse;font:15px/1.8 system-ui}td,th{padding:10px;border:1px solid #dce4d7;text-align:left}button{font:13px/1.6 system-ui;padding:9px 15px;background:#006665;color:white;border:0;border-radius:6px;margin:15px 0}label{display:block;font:13px/1.8 system-ui}input{font:14px system-ui;padding:8px;border:1px solid #b9cdbb;border-radius:5px;width:100%}code,pre{font:13px/1.7 monospace;background:#f2f5ed;padding:2px 5px}textarea,[contenteditable]{font:13px/1.7 monospace;margin-top:9px;display:block;width:100%}aside{margin-top:25px;padding:15px;background:#f2f5ed;font:13px/1.8 system-ui}@media(max-width:600px){main{margin:0;padding:22px 20px;border:0;border-radius:0}h1{font-size:34px}}@media(prefers-color-scheme:dark){body{background:#121b17;color:#e2ebe1}main{background:#1a2821;border-color:#425446}nav{border-color:#425446}a{color:#a2d6c4}code,pre,aside{background:#29382c;color:#e2ebe1}small{color:#b3c8af}}
</style></head><body><main><nav><strong>margin.</strong><a href="/stories">Stories</a><a href="/about">About</a></nav><small>THE ART OF READING</small><h1>Make space for a slower kind of reading.</h1><p id="lead">'''+P1+'<em>'+P2+'</em>'+P3+'''</p><h2>A page is more than its paragraphs.</h2><p id="linked">Explore <a id="guide" href="/guide">the reading guide</a> and keep the original links working.</p><ul><li>Compare one paragraph at a time.</li><li>Switch to the translation when you want to stay in the flow.</li></ul><p id="protected">Remember to keep <code id="inline-code">const privateExample = 42;</code> exactly as written.</p><table><thead><tr><th>Topic</th><th>Notes</th></tr></thead><tbody><tr><td>Paragraphs</td><td>A quieter rhythm</td></tr></tbody></table><button id="save">Save this article</button><label for="note">Your note</label><input id="note" value="DO_NOT_SEND_FORM_VALUE"><textarea id="private">DO_NOT_SEND_TEXTAREA</textarea><div contenteditable="true" id="editor">DO_NOT_SEND_EDITOR</div><pre id="code">DO_NOT_SEND_CODE_BLOCK</pre><div hidden>DO_NOT_SEND_HIDDEN</div><div translate="no" id="untranslated">DO_NOT_SEND_NOTRANSLATE</div><p id="alignment">Retry this sentence if a model returns incomplete fragments: <a href="/important">the important link</a></p><div id="dynamic"></div></main><script>
window.guideNode=document.getElementById('guide');window.buttonNode=document.getElementById('save');window.leadNode=document.getElementById('lead').firstChild;guideNode.addEventListener('click',e=>{e.preventDefault();window.linkClicks=(window.linkClicks||0)+1});buttonNode.addEventListener('click',()=>window.saveClicks=(window.saveClicks||0)+1);
</script></body></html>'''
GIANT = '<!doctype html><html><head><meta charset="utf-8"><title>Large blocks</title></head><body><h1>Large document</h1><p id="giant">' + ('A long paragraph retains every sentence and meaningful detail. ' * 180) + '</p></body></html>'
DUPLICATES = '<!doctype html><html><body>' + '<p>A shared repeated navigation label.</p>' * 16 + '</body></html>'
MANY = '<!doctype html><html><body>' + ''.join('<p>Budget paragraph number '+str(i)+'.</p>' for i in range(405)) + '</body></html>'
SCROLL_FEED = '<!doctype html><html><style>#feed{height:64px;overflow:auto}p{height:64px;margin:0}</style><body><main id="feed">' + ''.join(f'<p id="viewport-{i}">Viewport paragraph number {i}.</p>' for i in range(620)) + '</main></body></html>'
release_background = Event()

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def do_GET(self):
        self.send_response(200); self.send_header('Content-Type','text/html;charset=utf-8'); self.end_headers()
        self.wfile.write((GIANT if self.path.startswith('/giant') else DUPLICATES if self.path.startswith('/duplicates') else MANY if self.path.startswith('/many') else SCROLL_FEED if self.path.startswith('/viewport') else ARTICLE).encode())
    def do_POST(self):
        payload=json.loads(self.rfile.read(int(self.headers.get('Content-Length',0)))); data=json.loads(payload['messages'][-1]['content'])
        with guard:
            mode=control['mode'];control['active']+=1;control['peak']=max(control['peak'],control['active'])
            parts = data.get('parts', []) if data.get('task') != 'blocks' else [part for block in data['blocks'] for part in block['parts']]
            background = mode == 'viewport' and any(0 < int(part['text'].removeprefix('Viewport paragraph number ').rstrip('.')) < 500 for part in parts if part['text'].startswith('Viewport paragraph number '))
            calls.append({'data':data,'auth':self.headers.get('Authorization'),'cookie':self.headers.get('Cookie'),'held':background})
        try:
            if mode=='slow':time.sleep(1.5)
            if background:release_background.wait(8)
            if mode in ('401','429'):self.send_response(int(mode));self.end_headers();return
            if data.get('task') in ('block','blocks'):
                def translated(parts):
                    output=[]
                    for part in parts:
                        source=part['text'];text=TRANSLATIONS.get(source,source if not source.strip() or source.startswith('⟦SHIYI_') else '译文：'+source)
                        output.append({'id':part['id'],'text':text})
                    result={'parts':output}
                    if mode=='alignment' and any('Retry this sentence' in part['text'] for part in parts):result={'translation':'不完整的译文'}
                    if mode=='html' and any('Retry this sentence' in part['text'] for part in parts):result['parts'][0]['text']='<img src=x onerror="window.readerInjection=1">'
                    return result
                result={'blocks':[{'id':block['id'],**translated(block['parts'])} for block in data['blocks']]} if data['task']=='blocks' else translated(data['parts'])
                if mode=='batch-unsupported' and data['task']=='blocks':result={'translation':'这个测试模型不支持合并格式。'}
            else: result={'translation':'好奇心','sourceLanguage':'en','kind':'word'}
            self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(json.dumps({'choices':[{'message':{'content':json.dumps(result,ensure_ascii=False)}}]}).encode())
        except (BrokenPipeError,ConnectionResetError):pass
        finally:
            with guard:control['active']-=1

def binary():
    if os.environ.get('SHIYI_TEST_CHROMIUM'):return os.environ['SHIYI_TEST_CHROMIUM']
    for folder in sorted((Path.home()/'Library/Caches/ms-playwright').glob('chromium-*'),key=lambda p:int(p.name.split('-')[-1]),reverse=True):
        path=folder/'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
        if path.exists():return str(path)

def message(ui,kind,**payload):
    result=ui.evaluate('(data)=>chrome.runtime.sendMessage(data)',{'type':'SHIYI/'+kind,**payload})
    assert result and result.get('ok'),result
    return result['data']

def status(ui,tab):return message(ui,'UI_STATE',tabId=tab)['tab']['page']
def complete(ui,tab):
    deadline=time.monotonic()+45;value=None
    while time.monotonic()<deadline:
        value=status(ui,tab)
        if value and value['active'] and not value['running'] and value['phase'] in ('complete','paused') and value['total']>0:return value
        ui.wait_for_timeout(60)
    raise AssertionError({'completion_timeout':value})
def command(ui,tab,action,mode=None):return message(ui,'PAGE_COMMAND',tabId=tab,action=action,**({'mode':mode} if mode else {}))
def open_popup(ui, tab):
    with ui.expect_popup() as opened:
        ui.evaluate('()=>{window.open("about:blank")}')
    popup=opened.value
    popup.goto(ui.url.split('/options.html')[0]+'/popup.html?tab='+str(tab))
    return popup
def passed(name,detail=None):
    report['checks'].append({'name':name,'result':'pass',**({'detail':detail} if detail else {})});print('PASS:',name,flush=True)
def snap(page,name):
    # Playwright's default caret hiding writes empty style attributes onto every
    # form/editor node; keep the caret so exact DOM restoration stays meaningful.
    page.evaluate('window.scrollTo(0,0)');page.wait_for_timeout(120);page.screenshot(path=str(OUT/name),full_page=True,animations='disabled',caret='initial')

server=ThreadingHTTPServer(('127.0.0.1',0),Handler);Thread(target=server.serve_forever,daemon=True).start();origin='http://127.0.0.1:'+str(server.server_port)
try:
    with tempfile.TemporaryDirectory(prefix='shiyi-page-reader-') as temp,sync_playwright() as playwright:
        temp=Path(temp);extension=temp/'extension';shutil.copytree(ROOT/'releases'/('shiyi-'+VERSION),extension)
        context=playwright.chromium.launch_persistent_context(str(temp/'profile'),executable_path=binary(),headless=True,ignore_default_args=['--disable-extensions'],args=['--disable-extensions-except='+str(extension),'--load-extension='+str(extension)],viewport={'width':1250,'height':1000})
        try:
            worker=context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker',timeout=15000);ext=worker.url.split('/')[2];base='chrome-extension://'+ext
            ui=context.new_page();ui.goto(base+'/options.html#model');expect(ui.locator('h1')).to_be_visible()
            profile={'provider':'custom','name':'Local reader fixture','endpoint':origin+'/v1/chat/completions','model':'reader-fixture','auth':'bearer','timeoutSeconds':5,'rememberKey':False}
            message(ui,'SAVE_PROFILE',profile=profile,apiKey='fake-page-reader-fixture-key')
            article=context.new_page();article.on('pageerror',lambda error:report['errors'].append(str(error)));article.goto(origin+'/reading')
            initial=article.locator('main').inner_html();tab=ui.evaluate('async origin=>(await chrome.tabs.query({})).find(t=>t.url===origin+"/reading").id',origin)
            assert message(ui,'UI_STATE',tabId=tab)['tab']['enabled']
            article.locator('#note').fill('DO_NOT_SEND_CHANGED_FORM_VALUE')
            article.evaluate('window.scrollTo(0,0)')
            lead_before=article.locator('#lead').bounding_box()
            control['mode']='slow'
            popup=open_popup(ui,tab)
            with popup.expect_event('close'):
                popup.get_by_role('button',name='翻译整页',exact=True).click()
            reader=article.locator('#shiyi-extension-root')
            loading=article.locator('[data-shiyi-block-loading]')
            lead_indicator=article.locator('#lead > [data-shiyi-block-loading]')
            expect(lead_indicator).to_have_css('opacity','0.65')
            assert article.locator('#lead').bounding_box()==lead_before
            expect(article.locator('#lead')).to_have_text(P1+P2+P3)
            strip=reader.locator('.pet-progress')
            expect(strip).to_be_visible()
            expect(strip).to_have_css('height','2px')
            toggle=reader.locator('[data-pet-toggle]')
            expect(toggle).to_have_attribute('aria-expanded','false')
            start=toggle.bounding_box()
            article.mouse.move(start['x']+start['width']/2,start['y']+start['height']/2)
            article.mouse.down();article.mouse.move(52,68,steps=8);article.mouse.up()
            end=toggle.bounding_box()
            assert abs(end['x']+end['width']/2-52)<2 and abs(end['y']+end['height']/2-68)<2,(start,end)
            expect(toggle).to_have_attribute('aria-expanded','false')
            expect(reader.locator('.toast')).to_have_count(0)
            expect(strip).not_to_have_attribute('value','0')
            result=complete(ui,tab);assert result['completed']>=18 and result['failed']==0,result
            control['mode']='ok'
            expect(strip).to_be_hidden()
            expect(loading).to_have_count(0)
            passed('The popup closes after dispatch; the draggable cat stays collapsed with a thin live progress bar, and pending paragraphs show a layout-neutral indicator until done')
            assert message(ui,'UI_STATE',tabId=tab)['tab']['enabled'] and message(ui,'UI_STATE')['blacklist']==[]
            assert article.locator('[data-shiyi-mark],[data-shiyi-meaning]').count()==0
            assert article.locator('[data-shiyi-block-translation]').count()==result['completed']
            assert article.evaluate('[...document.querySelectorAll("[data-shiyi-block-translation]")].every(node=>document.querySelector("main").contains(node))'),'An inline header label must not be appended after the entire article'
            expect(article.locator('#lead')).to_have_text(P1+P2+P3)
            expect(article.locator('#lead + [data-shiyi-block-translation]')).to_contain_text('好奇心')
            lead=article.locator('#lead').bounding_box();translated=article.locator('#lead + [data-shiyi-block-translation]').bounding_box()
            article.screenshot(path=str(OUT/'bilingual-reading-preview.png'),clip={'x':lead['x']-12,'y':lead['y']-12,'width':lead['width']+24,'height':translated['y']+translated['height']-lead['y']+24},animations='disabled',caret='initial')
            snap(article,'page-bilingual.png');popup=open_popup(ui,tab);popup.bring_to_front();popup.wait_for_timeout(1200);snap(popup,'page-popup.png');popup.close()
            passed('One click translates a default-on page without any per-site activation, including headings, paragraphs, navigation, controls, lists and table cells into independent bilingual blocks',result)
            payload=json.dumps(calls,ensure_ascii=False)
            for forbidden in ['DO_NOT_SEND','const privateExample','fake-page-reader-fixture-key']:
                # The fixture key appears only in Authorization, never in model data.
                if forbidden.startswith('fake-'):assert forbidden not in json.dumps([call['data'] for call in calls])
                else:assert forbidden not in payload,forbidden
            assert all(call['cookie'] is None and call['auth']=='Bearer fake-page-reader-fixture-key' for call in calls)
            assert message(ui,'LIBRARY')['entries']==[]
            passed('Page requests exclude input values, editors, code blocks, hidden/notranslate text and credentials; reading does not populate the glossary')
            before=len(calls)
            bar=article.locator('#shiyi-extension-root').get_by_role('region',name='点译阅读控制')
            pet=article.locator('#shiyi-extension-root').get_by_role('button',name='点译小猫，展开功能',exact=True)
            expect(pet).to_have_attribute('aria-expanded','false');pet.click();bar.get_by_role('button',name='仅译文',exact=True).click()
            assert bar.evaluate('node=>{const r=node.getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight}')
            expect(article.locator('#guide')).to_have_text('阅读指南');expect(article.locator('#save')).to_have_text('收藏文章')
            assert article.locator('[data-shiyi-block-translation],[data-shiyi-mark],[data-shiyi-meaning]').count()==0
            assert article.evaluate('guideNode===document.getElementById("guide")&&buttonNode===document.getElementById("save")&&leadNode===document.getElementById("lead").firstChild')
            article.locator('#guide').click();article.locator('#save').click();assert article.evaluate('linkClicks===1&&saveClicks===1')
            expect(article.locator('#note')).to_have_value('DO_NOT_SEND_CHANGED_FORM_VALUE');expect(article.locator('#inline-code')).to_have_text('const privateExample = 42;')
            snap(article,'page-translation-only.png');assert len(calls)==before
            command(ui,tab,'mode','bilingual');command(ui,tab,'mode','translation');assert len(calls)==before
            command(ui,tab,'restore');restored=article.locator('main').inner_html()
            if restored!=initial:
                import difflib
                report['restore_difference']=[{'before':initial[a:b],'after':restored[c:d]} for tag,a,b,c,d in difflib.SequenceMatcher(None,initial,restored).get_opcodes() if tag!='equal']
            assert restored==initial,report.get('restore_difference')
            assert article.evaluate('guideNode===document.getElementById("guide")&&leadNode===document.getElementById("lead").firstChild')
            passed('Translation-only updates the original text nodes, preserves link/button handlers and form state, switches without another model call, and restores exact original markup')

            popup=open_popup(ui,tab)
            expect(popup.locator('#page-translate')).to_have_text('加载本地译文')
            popup.locator('#page-mode').select_option('translation')
            expect(popup.locator('#page-mode')).to_have_value('translation')
            with popup.expect_event('close'):
                popup.locator('#page-translate').click()
            assert complete(ui,tab)['mode']=='translation'
            expect(article.locator('#lead')).to_contain_text('好奇心')
            assert len(calls)==before
            command(ui,tab,'restore')
            passed('popup restores cached blocks in the selected reading mode without a model request')

            # Subsequent jobs reuse only block-cache data, not vocabulary entries.
            before=len(calls);command(ui,tab,'translate','bilingual');complete(ui,tab);assert len(calls)==before
            article.evaluate('document.getElementById("dynamic").append(Object.assign(document.createElement("p"),{id:"new-paragraph",textContent:"A newly loaded paragraph can be translated on request."}))')
            ui.wait_for_function('''async id=>(await chrome.runtime.sendMessage({type:'SHIYI/UI_STATE',tabId:id})).data.tab.page.newContent''',arg=tab)
            assert len(calls)==before
            command(ui,tab,'refresh');result=complete(ui,tab);assert len(calls)==before+1,result
            expect(article.locator('#new-paragraph + [data-shiyi-block-translation]')).to_have_text('新加载的段落，也可以继续翻译。')
            assert article.locator('[data-shiyi-block-translation]').count()==result['completed']
            passed('Unchanged blocks reuse cached results; dynamic content waits for an explicit action and adds exactly one new translation')

            # Narrow and dark pages must retain normal-flow reading layout.
            article.set_viewport_size({'width':390,'height':844});snap(article,'page-bilingual-mobile.png')
            assert article.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
            article.emulate_media(color_scheme='dark');snap(article,'page-bilingual-dark.png');assert article.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
            assert article.locator('#lead + [data-shiyi-block-translation]').get_attribute('data-shiyi-tone')=='dark'
            assert article.locator('#lead + [data-shiyi-block-translation]').evaluate('''node=>getComputedStyle(node).color!==getComputedStyle(document.getElementById("lead")).color&&parseFloat(getComputedStyle(node).borderInlineStartWidth)===0&&getComputedStyle(node).backgroundColor==='rgba(0, 0, 0, 0)' ''')
            article.emulate_media(color_scheme='light');article.set_viewport_size({'width':1250,'height':1000});command(ui,tab,'restore')
            passed('Bilingual blocks use text color only, transparent backgrounds and zero borders, adapt to dark pages, and fit 390px')

            # A long selected paragraph takes the block path, and short selections
            # keep using the original translate-and-save flow (baseline suite).
            article.locator('#lead').scroll_into_view_if_needed();article.evaluate('''()=>{const r=document.createRange();r.selectNodeContents(document.getElementById('lead'));getSelection().removeAllRanges();getSelection().addRange(r);document.getElementById('lead').dispatchEvent(new PointerEvent('pointerup',{bubbles:true}))}''')
            article.locator('#shiyi-extension-root').get_by_role('button',name='按段翻译为中文',exact=True).click();result=complete(ui,tab)
            assert result['scope']=='selection' and result['total']==1 and result['completed']==1,result
            assert article.locator('[data-shiyi-mark],[data-shiyi-meaning]').count()==0 and message(ui,'LIBRARY')['entries']==[]
            command(ui,tab,'restore')
            passed('Long native selections use a complete paragraph block and never add underlines, parentheses or vocabulary records')
            article.evaluate('''()=>{const r=document.createRange();r.setStartBefore(document.getElementById('lead'));r.setEndAfter(document.getElementById('linked'));getSelection().removeAllRanges();getSelection().addRange(r);document.getElementById('lead').dispatchEvent(new PointerEvent('pointerup',{bubbles:true}))}''')
            article.locator('#shiyi-extension-root').get_by_role('button',name='按段翻译为中文',exact=True).click();result=complete(ui,tab)
            assert result['total']==3 and result['completed']==3,result
            command(ui,tab,'restore');passed('A selection crossing paragraphs and a heading keeps three independent content blocks')

            giant=context.new_page();giant.goto(origin+'/giant');giant_tab=ui.evaluate('async origin=>(await chrome.tabs.query({})).find(t=>t.url===origin+"/giant").id',origin)
            before=len(calls);command(ui,giant_tab,'translate','translation');result=complete(ui,giant_tab)
            assert result['completed']==2 and result['failed']==0,result
            paragraph_calls=[call for call in calls[before:] if any('A long paragraph' in part['text'] for part in call['data'].get('parts',[]))]
            assert len(paragraph_calls)>=6 and all(sum(len(part['text']) for part in call['data']['parts'])<=1800 for call in paragraph_calls)
            assert giant.locator('#giant').inner_text().count('meaningful detail.')==180
            assert control['peak']<=2,control['peak'];command(ui,giant_tab,'restore');giant.close()
            passed('A 10k-character paragraph is chunked under 1800 characters per request, committed as one complete block, with at most two concurrent requests')
            many=context.new_page();many.goto(origin+'/many');many_tab=ui.evaluate('async origin=>(await chrome.tabs.query({})).find(t=>t.url===origin+"/many").id',origin)
            many.locator('body > p').last.scroll_into_view_if_needed()
            command(ui,many_tab,'translate','bilingual');result=complete(ui,many_tab)
            assert result['completed']==400 and result['waiting']==5 and result['limited'],result
            assert many.locator('body > p').last.evaluate('node=>node.nextElementSibling?.hasAttribute("data-shiyi-block-translation")'), 'The current viewport must be included even beyond the first 400 DOM blocks'
            command(ui,many_tab,'resume');result=complete(ui,many_tab);assert result['completed']==405 and result['waiting']==0,result
            command(ui,many_tab,'restore');many.close()
            passed('Large feeds include the current viewport beyond the first 400 DOM blocks, pause at the budget, and explicitly continue the remaining five blocks')

            feed=context.new_page();feed.goto(origin+'/viewport');feed_tab=ui.evaluate('async url=>(await chrome.tabs.query({})).find(t=>t.url===url).id',feed.url)
            try:
                before=len(calls);control['mode']='viewport';command(ui,feed_tab,'translate','translation')
                expect(feed.locator('#viewport-0')).to_have_text('译文：Viewport paragraph number 0.')
                deadline=time.monotonic()+3
                while not any(call['held'] for call in calls[before:]) and time.monotonic()<deadline:feed.wait_for_timeout(25)
                assert any(call['held'] for call in calls[before:]),'Expected a slow background batch'
                feed.locator('#feed').evaluate('node=>node.scrollTop=560*64')
                expect(feed.locator('#viewport-560')).to_have_text('译文：Viewport paragraph number 560.',timeout=3000)
                assert not release_background.is_set()
            finally:
                control['mode']='ok';release_background.set()
            result=complete(ui,feed_tab)
            assert result['completed']==400 and result['waiting']==220 and result['failed']==0 and control['peak']<=2,result
            command(ui,feed_tab,'restore');feed.close()
            passed('Scrolling inside a clipped feed translates the newly visible block beyond the initial 400 without waiting for the slow background batch or expanding the budget')

            duplicate=context.new_page();duplicate.goto(origin+'/duplicates');duplicate_tab=ui.evaluate('async url=>(await chrome.tabs.query({})).find(t=>t.url===url).id',duplicate.url)
            before=len(calls);command(ui,duplicate_tab,'translate','bilingual');result=complete(ui,duplicate_tab)
            assert result['completed']==16 and len(calls)-before<=2,(result,len(calls)-before)
            command(ui,duplicate_tab,'restore');duplicate.close()
            passed('Identical short blocks reuse one per-block cache result and batch deduplication rather than generating sixteen translations')

            # Change model ID to avoid cache while testing failure and cancellation.
            def fresh_model(label):message(ui,'SAVE_PROFILE',profile={**profile,'model':'reader-fixture-'+label},apiKey='fake-page-reader-fixture-key')
            fresh_model('pause');control['mode']='slow';command(ui,tab,'translate','bilingual')
            deadline=time.monotonic()+10
            while time.monotonic()<deadline:
                partial=status(ui,tab)
                if partial and partial['completed']>0:break
                ui.wait_for_timeout(60)
            assert partial['running'] and partial['completed']>0,partial
            expect(loading.first).to_be_attached()
            command(ui,tab,'stop');expect(loading).to_have_count(0)
            paused=complete(ui,tab);assert paused['phase']=='paused' and paused['completed']>=partial['completed'] and paused['waiting']>0,paused
            ui.wait_for_timeout(150);assert status(ui,tab)['completed']==paused['completed'],'Stopped work must not keep applying delayed results'
            before=len(calls);command(ui,tab,'mode','translation');assert len(calls)==before
            control['mode']='ok';command(ui,tab,'resume');result=complete(ui,tab);assert result['completed']==result['total'] and result['failed']==0,result
            assert len(calls)-before<=paused['waiting'],(len(calls)-before,paused)
            command(ui,tab,'restore');passed('Stop retains completed blocks, mode switching works while paused, and resume requests only unfinished work')
            fresh_model('alignment');control['mode']='alignment';command(ui,tab,'translate','translation');result=complete(ui,tab)
            assert result['failed']==1 and result['completed']>=17,result
            expect(loading).to_have_count(0)
            expect(article.locator('#alignment a')).to_have_text('the important link')
            control['mode']='ok';before=len(calls);command(ui,tab,'retry');result=complete(ui,tab);assert result['failed']==0 and len(calls)==before+1,result
            command(ui,tab,'restore');passed('Malformed multi-part output keeps its original paragraph and retry only requests the failed block')

            fresh_model('batch-fallback');control['mode']='batch-unsupported';command(ui,tab,'translate','bilingual');result=complete(ui,tab)
            assert result['failed']>0 and result['completed']>0,result
            before=len(calls);failed=result['failed'];command(ui,tab,'retry');result=complete(ui,tab)
            assert result['failed']==0 and len(calls)-before==failed,(result,len(calls)-before,failed)
            assert all(call['data']['task']=='block' for call in calls[before:])
            command(ui,tab,'restore');passed('Models that reject the batch response shape retain their original blocks and retry only failed items through the compatible single-block path')

            fresh_model('html');control['mode']='html';command(ui,tab,'translate','bilingual');complete(ui,tab)
            assert article.locator('[data-shiyi-block-translation] img').count()==0 and article.evaluate('window.readerInjection') is None
            expect(article.locator('#alignment + [data-shiyi-block-translation]')).to_contain_text('<img')
            command(ui,tab,'restore');passed('Model HTML is rendered as literal text and cannot inject elements or execute handlers')

            fresh_model('cancel');control['mode']='slow';before=len(calls);command(ui,tab,'translate','translation')
            ui.wait_for_function('''async id=>(await chrome.runtime.sendMessage({type:'SHIYI/UI_STATE',tabId:id})).data.tab.page.running''',arg=tab)
            expect(loading.first).to_be_attached();command(ui,tab,'restore');expect(loading).to_have_count(0);article.wait_for_timeout(1800)
            assert not status(ui,tab)['active'] and article.locator('[data-shiyi-block-translation],[data-shiyi-mark],[data-shiyi-meaning]').count()==0
            expect(article.locator('#guide')).to_have_text('the reading guide');assert message(ui,'LIBRARY')['entries']==[]
            passed('Restoring during delayed HTTP requests cancels pending work and late results cannot overwrite the original page')

            fresh_model('change');command(ui,tab,'translate','translation');article.wait_for_timeout(150)
            article.evaluate('document.getElementById("lead").firstChild.data="Site changed this paragraph while translation was in progress."')
            result=complete(ui,tab);assert result['newContent'],result
            expect(article.locator('#lead')).to_contain_text('Site changed this paragraph while translation was in progress.')
            command(ui,tab,'restore');expect(article.locator('#lead')).to_contain_text('Site changed this paragraph while translation was in progress.')
            passed('A page-owned text change invalidates the old paragraph result; restore preserves the newer site text')

            control['mode']='ok';fresh_model('auth');control['mode']='401';before=len(calls);command(ui,tab,'translate','bilingual');result=complete(ui,tab)
            assert result['phase']=='paused' and len(calls)<=before+2,result
            assert result['errorCode']=='HTTP_401';command(ui,tab,'restore');control['mode']='ok'
            passed('Authentication errors pause the whole queue after at most two requests and retain original text')

            fresh_model('rate-limit');control['mode']='429';before=len(calls);command(ui,tab,'translate','bilingual');result=complete(ui,tab)
            assert result['phase']=='paused' and result['errorCode']=='HTTP_429' and len(calls)<=before+2,result
            command(ui,tab,'restore');control['mode']='ok'
            passed('Rate limiting pauses both batch workers after at most two requests without automatic retry loops')

            command(ui,tab,'translate','bilingual');complete(ui,tab);article.evaluate('history.pushState({},"","/another-page")');article.wait_for_timeout(1100)
            assert not status(ui,tab)['active'] and article.locator('[data-shiyi-block-translation]').count()==0
            passed('Client-side navigation cancels the reading job and removes translations from the prior route')
            fresh_model('blacklist');control['mode']='slow';command(ui,tab,'translate','translation');article.wait_for_timeout(150)
            message(ui,'BLACKLIST_SET',site=origin,blocked=True);expect(article.locator('#shiyi-extension-root')).to_have_count(0);article.wait_for_timeout(1750)
            assert article.locator('[data-shiyi-block-translation],[data-shiyi-mark],[data-shiyi-meaning]').count()==0
            expect(article.locator('#guide')).to_have_text('the reading guide')
            before=len(calls);denied=ui.evaluate('id=>chrome.runtime.sendMessage({type:"SHIYI/PAGE_COMMAND",tabId:id,action:"translate"})',tab)
            assert not denied['ok'] and denied['error']['code']=='SITE_DISABLED' and len(calls)==before
            control['mode']='ok';message(ui,'BLACKLIST_SET',site=origin,blocked=False);expect(article.locator('#shiyi-extension-root')).to_be_attached()
            passed('Blacklisting a reading page restores source text, cancels delayed chunks, and rejects further page translation until restored')
            assert not report['errors'],report['errors'];report['model_requests']=len(calls);report['peak_concurrent_requests']=control['peak'];report['result']='pass'
        finally:context.close()
except Exception as error:
    report['result']='fail';report['failure']=str(error);raise
finally:
    server.shutdown();server.server_close();(OUT/'page-translation-e2e.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps({'result':report['result'],'checks':len(report['checks']),'failure':report.get('failure')},ensure_ascii=False),flush=True)
