"""Real MV3 acceptance for the companion, page snapshots and v1 data migration.

Only temporary browser profiles and deterministic loopback model responses are
used. The archived v0.5.1 package is read, never edited.
"""
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread, Lock
from playwright.sync_api import sync_playwright, expect
import json, os, shutil, tempfile, time, zipfile

ROOT = Path(__file__).resolve().parents[1]
VERSION = json.loads((ROOT/'package.json').read_text())['version']
OUT = ROOT/'verification'
report = {'version': VERSION, 'checks': [], 'errors': [], 'result': 'running', 'scope': 'Isolated real Chromium extension with local HTTP model; includes upgrade from the immutable 0.5.1 ZIP.'}
control = {'version': 1, 'delay': 0, 'changed': False}
calls, lock = [], Lock()
SOURCE = 'Read a little, understand a little more.'
PAGE = '''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>A quieter page</title><style>
*{box-sizing:border-box}body{margin:0;background:#fafbf8;color:#313e38;font:18px/1.8 Georgia,serif}main{max-width:760px;margin:50px auto;padding:34px 40px;background:white;border:1px solid #e4e9df;border-radius:12px}h1{font:36px/1.35 Georgia,serif;font-weight:400;margin:0 0 28px}p{margin:20px 0}a{color:#116b60}label,input{font:14px/1.7 system-ui}input{display:block;width:100%;padding:8px;border:1px solid #d7dfd3}code{font:14px monospace}footer{font:12px system-ui;color:#758376;margin-top:35px}@media(max-width:500px){body{font-size:16px}main{margin:10px;padding:20px}h1{font-size:28px}}</style></head><body><main><h1>A quieter way to read.</h1><p id="lead">Read a little, understand a little more.</p><p id="stable">Keep both languages close, and let each paragraph keep its place.</p><p id="linked">Follow <a href="/guide?private=PRIVATE_LINK_TOKEN">the reading guide</a> for details.</p><p id="locked">Keep <code>PRIVATE_INLINE_CODE</code> unchanged.</p><label>Your note<input value="PRIVATE_FORM_VALUE"></label><div contenteditable>PRIVATE_EDITOR_VALUE</div><footer>Make room for the words that matter.</footer></main></body></html>'''

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def do_GET(self):
        page = PAGE
        if control['changed']:
            page = page.replace(SOURCE, 'This paragraph was updated by the website.').replace('/guide?private=PRIVATE_LINK_TOKEN', '/different-guide?private=PRIVATE_LINK_TOKEN')
        self.send_response(200); self.send_header('Content-Type', 'text/html;charset=utf-8'); self.end_headers(); self.wfile.write(page.encode())
    def do_POST(self):
        payload = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        data = json.loads(payload['messages'][-1]['content'])
        with lock:
            version, delay = control['version'], control['delay']
            calls.append({'data': data, 'version': version, 'cookie': self.headers.get('Cookie')})
        time.sleep(delay)
        def result(parts):
            return {'parts': [{'id': part['id'], 'text': part['text'] if not part['text'].strip() or part['text'].startswith('⟦SHIYI_') else '译'+str(version)+'：'+part['text']} for part in reversed(parts)]}
        output = {'blocks': [{'id': block['id'], **result(block['parts'])} for block in reversed(data['blocks'])]} if data.get('task') == 'blocks' else result(data['parts'])
        try:
            self.send_response(200); self.send_header('Content-Type', 'application/json'); self.end_headers()
            self.wfile.write(json.dumps({'choices': [{'message': {'content': json.dumps(output, ensure_ascii=False)}}]}).encode())
        except (BrokenPipeError, ConnectionResetError): pass

def binary():
    if os.environ.get('SHIYI_TEST_CHROMIUM'): return os.environ['SHIYI_TEST_CHROMIUM']
    for folder in sorted((Path.home()/'Library/Caches/ms-playwright').glob('chromium-*'), key=lambda p: int(p.name.split('-')[-1]), reverse=True):
        path = folder/'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
        if path.exists(): return str(path)
def message(ui, kind, **payload):
    result = ui.evaluate('data=>chrome.runtime.sendMessage(data)', {'type': 'SHIYI/'+kind, **payload})
    assert result and result.get('ok'), result
    return result['data']
def state(ui, tab): return message(ui, 'UI_STATE', tabId=tab)['tab']['page']
def command(ui, tab, action, mode=None): return message(ui, 'PAGE_COMMAND', tabId=tab, action=action, **({'mode': mode} if mode else {}))
def wait_state(ui, tab, predicate, timeout=20):
    deadline = time.monotonic()+timeout; value = None
    while time.monotonic() < deadline:
        value = state(ui, tab)
        if value and predicate(value): return value
        ui.wait_for_timeout(50)
    raise AssertionError({'state_timeout': value})
def complete(ui, tab): return wait_state(ui, tab, lambda s: s['active'] and not s['running'] and s['completed'] > 0 and s['phase'] == 'complete')
def passed(name, **detail):
    report['checks'].append({'name': name, 'result': 'pass', **detail}); print('PASS:', name, flush=True)
def database(ui, name):
    return ui.evaluate('''name=>new Promise((resolve,reject)=>{const r=indexedDB.open('shiyi-vocabulary');r.onsuccess=()=>{const db=r.result,tx=db.transaction(name),q=tx.objectStore(name).getAll();q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);tx.oncomplete=()=>db.close()};r.onerror=()=>reject(r.error)})''', name)
def open_menu(page):
    if not page.locator('#shiyi-extension-root [data-pet-toggle]').is_visible(): command(ui, tab, 'show-companion')
    toggle = page.locator('#shiyi-extension-root').get_by_role('button', name='点译小猫，展开功能', exact=True)
    if toggle.count(): toggle.click()
    return page.locator('#shiyi-extension-root').get_by_role('region', name='点译阅读控制', exact=True)
def styles(page):
    return page.evaluate('''()=>{const a=getComputedStyle(document.getElementById('lead')),node=document.querySelector('#lead + [data-shiyi-block-translation]'),b=getComputedStyle(node);return {source:parseFloat(a.fontSize),translation:parseFloat(b.fontSize),background:b.backgroundColor,border:parseFloat(b.borderInlineStartWidth),sourceColor:a.color,translationColor:b.color}}''')

server = ThreadingHTTPServer(('127.0.0.1', 0), Handler); Thread(target=server.serve_forever, daemon=True).start()
origin = 'http://127.0.0.1:'+str(server.server_port)
profile = {'provider': 'custom', 'name': 'Page memory fixture', 'endpoint': origin+'/v1/chat/completions', 'model': 'memory-fixture', 'auth': 'bearer', 'timeoutSeconds': 5, 'rememberKey': True}
try:
    with tempfile.TemporaryDirectory(prefix='dianyi-memory-') as temp, sync_playwright() as playwright:
        temp = Path(temp); extension = temp/'extension'; extension.mkdir()
        with zipfile.ZipFile(ROOT/'releases/shiyi-chrome-edge-0.5.1.zip') as archive: archive.extractall(extension)
        def launch():
            return playwright.chromium.launch_persistent_context(str(temp/'profile'), executable_path=binary(), headless=True, ignore_default_args=['--disable-extensions'], args=['--disable-extensions-except='+str(extension), '--load-extension='+str(extension)], viewport={'width':1100, 'height':880})
        context = launch()
        worker = context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker', timeout=15000)
        original_id = worker.url.split('/')[2]; base = 'chrome-extension://'+original_id
        ui = context.new_page(); ui.goto(base+'/options.html#model'); expect(ui.locator('h1')).to_be_visible()
        message(ui, 'SAVE_PROFILE', profile=profile, apiKey='fixture-memory-key')
        prefs = message(ui, 'UI_STATE')['prefs']; prefs['batchSize'] = 32; prefs['translationColorLight'] = '#275e75'
        message(ui, 'SAVE_PREFS', prefs=prefs)
        ui.evaluate('''async()=>{const {entryIdentity}=await import('./lib/core.js');await new Promise((resolve,reject)=>{const r=indexedDB.open('shiyi-vocabulary');r.onsuccess=()=>{const db=r.result;if(db.version!==1)return reject(new Error('Expected v1'));const tx=db.transaction('entries','readwrite');tx.objectStore('entries').put({id:'migration-word',identity:entryIdentity('migration','zh-CN'),text:'migration',translation:'迁移',targetLanguage:'zh-CN',kind:'word',style:'normal',createdAt:1,updatedAt:1,source:{url:'https://fixture.test',domain:'fixture.test',title:'fixture'}});tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>reject(tx.error)};r.onerror=()=>reject(r.error)})}''')
        old_storage = ui.evaluate('async()=>chrome.storage.local.get(["config","credential"])')
        context.close(); shutil.rmtree(extension); shutil.copytree(ROOT/'releases'/('dianyi-'+VERSION), extension)
        context = launch()
        try:
            worker = context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker', timeout=15000)
            assert worker.url.split('/')[2] == original_id
            # Use the browser's unpacked-extension Reload button. Merely
            # restarting Chrome can retain the old module cache for this path.
            manager = context.new_page(); manager.goto('chrome://extensions')
            toggle = manager.locator('extensions-toolbar #devMode')
            if toggle.get_attribute('aria-pressed') != 'true': toggle.click()
            manager.locator('extensions-item#'+original_id).locator('#dev-reload-button').click()
            manager.wait_for_timeout(250)
            ui = context.new_page(); ui.goto(base+'/options.html#model'); expect(ui.locator('h1')).to_be_visible()
            value = message(ui, 'UI_STATE'); current_storage = ui.evaluate('async()=>chrome.storage.local.get(["config","credential"])')
            assert current_storage == old_storage and value['prefs']['batchSize'] == 32
            assert message(ui, 'LIBRARY')['entries'][0]['translation'] == '迁移'
            manifest = ui.evaluate('()=>chrome.runtime.getManifest()')
            assert manifest['name'] == '点译 · 划词与整页翻译' and manifest['version'] == VERSION, manifest
            db_version = ui.evaluate('()=>new Promise(resolve=>{const r=indexedDB.open("shiyi-vocabulary");r.onsuccess=()=>{resolve(r.result.version);r.result.close()}})')
            assert db_version == 2, {'database_version': db_version, 'state_fields': list(value)}
            passed('Archived v0.5.1 upgrades in the same install path and profile: extension ID, glossary, model, preferences and credential remain intact; database migrates from v1 to v2')

            page = context.new_page(); page.on('pageerror', lambda error: report['errors'].append(str(error)))
            url = origin+'/article?view=one&token=PRIVATE_URL_TOKEN#reading'
            page.goto(url); expect(page.locator('#shiyi-extension-root')).to_be_attached()
            tab = ui.evaluate('async url=>(await chrome.tabs.query({})).find(t=>t.url===url).id', url)
            root = page.locator('#shiyi-extension-root'); toggle = root.locator('[data-pet-toggle]')
            expect(toggle).to_have_count(0); command(ui, tab, 'show-companion'); expect(toggle).to_be_visible()
            expect(toggle).to_have_attribute('aria-expanded', 'false'); assert not calls
            assert root.locator('.cat-float').evaluate('n=>getComputedStyle(n).animationName') == 'cat-breathe'
            page.emulate_media(reduced_motion='reduce'); assert root.locator('.cat-float').evaluate('n=>getComputedStyle(n).animationName') == 'none'
            page.emulate_media(reduced_motion='no-preference')
            menu = open_menu(page); expect(menu.get_by_role('button', name='翻译当前页面', exact=True)).to_be_visible()
            menu.get_by_role('button', name='翻译当前页面', exact=True).evaluate('button=>button.click()'); page.wait_for_timeout(200); assert not calls
            page.keyboard.press('Escape'); expect(toggle).to_have_attribute('aria-expanded', 'false')
            passed('Animated cat stays hidden until explicitly shown, opens functions on a real click, supports Escape and reduced motion, and synthetic clicks cannot trigger model calls')
            page.screenshot(path=str(OUT/'dianyi-pet-idle.png'), animations='disabled', caret='initial')
            menu = open_menu(page); menu.get_by_role('button', name='翻译当前页面', exact=True).click(); result = complete(ui, tab)
            assert result['failed'] == 0 and result['cached'] >= result['completed'], result
            style = styles(page); assert style['source']-style['translation'] == 2 and style['background'] == 'rgba(0, 0, 0, 0)' and style['border'] == 0 and style['sourceColor'] != style['translationColor'], style
            original_size = style['source']; before = len(calls)
            command(ui, tab, 'mode', 'translation'); expect(page.locator('[data-shiyi-block-translation]')).to_have_count(0)
            assert page.locator('#lead').evaluate('n=>parseFloat(getComputedStyle(n).fontSize)') == original_size
            assert page.locator('#lead').inner_text().startswith('译1：')
            command(ui, tab, 'mode', 'bilingual'); assert len(calls) == before and styles(page)['source']-styles(page)['translation'] == 2
            page.set_viewport_size({'width':390, 'height':844}); page.wait_for_timeout(150); assert styles(page)['source'] == 16 and styles(page)['translation'] == 14
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
            page.set_viewport_size({'width':1100, 'height':880}); page.wait_for_timeout(150)
            passed('Translations use configured text color only: no background or border; bilingual is exactly 2px smaller at desktop/mobile sizes and translation-only keeps source size without another request', styles=style)
            panel = open_menu(page); page.screenshot(path=str(OUT/'dianyi-pet-menu.png'), animations='disabled', caret='initial')
            box = panel.bounding_box()
            page.screenshot(path=str(OUT/'dianyi-companion-preview.png'), clip={'x':box['x']-10,'y':box['y']-10,'width':box['width']+20,'height':880-box['y']}, animations='disabled', caret='initial')
            page.keyboard.press('Escape')
            page.locator('#stable').screenshot(path=str(OUT/'dianyi-source-block.png'), animations='disabled', caret='initial')
            lead = page.locator('#lead').bounding_box(); translated = page.locator('#stable + [data-shiyi-block-translation]').bounding_box()
            page.screenshot(path=str(OUT/'dianyi-text-only-reading.png'), clip={'x':lead['x']-10,'y':lead['y']-8,'width':lead['width']+20,'height':translated['y']+translated['height']-lead['y']+16}, animations='disabled', caret='initial')
            rows = database(ui, 'pages'); data = json.dumps(rows, ensure_ascii=False)
            for secret in ['PRIVATE_URL_TOKEN', 'PRIVATE_LINK_TOKEN', 'PRIVATE_INLINE_CODE', 'PRIVATE_FORM_VALUE', 'PRIVATE_EDITOR_VALUE', 'fixture-memory-key']: assert secret not in data, secret
            for secret in ['PRIVATE_URL_TOKEN', 'PRIVATE_LINK_TOKEN', 'PRIVATE_INLINE_CODE', 'PRIVATE_FORM_VALUE', 'PRIVATE_EDITOR_VALUE']: assert secret not in json.dumps(calls), secret
            assert all(call['cookie'] is None for call in calls)
            passed('Page snapshots store exact structured mappings with opaque URL/link fingerprints and inline-code placeholders; forms, editors and credentials are excluded')

            before = len(calls); message(ui, 'CLEAR_KEY'); page.reload(); restored = complete(ui, tab)
            assert restored['restored'] == result['completed'] and len(calls) == before and not restored['running'], restored
            expect(page.locator('#lead + [data-shiyi-block-translation]')).to_contain_text('译1：')
            passed('Refresh restores the page and bilingual mode entirely from local mappings, including with the API key removed, without any HTTP model calls')
            message(ui, 'SAVE_PROFILE', profile=profile, apiKey='fixture-memory-key')
            control['changed'] = True; page.reload(); changed = complete(ui, tab)
            assert changed['restored'] < restored['restored'] and len(calls) == before
            expect(page.locator('#lead + [data-shiyi-block-translation]')).to_have_count(0); expect(page.locator('#linked + [data-shiyi-block-translation]')).to_have_count(0)
            expect(page.locator('#stable + [data-shiyi-block-translation]')).to_contain_text('译1：')
            passed('Changed source text or link destinations retain their original text, while unchanged blocks restore; refreshing new content never triggers an automatic request')
            control['version'] = 2
            open_menu(page).get_by_role('button', name='重新翻译', exact=True).click(); refreshed = complete(ui, tab)
            assert len(calls) > before and refreshed['failed'] == 0
            assert page.locator('[data-shiyi-block-translation]').evaluate_all('nodes=>nodes.every(n=>n.textContent.includes("译2："))')
            before = len(calls); page.reload(); refreshed = complete(ui, tab); assert len(calls) == before
            expect(page.locator('#stable + [data-shiyi-block-translation]')).to_contain_text('译2：')
            passed('Retranslate bypasses both block and page caches, updates all blocks by stable IDs even when responses are reversed, and refresh reloads only the newer results')

            command(ui, tab, 'mode', 'translation'); page.wait_for_timeout(100); page.reload(); only = complete(ui, tab)
            assert only['mode'] == 'translation' and len(calls) == before
            assert page.locator('#lead').evaluate('n=>parseFloat(getComputedStyle(n).fontSize)') == 18
            expect(page.locator('[data-shiyi-block-translation]')).to_have_count(0)
            command(ui, tab, 'restore'); page.reload(); expect(root).to_be_attached(); expect(root.locator('[data-pet-toggle]')).to_have_count(0); page.wait_for_timeout(500)
            assert not state(ui, tab)['active'] and len(calls) == before
            open_menu(page).get_by_role('button', name='加载本地译文', exact=True).click(); complete(ui, tab); assert len(calls) == before
            passed('Translation-only mode persists with source font size; restoring original persists across reload, and explicit Load local restores without a model request')

            page.evaluate('history.pushState({},"","/article?view=two#reading")'); wait_state(ui, tab, lambda s: not s['active'])
            expect(page.locator('[data-shiyi-block-translation]')).to_have_count(0); assert not page.locator('#lead').inner_text().startswith('译')
            page.wait_for_timeout(250); assert len(calls) == before
            page.evaluate('history.back()'); again = complete(ui, tab); assert again['mode'] == 'translation' and len(calls) == before
            passed('SPA navigation isolates page mappings by complete URL including query/hash; leaving restores source, returning loads its own saved mode without network')

            # A slow obsolete job is superseded by a fresh snapshot revision.
            control['version'] = 3; control['delay'] = 1.0
            command(ui, tab, 'retranslate', 'bilingual'); wait_state(ui, tab, lambda s: s['running'])
            deadline = time.monotonic()+5
            while not any(call['version'] == 3 for call in calls) and time.monotonic() < deadline: page.wait_for_timeout(30)
            control['version'] = 4; control['delay'] = 0
            command(ui, tab, 'retranslate', 'bilingual'); newest = complete(ui, tab); page.wait_for_timeout(1400)
            before = len(calls); page.reload(); complete(ui, tab); assert len(calls) == before
            assert page.locator('[data-shiyi-block-translation]').evaluate_all('nodes=>nodes.every(n=>n.textContent.includes("译4："))')
            passed('Delayed responses from a canceled retranslation cannot repaint or overwrite the latest page snapshot; refresh retains the newest revision')

            message(ui, 'CLEAR_PAGE_CACHE'); assert message(ui, 'UI_STATE')['pageCache']['count'] == 0
            assert message(ui, 'LIBRARY')['entries'][0]['id'] == 'migration-word'
            page.reload(); expect(root).to_be_attached(); expect(root.locator('[data-pet-toggle]')).to_have_count(0); page.wait_for_timeout(400)
            assert not state(ui, tab)['active'] and len(calls) == before
            passed('Clear page snapshots removes refresh restoration and preserves the vocabulary and model configuration')

            command(ui, tab, 'translate', 'bilingual'); full = complete(ui, tab); assert full['completed'] > 2
            command(ui, tab, 'restore')
            page.evaluate('''()=>{const range=document.createRange();range.setStartBefore(document.getElementById('lead'));range.setEndAfter(document.getElementById('stable'));getSelection().removeAllRanges();getSelection().addRange(range);document.getElementById('lead').dispatchEvent(new PointerEvent('pointerup',{bubbles:true,button:0}))}''')
            root.get_by_role('button', name='按段翻译为中文', exact=True).click(); selection = complete(ui, tab)
            assert selection['scope'] == 'selection' and selection['completed'] == 2, selection
            before = len(calls); page.reload(); selection = complete(ui, tab)
            assert selection['scope'] == 'selection' and selection['restored'] == 2 and len(calls) == before
            expect(page.locator('h1 + [data-shiyi-block-translation]')).to_have_count(0)
            passed('Selected-paragraph snapshots restore only the selected owners after refresh even with older full-page mappings, leaving the rest unchanged without model calls')

            prefs = message(ui, 'UI_STATE')['prefs']; prefs['targetLanguage'] = 'ja'; message(ui, 'SAVE_PREFS', prefs=prefs)
            wait_state(ui, tab, lambda s: not s['active']); page.wait_for_timeout(150); assert len(calls) == before
            prefs['targetLanguage'] = 'zh-CN'; message(ui, 'SAVE_PREFS', prefs=prefs); original = complete(ui, tab)
            assert original['restored'] == 2 and len(calls) == before
            passed('Changing target language isolates page snapshots; returning to the saved language restores its matching snapshot without a request')
            assert not report['errors'], report['errors']; report['requests'] = len(calls); report['result'] = 'pass'
        finally: context.close()
except Exception as error:
    report['result'] = 'fail'; report['failure'] = str(error); raise
finally:
    server.shutdown(); server.server_close()
    (OUT/'page-memory-e2e.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
    print(json.dumps({'result': report['result'], 'checks': len(report['checks']), 'failure': report.get('failure')}, ensure_ascii=False), flush=True)
