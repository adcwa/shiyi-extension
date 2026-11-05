"""General local tag mapping, including real upgrade from the immutable 0.8 ZIP.

Text-only local model responses are deliberately reversed and include adversarial
HTML. No real account, API key, cloud database or runtime debug option is used.
"""
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from playwright.sync_api import sync_playwright, expect
import json, shutil, tempfile, time, zipfile, subprocess, sys

ROOT = Path(__file__).resolve().parents[1]
VERSION = json.loads((ROOT / 'package.json').read_text())['version']
OUT = ROOT / 'verification'
HTML = '''<!doctype html><html lang="en"><meta charset="utf-8"><title>通用行内标签对照翻译</title><style>
body{background:#fafbf8;color:#253d34;font:18px/1.8 system-ui;margin:30px}main{max-width:920px;margin:auto;background:white;padding:28px;border:1px solid #dce5d9;border-radius:12px}h1{font-size:25px}p{margin:22px 0}a{color:#0969da;text-decoration:underline}code,kbd,samp,tt{font:14px/1.6 monospace;background:#f2f5ed}nav{display:flex;gap:20px}button{font:16px system-ui}#styled{font-weight:650;font-style:italic} @media(max-width:600px){body{font-size:16px;margin:12px}main{padding:18px}#hidden-break{display:inline!important}}
</style><main><h1>Read with the original structure.</h1>
<p id="basic">Read <a id="guide" href="/guide?private=LINK_PRIVATE_TOKEN" target="_self"><strong>the <em>nested guide</em></strong></a> with <b id="bold">bold text</b>, <i>italic text</i>, <code id="code"><span>CODE_PRIVATE_TOKEN</span></code> and <font id="font" face="monospace" size="5" color="#e01010"><b>font text</b></font>.</p>
<p id="url">Full docs live at <a id="docs" href="/docs">impeccable.style/docs</a>.</p>
<p id="formats"><strong>strong</strong> <em>emphasis</em> <u>underline</u> <s>strike</s> <del>deleted</del> <ins>inserted</ins> <small>small</small> <big>big</big> A<sub>subscript</sub>B<sup>superscript</sup> <abbr title="Abbreviation title">API</abbr> <q>quotation</q> <cite>citation</cite> <dfn>definition</dfn> <time datetime="2026-11-03">today</time> <bdo dir="rtl">direction</bdo> <span id="styled">styled span</span> <bold>legacy bold</bold> <blod>legacy typo bold</blod>.</p>
<p id="breaks">
  first line<br>second line<span><br>third line</span><br id="hidden-break" style="display:none"><wbr>fourth line
</p>
<p id="protected">Press <kbd>KBD_PRIVATE_TOKEN</kbd>, inspect <samp>SAMP_PRIVATE_TOKEN</samp>, use <var>VAR_PRIVATE_TOKEN</var> and <tt>TT_PRIVATE_TOKEN</tt> now.</p>
<p id="mixed">这段中文只保留一次。<br> <b>Foreign fragment</b> <em>中文强调也不重复。</em></p>
<p id="actions">Use <a id="router" href="#route">router link</a> or <a id="newtab" href="/landing" target="_blank">new tab</a>, <a href="#destination">jump</a>, <a href="mailto:reader@example.test">mail</a>, <a href="tel:10086">phone</a>.</p>
<p id="unsafe">Keep <a href="javascript:window.unsafeExecuted=1">unsafe link</a> and <font onmouseover="window.sourceHoverEvents=(window.sourceHoverEvents||0)+1" title="MAPPING_PRIVATE_ATTRIBUTE">safe text</font>. maliciousword</p>
<nav><a id="navlink" href="/navigation"><strong>Guide label</strong></a></nav><button id="control"><strong>Save label</strong></button><p id="destination">End of document.</p>
</main><script>
window.originalHTML=document.querySelector('main').innerHTML;window.originalGuide=document.getElementById('guide');window.originalText=document.getElementById('basic').firstChild;window.originalButton=document.getElementById('control');
originalGuide.addEventListener('click',e=>{e.preventDefault();window.guideClicks=(window.guideClicks||0)+1});document.getElementById('router').addEventListener('click',e=>{e.preventDefault();window.routerClicks=(window.routerClicks||0)+1});originalButton.addEventListener('click',()=>window.buttonClicks=(window.buttonClicks||0)+1);
document.addEventListener('contextmenu',e=>{window.menuHref=e.target.closest('a')?.href;e.preventDefault()});
</script></html>'''
calls = []


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Type', 'text/html;charset=utf-8')
        self.end_headers()
        self.wfile.write((HTML if self.path.startswith('/article') else '<!doctype html><title>Link destination</title><p>Opened the original destination.</p>').encode())

    def do_POST(self):
        request = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        data = json.loads(request['messages'][-1]['content'])
        calls.append(data)
        def translate(parts):
            values = []
            for part in reversed(parts):
                text = part['text']
                if not text.strip() or text.startswith('⟦SHIYI_'):
                    translated = text
                elif text == 'impeccable.style/docs':
                    translated = 'wrong.example/translated'
                elif 'maliciousword' in text:
                    translated = '<img src=x onerror="window.modelExecuted=1">'
                else:
                    translated = '译：' + text.strip()
                values.append({'id': part['id'], 'text': translated})
            return {'parts': values}
        output = {'blocks': [{'id': block['id'], **translate(block['parts'])} for block in reversed(data['blocks'])]} if data.get('task') == 'blocks' else translate(data['parts'])
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps({'choices': [{'message': {'content': json.dumps(output, ensure_ascii=False)}}]}).encode())


server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
Thread(target=server.serve_forever, daemon=True).start()
origin = 'http://127.0.0.1:' + str(server.server_port)
report = {'version': VERSION, 'scope': 'Real unmodified extension, immutable 0.8.0 cache upgrade, local reversed text-only model responses, native link gestures; no provider key.', 'checks': [], 'errors': [], 'result': 'running'}


def passed(name, **detail):
    report['checks'].append({'name': name, **detail})
    print('PASS:', name, json.dumps(detail, ensure_ascii=False) if detail else '', flush=True)


try:
    with tempfile.TemporaryDirectory(prefix='dianyi-inline-structure-') as folder, sync_playwright() as p:
        temp = Path(folder)
        extension = temp / 'extension'
        with zipfile.ZipFile(ROOT / 'releases/dianyi-chrome-edge-0.8.0.zip') as archive:
            archive.extractall(extension)
        candidates=sorted((Path.home()/'Library/Caches/ms-playwright').glob('chromium-*'),key=lambda path:int(path.name.split('-')[-1]),reverse=True)
        binary=next(path/'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' for path in candidates if (path/'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing').is_file())
        def launch():
            return p.chromium.launch_persistent_context(str(temp / 'profile'), executable_path=str(binary), headless=True, ignore_default_args=['--disable-extensions'], args=['--disable-extensions-except=' + str(extension), '--load-extension=' + str(extension)], viewport={'width': 1250, 'height': 950})
        ctx = launch()
        def attach():
            worker = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker')
            return worker.url.split('/')[2]
        ext = attach()
        ui = ctx.new_page()
        ui.goto('chrome-extension://' + ext + '/options.html#translation')
        expect(ui.get_by_label('每批翻译块数', exact=True)).to_be_visible()
        def message(kind, **payload):
            reply = ui.evaluate('data=>chrome.runtime.sendMessage(data)', {'type': 'SHIYI/' + kind, **payload})
            assert reply['ok'], reply
            return reply['data']
        def tab_id(page):
            return ui.evaluate('async url=>(await chrome.tabs.query({})).find(t=>t.url===url).id', page.url)
        def complete(tab):
            deadline = time.monotonic() + 25
            while time.monotonic() < deadline:
                state = message('UI_STATE', tabId=tab)['tab']['page']
                if state and state['active'] and not state['running'] and state['phase'] in ['complete', 'paused']:
                    return state
                ui.wait_for_timeout(40)
            raise AssertionError(state)
        message('SAVE_PROFILE', profile={'provider': 'custom', 'name': 'Local inline fixture', 'endpoint': origin + '/v1', 'model': 'inline-fixture', 'auth': 'none', 'timeoutSeconds': 5, 'rememberKey': False})
        page = ctx.new_page()
        page.goto(origin + '/article')
        tab = tab_id(page)
        message('PAGE_COMMAND', tabId=tab, action='translate', mode='bilingual')
        seeded = complete(tab)
        assert seeded['completed'] > 5 and not seeded['failed']
        assert page.locator('#basic + [data-shiyi-block-translation] a').count() == 0
        seed_calls = len(calls)
        ctx.close()
        upgraded=subprocess.run([sys.executable,str(ROOT/'src/upgrade/install.py'),'--source',str(ROOT/'releases'/('dianyi-'+VERSION)),'--target',str(extension)],capture_output=True,text=True)
        assert upgraded.returncode==0,upgraded.stderr
        ctx = launch()
        try:
            assert attach() == ext
            manager = ctx.new_page()
            manager.goto('chrome://extensions')
            toggle = manager.locator('extensions-toolbar #devMode')
            if toggle.get_attribute('aria-pressed') != 'true':
                toggle.click()
            manager.locator('extensions-item#' + ext).locator('#dev-reload-button').click()
            manager.wait_for_timeout(200)
            ui = ctx.new_page()
            ui.goto('chrome-extension://' + ext + '/options.html#translation')
            expect(ui.get_by_label('每批翻译块数', exact=True)).to_be_visible()
            assert message('UI_STATE')['version'] == VERSION
            page = ctx.new_page()
            page.on('pageerror', lambda error: report['errors'].append(str(error)))
            page.goto(origin + '/article')
            tab = tab_id(page)
            restored = complete(tab)
            basic = page.locator('#basic + [data-shiyi-block-translation]')
            expect(basic.locator('a strong em')).to_have_text('译：nested guide')
            assert len(calls) == seed_calls
            passed('An immutable 0.8.0 flat cache gains nested clickable/bold/italic structure after in-place upgrade without another model request', restored=restored['restored'])
            expect(basic.locator('code')).to_have_text('CODE_PRIVATE_TOKEN')
            expect(basic.locator('b').first).to_have_text('译：bold text')
            expect(basic.locator('i')).to_have_text('译：italic text')
            expect(basic.locator('font b')).to_have_text('译：font text')
            assert basic.locator('font').get_attribute('face') == 'monospace'
            passed('a, nested strong/em, b/i, code and font are rebuilt around their exact translated text slots')
            url = page.locator('#url + [data-shiyi-block-translation] a')
            expect(url).to_have_text('impeccable.style/docs')
            assert url.get_attribute('href') == origin + '/docs'
            passed('URL link labels stay verbatim even when the cached model text contains a changed domain')
            formats = page.locator('#formats + [data-shiyi-block-translation]')
            for tag in ['strong', 'em', 'u', 's', 'del', 'ins', 'small', 'big', 'sub', 'sup', 'abbr', 'q', 'cite', 'dfn', 'time', 'bdo', 'span']:
                assert formats.locator(tag).count() > 0, tag
            assert formats.locator('abbr').get_attribute('title') == 'Abbreviation title'
            assert formats.locator('time').get_attribute('datetime') == '2026-11-03'
            assert formats.locator('bdo').get_attribute('dir') == 'rtl'
            assert formats.locator('b').count() == 2
            passed('Common text tags, historical bold/blod aliases, semantic attributes and styled spans use the same generic mapping')
            breaks = page.locator('#breaks + [data-shiyi-block-translation]')
            assert breaks.locator('br').count() == 3 and breaks.locator('wbr').count() == 1
            assert breaks.locator('br').last.evaluate('node=>getComputedStyle(node).display') == 'none'
            assert not breaks.inner_text().startswith('\n') and not breaks.inner_text().endswith('\n')
            passed('Line breaks and word-break opportunities survive text-only model transport and cached reconstruction')
            message('PAGE_COMMAND', tabId=tab, action='refresh')
            complete(tab)
            protected = page.locator('#protected + [data-shiyi-block-translation]')
            for tag, text in [('kbd', 'KBD_PRIVATE_TOKEN'), ('samp', 'SAMP_PRIVATE_TOKEN'), ('var', 'VAR_PRIVATE_TOKEN'), ('tt', 'TT_PRIVATE_TOKEN')]:
                expect(protected.locator(tag)).to_have_text(text)
            payload = json.dumps(calls[seed_calls:], ensure_ascii=False)
            for secret in ['CODE_PRIVATE_TOKEN', 'KBD_PRIVATE_TOKEN', 'SAMP_PRIVATE_TOKEN', 'VAR_PRIVATE_TOKEN', 'TT_PRIVATE_TOKEN', 'LINK_PRIVATE_TOKEN', 'MAPPING_PRIVATE_ATTRIBUTE']:
                assert secret not in payload, secret
            passed('Code, keyboard/sample/variable identifiers and link/format attributes remain local; newly supported protected tags translate only surrounding prose')
            stored = ui.evaluate('''()=>new Promise((resolve,reject)=>{const r=indexedDB.open('shiyi-vocabulary');r.onsuccess=()=>{const db=r.result,tx=db.transaction('pages'),q=tx.objectStore('pages').getAll();q.onsuccess=()=>resolve(JSON.stringify(q.result));q.onerror=()=>reject(q.error);tx.oncomplete=()=>db.close()}})''')
            assert 'LINK_PRIVATE_TOKEN' not in stored and 'CODE_PRIVATE_TOKEN' not in stored and 'MAPPING_PRIVATE_ATTRIBUTE' not in stored
            passed('Page snapshots keep existing text mappings and fingerprints rather than persisting the local DOM skeleton or private code/URL attributes')
            guide = basic.locator('a')
            guide.click()
            assert page.evaluate('guideClicks') == 1
            page.locator('#actions + [data-shiyi-block-translation] a[href$="#route"]').click()
            assert page.evaluate('routerClicks') == 1
            assert page.evaluate('originalGuide===document.getElementById("guide")')
            passed('Normal translated-link clicks reuse original nodes and page-side custom/router listeners exactly once')
            guide.focus()
            page.keyboard.press('Enter')
            assert page.evaluate('guideClicks') == 2
            guide.click(button='right')
            assert page.evaluate('menuHref') == origin + '/guide?private=LINK_PRIVATE_TOKEN'
            passed('Keyboard activation and context-menu link addresses preserve the original destination')
            newtab = page.locator('#actions + [data-shiyi-block-translation] a[href$="/landing"]')
            assert 'noopener' in newtab.get_attribute('rel').split()
            for gesture in [{'button': 'left'}, {'button': 'middle'}, {'modifiers': ['Meta']}]:
                with ctx.expect_page() as opened:
                    newtab.click(**gesture)
                opened.value.wait_for_url(origin + '/landing')
                opened.value.close()
            passed('Native left-click, middle-click and modifier-click open the original target in a new tab')
            nav = page.locator('#navlink [data-shiyi-block-translation]')
            assert nav.locator('a').count() == 0 and nav.evaluate('n=>n.closest("a").id==="navlink"')
            control = page.locator('#control [data-shiyi-block-translation]')
            control.click()
            assert page.evaluate('buttonClicks') == 1
            passed('Compact navigation and buttons retain original controls, event handlers and layout without nested anchors')
            all_output = page.locator('[data-shiyi-block-translation]')
            assert page.evaluate('''()=>[...document.querySelectorAll('[data-shiyi-block-translation] *')].every(n=>!n.id&&![...n.attributes].some(a=>a.name.startsWith('on'))&&!n.matches('script,img,svg,input,button,iframe,object,embed'))''')
            assert page.locator('#unsafe + [data-shiyi-block-translation] a').count() == 0
            assert page.evaluate('!window.modelExecuted&&!window.unsafeExecuted')
            assert page.locator('#unsafe + [data-shiyi-block-translation]').inner_text().find('<img') >= 0
            passed('Model HTML stays literal; executable attributes, unsafe protocols, duplicate IDs and interactive/resource elements are never cloned')
            mixed = page.locator('#mixed + [data-shiyi-block-translation]')
            assert '这段中文' not in mixed.inner_text() and '中文强调' not in mixed.inner_text()
            assert mixed.locator('br').count() == 0 and not mixed.inner_text().startswith('\n')
            expect(mixed.locator('b')).to_contain_text('Foreign fragment')
            passed('Generic structure restoration retains the existing native-Chinese duplicate suppression')
            prefs = message('UI_STATE')['prefs']
            before = len(calls)
            message('SAVE_PREFS', prefs={**prefs, 'translationColorLight': '#315cbb'})
            expect(guide).to_have_css('color', 'rgb(49, 92, 187)')
            expect(basic.locator('font')).to_have_css('color', 'rgb(49, 92, 187)')
            for source, output in [('#basic b', '#basic + [data-shiyi-block-translation] b'), ('#font', '#basic + [data-shiyi-block-translation] font'), ('#code', '#basic + [data-shiyi-block-translation] code')]:
                size = page.locator(source).first.evaluate('n=>parseFloat(getComputedStyle(n).fontSize)')
                actual = page.locator(output).first.evaluate('n=>parseFloat(getComputedStyle(n).fontSize)')
                assert abs(actual - size) < .1, (source, size, actual)
            assert len(calls) == before
            passed('Nested font/code/bold text respects the configured translation color and defaults to the source font size without another request')
            page.set_viewport_size({'width': 390, 'height': 900})
            page.wait_for_timeout(100)
            # BR has no painted width, so Playwright's box visibility check is
            # not meaningful. Check its actual responsive display state.
            page.wait_for_function("()=>getComputedStyle(document.querySelector('#hidden-break')).display!=='none'&&getComputedStyle([...document.querySelectorAll('#breaks + [data-shiyi-block-translation] br')].at(-1)).display!=='none'")
            assert basic.locator('b').first.evaluate('n=>parseFloat(getComputedStyle(n).fontSize)') == page.locator('#basic b').first.evaluate('n=>parseFloat(getComputedStyle(n).fontSize)')
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
            page.set_viewport_size({'width': 1250, 'height': 950})
            passed('Responsive source typography also refreshes nested reconstructed tags and fits a narrow viewport')
            page.locator('#font').evaluate('n=>n.setAttribute("size","6")')
            page.wait_for_timeout(100)
            assert basic.locator('font').evaluate('n=>parseFloat(getComputedStyle(n).fontSize)') == page.locator('#font').evaluate('n=>parseFloat(getComputedStyle(n).fontSize)')
            assert len(calls) == before
            page.locator('#font').evaluate('n=>n.setAttribute("size","5")')
            passed('Local font attribute changes update formatting in place without discarding translations or requesting a model')
            message('PAGE_COMMAND', tabId=tab, action='mode', mode='translation')
            assert page.evaluate('originalGuide===document.getElementById("guide")&&originalText===document.getElementById("basic").firstChild&&originalButton===document.getElementById("control")')
            assert page.locator('[data-shiyi-block-translation]').count() == 0
            expect(page.locator('#docs')).to_have_text('impeccable.style/docs')
            message('PAGE_COMMAND', tabId=tab, action='mode', mode='bilingual')
            expect(basic.locator('a strong em')).to_have_text('译：nested guide')
            assert len(calls) == before
            page.screenshot(path=str(OUT / 'inline-structure-reading.png'), full_page=True, caret='initial')
            passed('Bilingual/translation-only mode switches retain source nodes, restored nested structure and URL labels with zero extra requests')
            page.reload()
            tab = tab_id(page)
            complete(tab)
            expect(basic.locator('a strong em')).to_have_text('译：nested guide')
            assert len(calls) == before
            passed('Refresh reconstructs the same formatted clickable translation entirely from existing local page mappings')
            # Change an address while keeping all text nodes unchanged.
            page.locator('#guide').evaluate('n=>n.href="/updated-guide"')
            expect(basic).to_have_count(0)
            assert len(calls) == before
            message('PAGE_COMMAND', tabId=tab, action='refresh')
            complete(tab)
            expect(basic.locator('a')).to_have_attribute('href', origin + '/updated-guide')
            assert len(calls) == before
            page.locator('#guide').evaluate('n=>n.setAttribute("href","/guide?private=LINK_PRIVATE_TOKEN")')
            passed('Changed link targets invalidate stale output and explicit refresh rebuilds the current target while reusing the text cache')
            message('PAGE_COMMAND', tabId=tab, action='restore')
            assert page.locator('main').inner_html() == page.evaluate('originalHTML')
            assert page.evaluate('originalGuide===document.getElementById("guide")&&originalText===document.getElementById("basic").firstChild')
            passed('Restoring removes all generated structure and exactly preserves original HTML, node identity and event ownership')
            assert not report['errors'], report['errors']
            passed('No uncaught errors')
            report['result'] = 'pass'
            report['model_requests'] = len(calls)
        finally:
            ctx.close()
except Exception as error:
    report['result'] = 'fail'
    report['failure'] = str(error)
    raise
finally:
    server.shutdown()
    server.server_close()
    (OUT / ('inline-structure-' + VERSION + '.json')).write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'result': report['result'], 'checks': len(report['checks']), 'failure': report.get('failure')}, ensure_ascii=False), flush=True)
