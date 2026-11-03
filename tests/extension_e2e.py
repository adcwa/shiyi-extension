"""Load the real MV3 extension in an isolated Chromium profile.

The production manifest grants HTTP(S) access for default-on behavior. Only the
test-copy model endpoints are mapped to loopback; fake keys never leave this host.
The HTTP fixture is NOT an LLM and is never included in the release package.
"""
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread, Lock
from playwright.sync_api import sync_playwright, expect
import json, os, shutil, tempfile, time, urllib.parse

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'verification'
OUT.mkdir(exist_ok=True)
VERSION = json.loads((ROOT / 'package.json').read_text())['version']
RELEASE = ROOT / ('releases/shiyi-' + VERSION)
report = {'version': VERSION, 'date': '2026-11-02', 'checks': [], 'result': 'running', 'page_errors': [],
          'scope': 'Actual MV3 extension, real loopback HTTP transport, deterministic model fixture; no external LLM credentials.',
          'permission_note': 'Production package loaded unchanged with the user-requested HTTP(S) default access. Functional test copy maps vendor endpoints to loopback; permission acceptance and OS-native menu clicking need separate desktop verification. Context-menu callback replay exists only in the test copy.',
          'edge_note': 'The same MV3 package targets Chrome and Edge 120+. No Microsoft Edge binary is installed on this host; native Edge installation remains a manual check.'}
calls, control, guard = [], {'mode': 'ok'}, Lock()
ARTICLE = '''<!doctype html><html lang="en"><head><meta charset="utf-8"><title>A quieter way to read · Local acceptance article</title><style>
body{margin:0;background:#f5f5f0;color:#344b3b;font:20px/1.9 Georgia,serif}main{max-width:920px;margin:40px auto;background:white;border:1px solid #dce5d7;border-radius:14px;padding:38px 48px}header{display:flex;justify-content:space-between;border-bottom:1px solid #e1e7dc;padding-bottom:18px;margin-bottom:32px}header strong{font-size:25px}small{font:11px/1.8 -apple-system,sans-serif;letter-spacing:1px;color:#778b70}h1{font-size:49px;font-weight:400;line-height:1.15;letter-spacing:-1.4px;max-width:600px;margin:18px 0 25px}p{margin:22px 0}a{color:inherit}pre,textarea,[contenteditable]{font:13px/1.8 monospace;background:#f3f6ef;padding:12px;border:1px solid #dce5d7;border-radius:7px}footer{margin-top:30px;padding-top:18px;border-top:1px solid #dfe7d9;font:11px/1.8 -apple-system,sans-serif;color:#7c8e73}@media(max-width:700px){main{margin:15px;padding:22px}h1{font-size:36px}}
</style></head><body><main><header><strong>margin.</strong><small>LOCAL ACCEPTANCE ARTICLE</small></header><small>THE ART OF READING / EXTENSION VERIFICATION</small><h1>A quieter way to read the web.</h1>
<p id="lead">Curiosity can turn an ordinary day into a moment of serendipity.</p>
<p id="phrase">Good tools reduce cognitive <em>load</em> and make reading intentional.</p>
<p id="sentence">Good tools leave room for thought.</p>
<p id="boundary">Art is not partial. An artist needs practice.</p>
<p id="more">A nuance can be meaningful. maliciousword failureword cancelword timeoutword resurrection. menuword blockword automationword</p>
<p><a id="preserved" href="/target">intentional link</a></p>
<pre id="code"><code>Curiosity cognitive load serendipity</code></pre><textarea id="input">Curiosity cognitive load</textarea><div id="editor" contenteditable="true">Curiosity serendipity</div><div id="hidden" hidden>Curiosity serendipity</div><div id="dynamic"></div><footer>这是本地验收文章。译文由兼容接口测试服务返回，用于验证扩展链路。</footer></main><script>document.getElementById('preserved').addEventListener('click',e=>{e.preventDefault();window.linkClicks=(window.linkClicks||0)+1;});</script></body></html>'''

TOOLTIP_ARTICLE = '''<!doctype html><html lang="en"><head><meta charset="utf-8"><title>点译 · 释义卡片阅读示例</title><style>
body{margin:0;background:#f7f8f5;color:#263735;font:16px/1.8 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:680px;margin:48px auto;padding:28px;background:white;border:1px solid #e2e8df;border-radius:12px}small{font-size:11px;letter-spacing:1px;color:#657268}h1{font-size:24px;font-weight:600;margin:12px 0 22px}p{margin:16px 0}@media(max-width:700px){main{margin:16px;padding:20px}}</style></head><body><main><small>点译 · 阅读示例</small><h1>OpenAI API 开发指南</h1><p id="api-title">Build with the OpenAI API in ChatGPT and Codex</p><p>Connect your tools and keep reading with less interruption.</p></main></body></html>'''

PERFORMANCE_ARTICLE = '<!doctype html><html><head><meta charset="utf-8"><title>Glossary performance fixture</title><style>body{font:16px/1.8 sans-serif;max-width:900px;margin:25px auto}p{margin:9px 0}</style></head><body><h1>Local performance fixture</h1><script>window.longTasks=[];window.perfObserver=new PerformanceObserver(list=>longTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration}))));perfObserver.observe({type:"longtask",buffered:false});</script>' + ''.join('<p>term9999 and term42 are useful words to remember here.</p>' for _ in range(400)) + '</body></html>'

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def do_GET(self):
        self.send_response(200); self.send_header('Content-Type', 'text/html; charset=utf-8'); self.end_headers(); self.wfile.write((PERFORMANCE_ARTICLE if self.path.startswith('/performance') else TOOLTIP_ARTICLE if self.path.startswith('/tooltip') else ARTICLE).encode())
    def do_POST(self):
        payload = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))))
        native_mt=payload['model'].startswith('qwen-mt-')
        data = {'text':payload['messages'][-1]['content'],'targetLanguage':'简体中文'} if native_mt else json.loads(payload['messages'][-1]['content'])
        with guard:
            calls.append({'path': self.path, 'payload': payload, 'data': data, 'authorization': self.headers.get('Authorization'), 'cookie': self.headers.get('Cookie')})
            mode = control['mode']
        if mode in ('slow', 'timeout'): time.sleep(2 if mode == 'slow' else 7)
        try:
            if mode == '401':
                self.send_response(401); self.end_headers(); self.wfile.write(b'upstream must not be reflected: fixture-key'); return
            if mode == 'malformed':
                self.send_response(200); self.end_headers(); self.wfile.write(b'<html>not a model response</html>'); return
            if data.get('task') in ('block', 'blocks'):
                def translated(parts):
                    return [{'id':part['id'],'text':('译文：'+part['text']) if part['text'].strip() and not part['text'].startswith('⟦SHIYI_') else part['text']} for part in parts]
                result = {'blocks':[{'id':block['id'],'parts':translated(block['parts'])} for block in data['blocks']]} if data['task']=='blocks' else {'parts':translated(data['parts'])}
                output={'choices':[{'message':{'content':json.dumps(result,ensure_ascii=False)}}]}
                self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(json.dumps(output).encode());return
            text = data['text']; key = text.lower()
            translations = {'curiosity': '好奇心；求知欲', 'serendipity': '意外发现的美好；机缘巧合', 'cognitive load': '认知负荷', 'good tools leave room for thought.': '好的工具会为思考留出空间。', 'good tools reduce cognitive load and make reading intentional.': '好的工具减少认知负荷，让阅读更有目的。', 'art': '艺术', 'intentional': '有意识的；有明确目的的', 'nuance': '细微差别', 'maliciousword': '<img src=x onerror="window.shiyiInjected=1">'}
            translations['build with the openai api in chatgpt and codex'] = '在 ChatGPT 和 Codex 中使用 OpenAI API 进行开发'
            translation = translations.get(key, '本地接口验收释义：' + text)
            kind = 'sentence' if text.endswith('.') else 'phrase' if ' ' in text else 'word'
            output = {'choices': [{'message': {'content': translation if native_mt else json.dumps({'translation': translation, 'kind': kind, 'sourceLanguage': 'en'}, ensure_ascii=False)}}]}
            self.send_response(200); self.send_header('Content-Type', 'application/json'); self.end_headers(); self.wfile.write(json.dumps(output).encode())
        except (BrokenPipeError, ConnectionResetError): pass

def passed(name, detail=None):
    item = {'name': name, 'result': 'pass'}
    if detail: item['detail'] = detail
    report['checks'].append(item)
    print('PASS:', name, flush=True)

def browser_binary():
    override = os.environ.get('SHIYI_TEST_CHROMIUM')
    if override: return override
    cache = Path.home() / 'Library/Caches/ms-playwright'
    for folder in sorted(cache.glob('chromium-*'), key=lambda p: int(p.name.split('-')[-1]), reverse=True):
        candidate = folder / 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
        if candidate.exists(): return str(candidate)
    return None

def launch(playwright, profile, extension):
    return playwright.chromium.launch_persistent_context(str(profile), executable_path=browser_binary(), headless=True,
        ignore_default_args=['--disable-extensions'], args=['--disable-extensions-except=' + str(extension), '--load-extension=' + str(extension)],
        viewport={'width': 1440, 'height': 1160}, device_scale_factor=1, accept_downloads=True)

def extension_id(context):
    worker = context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker', timeout=15000)
    return worker.url.split('/')[2]

def message(page, type, **kwargs):
    reply = page.evaluate('(msg)=>chrome.runtime.sendMessage(msg)', {'type': 'SHIYI/' + type, **kwargs})
    assert reply and reply.get('ok'), reply
    return reply['data']

def native_menu(context, tab, item, **info):
    worker=context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker',timeout=15000)
    return worker.evaluate('value=>globalThis.__shiyiMenuReplay(value.info,{id:value.tab})',{'tab':tab,'info':{'menuItemId':'shiyi-'+item,'frameId':0,**info}})

def wait_page(ui,tab):
    deadline=time.monotonic()+30;state=None
    while time.monotonic()<deadline:
        state=message(ui,'UI_STATE',tabId=tab)['tab']['page']
        if state and state['active'] and not state['running'] and state['phase']=='complete':return state
        ui.wait_for_timeout(60)
    raise AssertionError(state)

def select_text(page, selector, text):
    page.locator(selector).scroll_into_view_if_needed(); page.wait_for_timeout(80)
    rects = page.evaluate('''({selector,text})=>{const root=document.querySelector(selector),nodes=[],walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let n,raw='';while(n=walker.nextNode()){if(n.parentElement.closest('[data-shiyi-meaning]'))continue;nodes.push({node:n,start:raw.length,end:raw.length+n.length});raw+=n.textContent;}const start=raw.indexOf(text);if(start<0)throw Error('Text not found: '+text);const end=start+text.length,a=nodes.find(n=>n.end>start),b=nodes.find(n=>n.end>=end);const r=document.createRange();r.setStart(a.node,start-a.start);r.setEnd(b.node,end-b.start);return [...r.getClientRects()].filter(r=>r.width>0).map(r=>({x:r.x,y:r.y,width:r.width,height:r.height}));}''', {'selector': selector, 'text': text})
    first, last = rects[0], rects[-1]
    page.mouse.move(first['x'] + .2, first['y'] + first['height'] / 2); page.mouse.down()
    page.mouse.move(last['x'] + last['width'] - .2, last['y'] + last['height'] / 2, steps=16); page.mouse.up()
    expect(page.locator('#shiyi-extension-root').get_by_role('button', name='翻译为中文', exact=True)).to_be_visible()

def translate(page, selector, text):
    select_text(page, selector, text)
    page.locator('#shiyi-extension-root').get_by_role('button', name='翻译为中文', exact=True).click()

def dismiss(page):
    page.keyboard.press('Escape'); page.evaluate('getSelection()?.removeAllRanges()'); page.mouse.move(5, 5)

def screenshot(page, name, full=True):
    page.evaluate('window.scrollTo(0,0)'); page.wait_for_timeout(120)
    page.screenshot(path=str(OUT / name), full_page=full, animations='disabled', style='#notice{visibility:hidden!important}')

servers = [ThreadingHTTPServer(('127.0.0.1', 0), Handler) for _ in range(2)]
for server in servers: Thread(target=server.serve_forever, daemon=True).start()
origin_a = 'http://127.0.0.1:' + str(servers[0].server_port)
origin_b = 'http://localhost:' + str(servers[1].server_port)
context = None
try:
    with tempfile.TemporaryDirectory(prefix='shiyi-e2e-') as temp, sync_playwright() as p:
        try:
            temp = Path(temp)
            # Default-on access is explicitly requested; installation still starts
            # without a model, vocabulary, blacklist entries, or model requests.
            production = launch(p, temp / 'production-profile', RELEASE)
            ext = extension_id(production); prod_ui = production.new_page(); prod_ui.goto(f'chrome-extension://{ext}/options.html#model')
            expect(prod_ui.get_by_label('API Key', exact=True)).to_be_visible(); expect(prod_ui.get_by_role('button',name='DeepSeek',exact=True)).to_have_attribute('aria-pressed','true');expect(prod_ui.get_by_label('服务地址（自动配置）',exact=True)).not_to_be_visible();screenshot(prod_ui,'provider-setup.png')
            initial = message(prod_ui, 'UI_STATE')
            grants = prod_ui.evaluate('()=>chrome.permissions.getAll()')
            assert initial['count'] == 0 and initial['blacklist'] == [] and not initial['profile']['endpoint'] and set(grants.get('origins', [])) == {'http://*/*','https://*/*'}
            assert 'contextMenus' in grants['permissions'] and initial['sitePolicy']=='blacklist'
            prod_article=production.new_page();prod_article.goto(origin_a+'/production-default');expect(prod_article.locator('#shiyi-extension-root')).to_be_attached();assert len(calls)==0
            report['browser'] = prod_ui.evaluate('navigator.userAgent')
            passed('Unmodified production extension defaults on for HTTP(S) pages, with an empty blacklist and no automatic model calls')
            production.close()
    
            fixture = temp / 'test-extension'; shutil.copytree(RELEASE, fixture)
            # Only the isolated test copy exposes a native-callback replay hook.
            background=fixture/'background.js';background.write_text(background.read_text()+"\nglobalThis.__shiyiMenuReplay=(info,tab)=>ready.then(()=>menus.click(info,tab));globalThis.__shiyiMigrate=()=>settings.initializeStorage();\n")
            # Only test-copy vendor URLs are mapped to deterministic loopback routes.
            # The shipped providers.js retains the official HTTPS endpoints.
            vendor_js=fixture/'lib/providers.js'
            vendor_source=vendor_js.read_text()
            for official,local in {
                'https://api.deepseek.com/chat/completions':origin_a+'/vendor/deepseek/chat/completions',
                'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions':origin_a+'/vendor/qwen-cn/chat/completions',
                'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions':origin_a+'/vendor/qwen-intl/chat/completions',
                'https://api.openai.com/v1/chat/completions':origin_a+'/vendor/openai/chat/completions'
            }.items(): vendor_source=vendor_source.replace(official,local)
            vendor_js.write_text(vendor_source)
            presets=launch(p,temp/'preset-profile',fixture);preset_id=extension_id(presets);setup=presets.new_page();setup.goto(f'chrome-extension://{preset_id}/options.html#model')
            setup.on('pageerror',lambda e:report['page_errors'].append(str(e)))
            for provider,label,model_name,route_suffix,parameter in [
                ('deepseek','DeepSeek','deepseek-flash','deepseek',('thinking',{'type':'disabled'})),
                ('qwen','通义千问','qwen-mt-flash','qwen-cn',('native_mt',True)),
                ('openai','OpenAI','gpt-6-luna','openai',('reasoning_effort','none'))
            ]:
                before=len(calls);setup.get_by_role('button',name=label,exact=True).click();expect(setup.locator('#model-key')).to_have_value('');assert len(calls)==before
                expect(setup.locator('#model-endpoint')).not_to_be_visible();expect(setup.locator('#model-id')).not_to_be_visible();assert setup.locator('input[required]:visible').count()==1
                setup.locator('#model-key').fill(provider+'-fixture-key');setup.get_by_role('button',name='连接并保存',exact=True).click();expect(setup.locator('#connection-result')).to_contain_text('已连接并保存')
                saved=message(setup,'UI_STATE')['profile'];assert saved['provider']==provider and saved['model']==model_name and saved['hasKey']
                assert calls[-1]['path']=='/vendor/'+route_suffix+'/chat/completions' and calls[-1]['authorization']=='Bearer '+provider+'-fixture-key'
                if provider=='qwen':
                    assert len(calls[-1]['payload']['messages'])==1 and calls[-1]['payload']['translation_options']['target_lang']=='Chinese' and 'enable_thinking' not in calls[-1]['payload']
                else:assert calls[-1]['payload'][parameter[0]]==parameter[1]
                assert len(calls)==before+1
                expect(setup.locator('#model-key')).to_have_value('')
                expect(setup.locator('#current-model')).to_have_text(model_name);expect(setup.locator('.model-recommendation')).to_have_text('推荐')
                setup.locator('#model-advanced summary').click()
                expect(setup.locator('#model-id')).to_have_value(model_name)
                expect(setup.locator('#model-id option').first).to_have_text(model_name+' · 推荐 · 日常翻译')
                setup.locator('#model-advanced summary').click()
            passed('DeepSeek, Qwen and OpenAI connect and save with only a key; each request uses its own defaults and credential')
            passed('Every preset displays its recommended model before advanced settings and recommendation text appears after the native option label without altering API model IDs')
            setup.get_by_role('button',name='通义千问',exact=True).click();setup.locator('#model-key').fill('qwen-choice-fixture-key');setup.locator('#model-advanced summary').click();before=len(calls)
            setup.locator('#model-id').select_option('qwen-plus');expect(setup.locator('.model-recommendation')).to_have_text('按需选择');expect(setup.locator('#model-key')).to_have_value('qwen-choice-fixture-key');expect(setup.locator('#current-model-advice')).to_contain_text('费用高于')
            setup.get_by_role('button',name='改用推荐模型',exact=True).click();expect(setup.locator('#model-id')).to_have_value('qwen-mt-flash');expect(setup.locator('.model-recommendation')).to_have_text('推荐');expect(setup.locator('#model-key')).to_have_value('qwen-choice-fixture-key');assert len(calls)==before
            screenshot(setup,'provider-model-recommendations.png')
            for width in [1440,1024,768,375]:
                setup.set_viewport_size({'width':width,'height':1050});assert setup.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),width
            setup.set_viewport_size({'width':1440,'height':1160})
            passed('Higher-tier guidance and one-click recommendation preserve the typed key, send no request, and the model chooser fits 375–1440px')
            setup.get_by_role('button',name='OpenAI',exact=True).click();setup.locator('#model-key').fill('openai-manual-fixture-key');setup.locator('#model-advanced summary').click();before=len(calls)
            setup.locator('#model-id').select_option('__other__');setup.locator('#other-model').fill('account-specific-model');expect(setup.locator('#current-model')).to_have_text('account-specific-model');expect(setup.locator('.model-recommendation')).to_have_text('自选模型');expect(setup.locator('#model-key')).to_have_value('openai-manual-fixture-key');assert len(calls)==before
            setup.get_by_role('button',name='连接并保存',exact=True).click();expect(setup.locator('#connection-result')).to_contain_text('已连接并保存');assert calls[-1]['payload']['model']=='account-specific-model'
            setup.reload();expect(setup.locator('#current-model')).to_have_text('account-specific-model');expect(setup.locator('.model-recommendation')).to_have_text('自选模型')
            setup.locator('#model-advanced summary').click();expect(setup.locator('#model-id')).to_have_value('account-specific-model');before=len(calls)
            setup.get_by_role('button',name='改用推荐模型',exact=True).click();assert len(calls)==before
            setup.get_by_role('button',name='连接并保存',exact=True).click();expect(setup.locator('#connection-result')).to_contain_text('已连接并保存');assert calls[-1]['payload']['model']=='gpt-6-luna' and calls[-1]['payload']['reasoning_effort']=='none'
            passed('Manual model IDs save and survive reload without a false recommendation; explicitly returning to the recommendation sends the real ID and disables reasoning')
            setup.get_by_role('button',name='通义千问',exact=True).click();setup.locator('#model-key').fill('do-not-reuse-on-region-change');setup.locator('#model-advanced summary').click();before=len(calls);setup.locator('#provider-region').select_option('intl');expect(setup.locator('#model-key')).to_have_value('');assert len(calls)==before
            setup.locator('#model-key').fill('qwen-intl-fixture-key');setup.get_by_role('button',name='连接并保存',exact=True).click();expect(setup.locator('#connection-result')).to_contain_text('已连接并保存');assert calls[-1]['path']=='/vendor/qwen-intl/chat/completions' and message(setup,'UI_STATE')['profile']['region']=='intl'
            passed('Vendor and region switches clear typed keys and never send a request until explicitly connecting')
            before=len(calls);setup.get_by_role('button',name='仅测试连接',exact=True).click();expect(setup.locator('#connection-result')).to_contain_text('连接成功');setup.get_by_role('button',name='仅测试连接',exact=True).click();expect(setup.locator('#connection-result')).to_contain_text('连接成功');assert len(calls)==before+2
            setup.get_by_role('button',name='连接并保存',exact=True).click();expect(setup.locator('#connection-result')).to_contain_text('已连接并保存');assert len(calls)==before+2
            passed('Test-only actions perform fresh requests; saving a just-tested unchanged connection does not bill a duplicate test')
            setup.get_by_role('button',name='自定义服务',exact=True).click();setup.locator('#model-endpoint').fill(origin_a+'/legacy/v1');setup.locator('#model-id').fill('legacy-model');setup.locator('#model-key').fill('legacy-fixture-key');setup.get_by_role('button',name='连接并保存',exact=True).click();expect(setup.locator('#connection-result')).to_contain_text('已连接并保存')
            setup.evaluate("async()=>{const {config}=await chrome.storage.local.get('config');delete config.profile.provider;delete config.profile.region;await chrome.storage.local.set({config})}");setup.reload();expect(setup.get_by_role('button',name='自定义服务',exact=True)).to_have_attribute('aria-pressed','true');expect(setup.locator('#model-id')).to_have_value('legacy-model');assert message(setup,'UI_STATE')['profile']['hasKey']
            passed('Upgrading a v0.1.0 custom connection preserves the endpoint, model and saved credential identity')
            before_upgrade=message(setup,'UI_STATE')
            setup.evaluate('''async origins=>{const {config}=await chrome.storage.local.get('config');config.version=1;delete config.sitePolicy;delete config.blacklist;config.sites=[{origin:origins[0],enabled:true},{origin:origins[1],enabled:false}];await chrome.storage.local.set({config});await chrome.storage.session.set({temporary:{99:'old-document'}});await new Promise((resolve,reject)=>{const q=indexedDB.open('shiyi-vocabulary');q.onsuccess=()=>{const db=q.result,tx=db.transaction('entries','readwrite');tx.objectStore('entries').put({id:'kept-after-upgrade',identity:'zh-CN\\u001fkept',text:'kept',translation:'保留',targetLanguage:'zh-CN',kind:'word',style:'regular',sourceLanguage:'en',createdAt:1,updatedAt:1,source:{}});tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>reject(tx.error)}})}''',[origin_a,origin_b])
            presets.service_workers[0].evaluate('()=>globalThis.__shiyiMigrate()');upgraded=message(setup,'UI_STATE')
            assert upgraded['blacklist']==['localhost'] and upgraded['sitePolicy']=='blacklist' and upgraded['profile']==before_upgrade['profile'] and upgraded['prefs']==before_upgrade['prefs']
            assert message(setup,'LIBRARY')['entries'][0]['id']=='kept-after-upgrade'
            assert setup.evaluate('async()=>{const {config}=await chrome.storage.local.get("config");return !config.sites&&!(await chrome.storage.session.get("temporary")).temporary}')
            passed('Actual storage migration retains credentials, model, preferences and vocabulary; explicit old pauses become blacklist rules and temporary overrides are removed')
            presets.close()
            context = launch(p, temp / 'functional-profile', fixture); ext = extension_id(context); base = f'chrome-extension://{ext}'
            ui = context.new_page(); ui.on('pageerror', lambda e: report['page_errors'].append(str(e))); ui.goto(base + '/options.html#sites'); expect(ui.get_by_label('停用网站', exact=True)).to_be_visible()
            baseline_calls = len(calls)
            article = context.new_page(); article.on('pageerror', lambda e: report['page_errors'].append(str(e))); article.goto(origin_a + '/read?private-token=never-send#section')
            assert article.locator('[data-shiyi-mark]').count() == 0;expect(article.locator('#shiyi-extension-root')).to_be_attached()
            translate(article, '#lead', 'Curiosity'); expect(article.locator('#shiyi-extension-root').get_by_text('先配置你自己的翻译模型，再开始翻译。', exact=True)).to_be_visible(); assert len(calls) == baseline_calls
            passed('A newly opened website immediately supports native selection without enabling or adding a rule; an unconfigured model sends no request')
            dismiss(article); ui.goto(base + '/options.html#model');ui.get_by_role('button',name='自定义服务',exact=True).click();ui.locator('#model-advanced summary').click(); ui.get_by_label('连接名称', exact=True).fill('本地接口验收'); ui.get_by_label('服务地址', exact=True).fill(origin_a + '/v1'); ui.get_by_label('模型名称', exact=True).fill('fixture-translation'); ui.get_by_label('API Key', exact=True).fill('fixture-key')
            ui.get_by_role('button', name='仅测试连接', exact=True).click(); expect(ui.locator('#connection-result')).to_contain_text('连接成功'); assert calls[-1]['path'] == '/v1/chat/completions' and calls[-1]['data']['text'] == 'curiosity'
            ui.get_by_role('button', name='连接并保存', exact=True).click(); expect(ui.get_by_label('API Key', exact=True)).to_have_value('')
            expect(ui.locator('#notice')).to_contain_text('模型连接已保存')
            assert not ui.evaluate('()=>chrome.storage.local.get("credential").then(x=>!!x.credential)')
            assert ui.evaluate('()=>chrome.storage.session.get("credential").then(x=>!!x.credential)')
            assert calls[-1]['authorization'] == 'Bearer fixture-key' and calls[-1]['cookie'] is None
            passed('Model form performs actual HTTP POST, tests the fixed word, saves config, and keeps key in session storage')
            screenshot(ui, 'model-connection.png')
            translate(article, '#lead', 'Curiosity'); expect(article.locator('#shiyi-extension-root').get_by_text('好奇心；求知欲', exact=True)).to_be_visible(); expect(article.locator('#lead [data-shiyi-mark]')).to_have_count(1)
            assert calls[-1]['data'] == {'text': 'Curiosity', 'targetLanguage': '简体中文'} and 'private-token' not in json.dumps(calls[-1]['payload'])
            passed('Native word selection translates, persists and underlines; default request has no context or page URL')
            dismiss(article); translate(article, '#phrase', 'cognitive load'); expect(article.locator('#phrase [data-shiyi-mark]')).to_have_count(2)
            assert calls[-1]['data']['text'] == 'cognitive load'
            dismiss(article); translate(article, '#sentence', 'Good tools leave room for thought.'); expect(article.locator('#sentence [data-shiyi-mark]')).to_have_count(1)
            assert message(ui, 'UI_STATE')['count'] == 3
            passed('Phrases crossing inline emphasis and full sentences translate while preserving the original elements')
            dismiss(article); ui.goto(base + '/options.html#translation'); ui.get_by_role('button', name='括号释义', exact=True).click(); ui.get_by_role('button', name='保存偏好', exact=True).click(); expect(article.locator('[data-shiyi-meaning]')).to_have_count(3); expect(article.locator('#phrase [data-shiyi-meaning]')).to_have_count(1)
            assert article.locator('#phrase em').count() == 1
            translate(article, '#phrase', 'Good tools reduce cognitive load and make reading intentional.')
            expect(article.locator('#shiyi-extension-root').get_by_text('好的工具减少认知负荷，让阅读更有目的。', exact=True)).to_be_visible()
            assert calls[-1]['data']['text'] == 'Good tools reduce cognitive load and make reading intentional.'
            passed('Inline mode adds one meaning per occurrence; subsequent selection excludes injected translations')
            dismiss(article); count_before = len(calls); other = context.new_page(); other.goto(origin_b + '/second');expect(other.locator('#lead [data-shiyi-mark]')).to_have_count(1); assert len(calls) == count_before
            passed('A different newly visited host automatically reuses the glossary without any model call or per-site enabling')
            ui.goto(base + '/options.html#sites');ui.get_by_label('停用网站',exact=True).fill(origin_b+'/second');ui.get_by_role('button',name='加入黑名单',exact=True).click();expect(other.locator('#shiyi-extension-root')).to_have_count(0);expect(article.locator('#lead [data-shiyi-mark]')).to_have_count(1)
            other.reload();expect(other.locator('#shiyi-extension-root')).to_have_count(0)
            assert message(ui,'UI_STATE')['blacklist']==['localhost']
            ui.get_by_role('button',name='恢复 localhost',exact=True).click();expect(other.locator('#lead [data-shiyi-mark]')).to_have_count(1);assert len(calls)==count_before
            screenshot(ui,'website-blacklist.png');passed('Blacklist changes apply immediately, persist through reload, isolate other hosts, and restore in one click without model calls')
            other.locator('#lead [data-shiyi-mark]').hover(); expect(other.locator('#shiyi-extension-root').get_by_role('button', name='取消标记并从词库删除', exact=True)).to_be_visible()
            other.locator('#shiyi-extension-root').get_by_role('button', name='取消标记并从词库删除', exact=True).hover(); other.locator('#shiyi-extension-root').get_by_role('button', name='取消标记并从词库删除', exact=True).click()
            expect(article.locator('#lead [data-shiyi-mark]')).to_have_count(0); expect(other.locator('#lead [data-shiyi-mark]')).to_have_count(0)
            other.locator('#shiyi-extension-root').get_by_role('button', name='撤销', exact=True).click(); expect(article.locator('#lead [data-shiyi-mark]')).to_have_count(1); expect(other.locator('#lead [data-shiyi-mark]')).to_have_count(1)
            passed('Interactive hover card deletion synchronizes two real tabs, and undo restores both')
            dismiss(other); ui.goto(base + '/options.html#library'); ui.get_by_role('searchbox', name='搜索词句或释义').fill('好奇'); expect(ui.locator('tbody tr')).to_have_count(1); ui.locator('.word-link').click(); ui.get_by_label('已存释义', exact=True).fill('好奇心；想弄明白的愿望'); ui.get_by_role('button', name='保存释义', exact=True).click(); expect(article.locator('#lead [data-shiyi-meaning]')).to_contain_text('想弄明白')
            passed('Library search and manual editing update the live inline meaning')
            ui.get_by_role('searchbox', name='搜索词句或释义').fill(''); dismiss(article); translate(article, '#boundary', 'Art'); expect(article.locator('#boundary [data-shiyi-mark]')).to_have_count(1)
            assert article.locator('#boundary').inner_text().count('partial') == 1
            dismiss(article); translate(article, '#phrase', 'intentional'); expect(article.locator('#preserved [data-shiyi-mark]')).to_have_count(1)
            dismiss(article); before_click = article.evaluate('window.linkClicks||0'); article.locator('#preserved [data-shiyi-mark]').click(); assert article.evaluate('window.linkClicks') == before_click + 1
            for selector in ['#code', '#input', '#editor', '#hidden']: assert article.locator(selector + ' [data-shiyi-mark]').count() == 0
            passed('Whole-word boundaries, code/editor exclusions and pre-existing link handlers are preserved')
            dismiss(article); article.evaluate('document.getElementById("dynamic").append(Object.assign(document.createElement("p"),{textContent:"A new Curiosity can help."}))'); expect(article.locator('#dynamic [data-shiyi-mark]')).to_have_count(1); article.wait_for_timeout(400); expect(article.locator('#dynamic [data-shiyi-mark]')).to_have_count(1)
            passed('Dynamic content is annotated once without recursive observer loops')
            translate(article, '#more', 'maliciousword'); expect(article.locator('#shiyi-extension-root').get_by_text('<img src=x onerror="window.shiyiInjected=1">', exact=True)).to_be_visible(); assert not article.evaluate('!!window.shiyiInjected'); assert article.locator('#shiyi-extension-root img').count() == 0
            passed('Model output is displayed as literal text and cannot inject HTML')
            dismiss(article);select_text(article,'#more','menuword')
            rect=article.evaluate('()=>{const r=getSelection().getRangeAt(0).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}}')
            article.mouse.click(rect['x'],rect['y'],button='right');article.keyboard.press('Escape')
            article_id=ui.evaluate('(url)=>chrome.tabs.query({}).then(t=>t.find(t=>t.url===url).id)',article.url)
            native_menu(context,article_id,'selection',selectionText='menuword',editable=False)
            expect(article.locator('#shiyi-extension-root').get_by_text('本地接口验收释义：menuword',exact=True)).to_be_visible();assert calls[-1]['data']['text']=='menuword'
            passed('A real right-click selection snapshot is translated through the registered menu action, HTTP request and glossary path')
            dismiss(article);before=len(calls);article.locator('#input').focus();article.locator('#input').evaluate('node=>node.select()');article.locator('#input').click(button='right');article.keyboard.press('Escape')
            native_menu(context,article_id,'selection',selectionText='DO_NOT_SEND_EDITOR',editable=True);assert len(calls)==before
            passed('Right-menu translation ignores editable-field selections without sending their contents')
            dismiss(article);native_menu(context,article_id,'page');page_result=wait_page(ui,article_id);assert page_result['completed']==page_result['total'] and page_result['failed']==0,page_result
            assert article.locator('[data-shiyi-mark],[data-shiyi-meaning]').count()==0
            native_menu(context,article_id,'restore');expect(article.locator('[data-shiyi-block-translation]')).to_have_count(0);expect(article.locator('#lead [data-shiyi-mark]')).to_have_count(1)
            passed('Native page and restore menu actions enter block reading and return to the original glossary reading mode')
            before=len(calls);native_menu(context,article_id,'site');expect(article.locator('#shiyi-extension-root')).to_have_count(0)
            native_menu(context,article_id,'selection',selectionText='blocked-word',editable=False);native_menu(context,article_id,'page');assert len(calls)==before
            native_menu(context,article_id,'site');expect(article.locator('#lead [data-shiyi-mark]')).to_have_count(1)
            passed('The native site checkbox pauses and restores in one step; blocked sites cannot start either menu translation action')
            dismiss(article);control['mode']='slow';translate(article,'#more','blockword');expect(article.locator('#shiyi-extension-root').get_by_text('正在翻译…',exact=True)).to_be_visible()
            native_menu(context,article_id,'site');expect(article.locator('#shiyi-extension-root')).to_have_count(0);article.wait_for_timeout(2100)
            assert not any(entry['text']=='blockword' for entry in message(ui,'LIBRARY')['entries'])
            control['mode']='ok';native_menu(context,article_id,'site');expect(article.locator('#lead [data-shiyi-mark]')).to_have_count(1)
            passed('Blacklisting a website cancels an in-flight word request and its delayed result never reaches the glossary')
            dismiss(article);before=len(calls);before_entries=message(ui,'UI_STATE')['count']
            article.evaluate('''()=>{const root=document.getElementById('more'),walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let node;while(node=walker.nextNode()){const start=node.data.indexOf('automationword');if(start>=0){const range=document.createRange();range.setStart(node,start);range.setEnd(node,start+14);getSelection().removeAllRanges();getSelection().addRange(range);break;}}root.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));}''')
            article.wait_for_timeout(80)
            article.evaluate('''()=>{const shadow=document.getElementById('shiyi-extension-root').shadowRoot;const checkbox=shadow.querySelector('input[type=checkbox]');checkbox.checked=true;checkbox.dispatchEvent(new Event('change',{bubbles:true}));shadow.querySelector('.selection-main').click()}''')
            article.wait_for_timeout(150);assert len(calls)==before and message(ui,'UI_STATE')['count']==before_entries and not message(ui,'UI_STATE')['prefs']['includeContext']
            passed('Host-page scripts cannot trigger model requests or enable context sharing through synthetic clicks on the injected controls')
            dismiss(article); before_count = message(ui, 'UI_STATE')['count']; control['mode'] = '401'; translate(article, '#more', 'failureword'); expect(article.locator('#shiyi-extension-root').get_by_text('API Key 无效或已过期', exact=False)).to_be_visible(); expect(article.locator('#shiyi-extension-root').get_by_text('HTTP 401', exact=False)).to_be_visible(); assert message(ui, 'UI_STATE')['count'] == before_count
            assert 'fixture-key' not in article.locator('#shiyi-extension-root').inner_text()
            dismiss(article); control['mode'] = 'malformed'; translate(article, '#more', 'failureword'); expect(article.locator('#shiyi-extension-root').get_by_text('服务没有返回 Chat Completions JSON，请核对服务地址。', exact=True)).to_be_visible(); assert message(ui, 'UI_STATE')['count'] == before_count
            passed('Invalid credentials and malformed upstream responses do not create glossary entries or expose secrets')
            dismiss(article); control['mode'] = 'slow'; translate(article, '#more', 'cancelword'); expect(article.locator('#shiyi-extension-root').get_by_text('正在翻译…', exact=True)).to_be_visible(); article.locator('#shiyi-extension-root').get_by_role('button', name='取消', exact=True).click(); article.wait_for_timeout(2200); assert message(ui, 'UI_STATE')['count'] == before_count
            passed('Cancel stops an in-flight HTTP translation and prevents saving the delayed response')
            control['mode'] = 'ok'; dismiss(article)
            ui.goto(base + '/options.html#translation'); ui.locator('#custom-style').check(); ui.locator('#style-prompt').fill('面向软件工程师，用一句准确的话解释 {{text}}。'); ui.locator('#include-context').check(); ui.get_by_role('button', name='保存偏好', exact=True).click()
            translate(article, '#more', 'nuance'); expect(article.locator('#shiyi-extension-root').get_by_text('细微差别', exact=True)).to_be_visible(); assert 'context' in calls[-1]['data'] and '面向软件工程师' in calls[-1]['payload']['messages'][0]['content']
            passed('Custom style and opt-in bounded context reach the configured model service')
            dismiss(article); ui.goto(base + '/options.html#library')
            with ui.expect_download() as download_info: ui.get_by_role('button', name='导出词库', exact=True).click()
            payload = json.loads(Path(download_info.value.path()).read_text()); exported = json.dumps(payload, ensure_ascii=False)
            assert payload['format'] == 'shiyi-vocabulary' and len(payload['entries']) == message(ui, 'UI_STATE')['count']; assert 'fixture-key' not in exported and 'private-token' not in exported
            passed('Actual JSON download contains words and metadata but no API key or URL query tokens')
            screenshot(ui, 'word-library.png')
            # Verify storage access in the extension's isolated content world, not the page's JS world.
            article_id = ui.evaluate('(url)=>chrome.tabs.query({}).then(t=>t.find(t=>t.url===url).id)', article.url)
            denied = ui.evaluate('''async(tabId)=>{const [r]=await chrome.scripting.executeScript({target:{tabId},func:async()=>{try{await chrome.storage.local.get('config');return false}catch{return true}}});return r.result}''', article_id)
            assert denied and not article.evaluate('!!window.ShiyiText')
            passed('Untrusted content contexts cannot read extension config; page globals do not expose the matcher')
            dismiss(article); control['mode'] = 'slow'; translate(article, '#more', 'resurrection'); expect(article.locator('#shiyi-extension-root').get_by_text('正在翻译…', exact=True)).to_be_visible()
            ui.goto(base + '/options.html#data'); ui.get_by_role('button', name='清空本地词库', exact=True).click(); ui.get_by_role('button', name='清空 ' + str(before_count + 1) + ' 个词句', exact=True).click(); article.wait_for_timeout(2200)
            assert message(ui, 'UI_STATE')['count'] == 0
            ui.get_by_role('button', name='撤销', exact=True).click(); assert message(ui, 'UI_STATE')['count'] == before_count + 1
            assert not any(entry['text'] == 'resurrection' for entry in message(ui, 'LIBRARY')['entries'])
            passed('Clearing the library cancels in-flight work; undo restores prior entries without resurrecting pending text')
            control['mode'] = 'ok'
            other_id = ui.evaluate('(url)=>chrome.tabs.query({}).then(t=>t.find(t=>t.url===url).id)', other.url)
            popup = context.new_page(); popup.goto(base + '/popup.html?tab=' + str(other_id));popup.get_by_role('switch',name='在此网站启用点译',exact=True).click();expect(other.locator('#shiyi-extension-root')).to_have_count(0)
            other.reload(); expect(other.locator('[data-shiyi-mark]')).to_have_count(0); assert message(ui, 'UI_STATE')['blacklist'] == ['localhost']
            popup.get_by_role('button',name='恢复此网站',exact=True).click();expect(other.locator('#lead [data-shiyi-mark]')).to_have_count(1)
            passed('Popup site control persists a blacklist entry across reload and restores the website with one click')
            popup.close(); other.close(); dismiss(article)
            ui.goto(base + '/options.html#translation'); ui.locator('#target-language').select_option('ja'); ui.get_by_role('button', name='保存偏好', exact=True).click(); expect(article.locator('[data-shiyi-mark]')).to_have_count(0)
            ui.locator('#target-language').select_option('zh-CN'); ui.get_by_role('button', name='悬浮释义', exact=True).click(); ui.locator('[data-style="regular"]').click(); ui.locator('#include-context').uncheck(); ui.get_by_role('button', name='保存偏好', exact=True).click(); expect(article.locator('#lead [data-shiyi-mark]')).to_have_count(1)
            passed('Changing target language hides other-language records and does not overwrite existing translations')
            for width, height in [(1440, 1000), (1024, 900), (768, 1000), (375, 812)]:
                ui.set_viewport_size({'width': width, 'height': height})
                for route_name in ['library', 'translation', 'model', 'sites', 'data', 'help']:
                    ui.goto(base + '/options.html#' + route_name); expect(ui.locator('h1')).to_be_visible()
                    assert ui.evaluate('document.documentElement.scrollWidth<=innerWidth'), (width, route_name)
            passed('Every management page fits 1440, 1024, 768 and 375px without horizontal document overflow')
            ui.set_viewport_size({'width': 1440, 'height': 1160}); ui.goto(base + '/options.html#translation'); screenshot(ui, 'translation-preferences.png')
            article.set_viewport_size({'width': 1440, 'height': 1160}); article.evaluate('scrollTo(0,0)'); article.wait_for_timeout(100); article.locator('#lead [data-shiyi-mark]').focus(); expect(article.locator('#shiyi-extension-root').get_by_text('已存释义', exact=True)).to_be_visible(); article.keyboard.press('Enter'); article.keyboard.press('Escape'); expect(article.locator('#shiyi-extension-root .panel')).to_have_count(0)
            passed('Keyboard focus and Enter open a saved meaning; Escape closes it')
            article.locator('#lead [data-shiyi-mark]').hover(); article.wait_for_timeout(250); article.screenshot(path=str(OUT/'page-translation.png'),animations='disabled')
            popup=context.new_page(); popup.goto(base+'/popup.html?tab='+str(article_id)); expect(popup.locator('#site-switch')).to_have_attribute('aria-checked','true'); screenshot(popup,'toolbar-popup.png');popup.close()
            # Repeated decoration must restore original text boundaries, not accumulate splits.
            message(ui,'BLACKLIST_SET',site=origin_a,blocked=True);expect(article.locator('[data-shiyi-mark]')).to_have_count(0)
            assert article.locator('#phrase').inner_html()=='Good tools reduce cognitive <em>load</em> and make reading intentional.'
            assert article.locator('#lead').inner_text()=='Curiosity can turn an ordinary day into a moment of serendipity.'
            text_nodes=article.locator('#phrase').evaluate("el=>{const w=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let n=0;while(w.nextNode())n++;return n}")
            assert text_nodes==3,text_nodes
            message(ui,'BLACKLIST_SET',site=origin_a,blocked=False);expect(article.locator('#lead [data-shiyi-mark]')).to_have_count(1)
            passed('Pausing a site exactly restores original inline markup and source text nodes')
            # User-reported card regression, exercised through actual selection,
            # HTTP translation and stored hover UI rather than a rendered mockup.
            card_page=context.new_page();card_page.set_viewport_size({'width':820,'height':620});card_page.goto(origin_a+'/tooltip')
            api_text='Build with the OpenAI API in ChatGPT and Codex'
            api_translation='在 ChatGPT 和 Codex 中使用 OpenAI API 进行开发'
            translate(card_page,'#api-title',api_text)
            card=card_page.locator('#shiyi-extension-root .card');expect(card.locator('.meaning')).to_have_text(api_translation)
            dismiss(card_page);card_page.locator('#api-title [data-shiyi-mark]').hover();expect(card).to_be_visible()
            metrics=card.evaluate("""node=>{const meaning=node.querySelector('.meaning'),source=node.querySelector('.source-text');return {translation_font_px:parseFloat(getComputedStyle(meaning).fontSize),source_font_px:parseFloat(getComputedStyle(source).fontSize),translation_first:meaning.getBoundingClientRect().top<source.getBoundingClientRect().top,source_complete:source.textContent,width:node.offsetWidth,height:node.offsetHeight,actions:[...node.querySelectorAll('button')].map(b=>b.textContent)}}""")
            assert metrics['translation_first'] and metrics['translation_font_px']>metrics['source_font_px'] and metrics['source_complete']==api_text,metrics
            assert metrics['actions']==['编辑','删除'],metrics
            card_page.mouse.move(5,5);card_page.locator('#api-title [data-shiyi-mark]').hover();card_page.wait_for_timeout(80)
            card.screenshot(path=str(OUT/'tooltip-card.png'),animations='disabled',caret='initial')
            card_page.screenshot(path=str(OUT/'tooltip-in-page.png'),animations='disabled',caret='initial')
            for width in [375,240]:
                dismiss(card_page);card_page.set_viewport_size({'width':width,'height':812});card_page.locator('#api-title [data-shiyi-mark]').hover();expect(card).to_be_visible()
                assert card.evaluate('node=>{const r=node.getBoundingClientRect();return r.left>=11&&r.right<=innerWidth-11&&node.scrollWidth<=node.clientWidth}'),width
            saved_api=next(entry for entry in message(ui,'LIBRARY')['entries'] if entry['text']==api_text)
            long_translation='完整释义应当自然换行，阅读时可以在卡片内滚动查看，不截断译文。'*30
            message(ui,'EDIT_ENTRY',id=saved_api['id'],translation=long_translation)
            # Esc now retains the same source mark and returns focus to it.
            # Activate it with Enter rather than assuming DOM replacement blur.
            dismiss(card_page);card_page.locator('#api-title [data-shiyi-mark]').press('Enter');expect(card.locator('.meaning')).to_have_text(long_translation)
            assert card.evaluate('node=>node.scrollHeight>node.clientHeight&&node.scrollWidth<=node.clientWidth')
            card_page.keyboard.press('Escape');expect(card).to_have_count(0)
            message(ui,'EDIT_ENTRY',id=saved_api['id'],translation=api_translation);card_page.close()
            report['tooltip']=metrics
            passed('Saved card prioritizes the complete translation, retains a smaller source and concise actions, fits narrow windows, and scrolls long meanings without truncation',metrics)
            # Seed test-only vocabulary directly into the real extension database.
            await_seed=ui.evaluate("""()=>new Promise((resolve,reject)=>{const open=indexedDB.open('shiyi-vocabulary');open.onsuccess=()=>{const db=open.result,tx=db.transaction('entries','readwrite'),s=tx.objectStore('entries');for(let i=0;i<10000;i++)s.put({id:'perf-'+i,identity:'zh-CN\\u001f'+'term'+i,text:'term'+i,translation:'测试释义 '+i,kind:'word',sourceLanguage:'en',targetLanguage:'zh-CN',style:'regular',modelName:'Local fixture',source:{domain:'127.0.0.1',url:'',title:'Performance fixture'},context:'',createdAt:1,updatedAt:1});tx.oncomplete=()=>{db.close();resolve(true)};tx.onerror=()=>reject(tx.error)}})""")
            assert await_seed
            perf=context.new_page();perf.goto(origin_a+'/performance');expect(perf.locator('[data-shiyi-mark]')).to_have_count(800,timeout=20000);perf.wait_for_timeout(300)
            tasks=perf.evaluate('longTasks');body_chars=perf.evaluate("document.body.innerText.length");assert body_chars>=20000
            report['performance']={'vocabulary_entries':10000,'article_characters':body_chars,'marked_occurrences':800,'long_tasks_ms':[round(t['duration'],2) for t in tasks]}
            assert not tasks,tasks
            passed('Ten-thousand-entry vocabulary marks a twenty-thousand-character page without >50ms page long tasks',report['performance'])
            perf.evaluate("""()=>{window.meaningLatencies=[];let lastEvent=0;document.addEventListener('mouseover',e=>{if(e.target.closest('[data-shiyi-mark]'))lastEvent=e.timeStamp},true);new MutationObserver(records=>{if(records.some(r=>[...r.addedNodes].some(n=>n.classList?.contains('card'))))requestAnimationFrame(()=>meaningLatencies.push(performance.now()-lastEvent))}).observe(document.getElementById('shiyi-extension-root').shadowRoot,{childList:true});}""")
            for i in range(20):
                perf.mouse.move(4,4);perf.locator('[data-shiyi-mark]').nth(i%2).hover();perf.wait_for_timeout(40)
            latencies=sorted(perf.evaluate('meaningLatencies'));assert len(latencies)>=18,len(latencies);p95=latencies[min(len(latencies)-1,int(len(latencies)*.95))];assert p95<=150,p95
            report['performance']['tooltip_p95_ms']=round(p95,2);passed('Local meaning reaches the next animation frame within 150ms P95',{'samples':len(latencies),'p95_ms':round(p95,2)});perf.close()
            # Long-term credentials require explicit opt-in and remain excluded from exports.
            ui.goto(base+'/options.html#model');ui.get_by_label('API Key',exact=True).fill('remembered-fixture-key');ui.locator('#remember-key').check();ui.get_by_role('button',name='连接并保存',exact=True).click();expect(ui.locator('#notice')).to_contain_text('模型连接已保存')
            assert ui.evaluate('()=>chrome.storage.local.get("credential").then(x=>!!x.credential)') and not ui.evaluate('()=>chrome.storage.session.get("credential").then(x=>!!x.credential)')
            assert 'remembered-fixture-key' not in json.dumps(message(ui,'EXPORT'));passed('Explicit remember-key opt-in uses local storage while exports still exclude credentials')
            message(ui,'BLACKLIST_SET',site='paused-on-restart.example',blocked=True)
            count_with_performance = message(ui,'UI_STATE')['count'];context.close();context=launch(p,temp/'functional-profile',fixture);ext=extension_id(context);ui=context.new_page();ui.goto(f'chrome-extension://{ext}/options.html#model');expect(ui.get_by_label('服务地址',exact=True)).to_be_visible();assert message(ui,'UI_STATE')['profile']['hasKey']
            passed('Explicitly remembered credential survives browser restart')
            ui.get_by_role('button',name='数据与隐私',exact=True).count()
            ui.goto(f'chrome-extension://{ext}/options.html#model');ui.get_by_label('API Key',exact=True).fill('fixture-key');ui.locator('#remember-key').uncheck();ui.get_by_role('button',name='连接并保存',exact=True).click();expect(ui.locator('#notice')).to_contain_text('模型连接已保存')
            expected_count = message(ui, 'UI_STATE')['count']; context.close(); context = launch(p, temp / 'functional-profile', fixture); ext = extension_id(context); ui = context.new_page();ui.goto(f'chrome-extension://{ext}/options.html#model'); expect(ui.get_by_label('服务地址',exact=True)).to_be_visible(); restarted = message(ui,'UI_STATE')
            assert restarted['count']==expected_count and not restarted['profile']['hasKey'] and restarted['profile']['endpoint']; assert restarted['blacklist']==['paused-on-restart.example'] and restarted['sitePolicy']=='blacklist'
            passed('Browser restart preserves the glossary, connection and default-on blacklist policy while clearing default session credentials')
            assert report['page_errors'] == [], report['page_errors']
            passed('No uncaught JavaScript errors during extension UI and content interactions')
            report['result']='pass';report['http_fixture_requests']=len(calls); context.close();context=None
        except Exception:
            if context:
                for i, pg in enumerate(context.pages):
                    try:
                        pg.screenshot(path=str(OUT/f"failure-{i}.png"),full_page=True)
                        (OUT/f"failure-{i}.html").write_text(pg.content())
                    except Exception: pass
            raise
except Exception as error:
    report['result']='fail';report['failure']=str(error)
    if context:
        for index,page in enumerate(context.pages):
            try: page.screenshot(path=str(OUT/f'failure-{index}.png'),full_page=True)
            except Exception: pass
    raise
finally:
    if context:
        try: context.close()
        except Exception: pass
    for server in servers: server.shutdown();server.server_close()
    (OUT/'extension-e2e.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    print(json.dumps({'result':report['result'],'passed':len(report['checks']),'failure':report.get('failure')},ensure_ascii=False),flush=True)
