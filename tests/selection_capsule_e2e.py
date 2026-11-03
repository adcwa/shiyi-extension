"""Compact language-only capsule in the unmodified, installable MV3 extension.

Use actual mouse/keyboard actions and a deterministic local model endpoint.
Changing a language must persist without sending source text or calling a model.
"""
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from playwright.sync_api import sync_playwright, expect
import json, tempfile, time

ROOT = Path(__file__).resolve().parents[1]
VERSION = json.loads((ROOT / 'package.json').read_text())['version']
OUT = ROOT / 'verification'
OUT.mkdir(exist_ok=True)
HTML = '''<!doctype html><html lang="en"><meta charset="utf-8"><title>点译 · 小胶囊实机预览</title><style>
body{margin:0;background:#fafbf8;color:#283d35;font:18px/1.9 system-ui}main{max-width:720px;margin:60px auto;padding:32px 40px;background:white;border:1px solid #e2e8dd;border-radius:12px}h1{font-size:24px;font-weight:550;margin:0 0 22px}p{margin:18px 0}#edge{position:fixed;right:14px;bottom:14px;font-size:16px;margin:0}@media(max-width:600px){main{margin:16px;padding:22px}}
</style><main><h1>Less is more.</h1><p id="short">Curiosity opens doors. Curiosity makes reading better.</p><p id="second">Intentional tools leave room for thought.</p><p id="long">'''+('Good tools make everyday reading easier and preserve room for thought. ' * 4)+'''</p></main><p id="edge">resilience</p></html>'''
calls = []


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Type', 'text/html;charset=utf-8')
        self.end_headers()
        self.wfile.write(HTML.encode())

    def do_POST(self):
        payload = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))))
        data = json.loads(payload['messages'][-1]['content'])
        calls.append(data)
        if data.get('task') in ('block', 'blocks'):
            def output(parts):
                return {'parts': [{'id': part['id'], 'text': '译文：' + part['text'] if part['text'].strip() else part['text']} for part in reversed(parts)]}
            result = {'blocks': [{'id': block['id'], **output(block['parts'])} for block in reversed(data['blocks'])]} if data['task'] == 'blocks' else output(data['parts'])
        else:
            translations = {'简体中文': '好奇心', 'English': 'a strong desire to learn', '日本語': '好奇心です', '한국어': '호기심', 'Français': 'curiosité', 'Deutsch': 'Neugier', 'Español': 'curiosidad'}
            result = {'translation': translations[data['targetLanguage']], 'sourceLanguage': 'en', 'kind': 'word'}
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps({'choices': [{'message': {'content': json.dumps(result, ensure_ascii=False)}}]}).encode())


server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
Thread(target=server.serve_forever, daemon=True).start()
origin = 'http://127.0.0.1:' + str(server.server_port)
report = {'version': VERSION, 'scope': 'Unmodified MV3 extension, native pointer and keyboard, deterministic loopback HTTP; no external key or paid model.', 'checks': [], 'errors': [], 'result': 'running'}


def passed(name, **detail):
    report['checks'].append({'name': name, **detail})
    print('PASS:', name, json.dumps(detail, ensure_ascii=False) if detail else '', flush=True)


def select(page, selector, text=None):
    page.keyboard.press('Escape')
    page.evaluate('getSelection().removeAllRanges()')
    page.mouse.move(4, 4)
    page.locator(selector).scroll_into_view_if_needed()
    rects = page.locator(selector).evaluate('''(root,text)=>{const nodes=[],walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let n,raw='';while(n=walker.nextNode()){if(n.parentElement.closest('[data-shiyi-meaning],[data-shiyi-block-translation]'))continue;nodes.push({node:n,start:raw.length,end:raw.length+n.length});raw+=n.data}const start=text?raw.indexOf(text):0,end=text?start+text.length:raw.length,a=nodes.find(n=>n.end>start),b=nodes.find(n=>n.end>=end),r=document.createRange();r.setStart(a.node,start-a.start);r.setEnd(b.node,end-b.start);return [...r.getClientRects()].filter(n=>n.width>0).map(n=>({x:n.x,y:n.y,width:n.width,height:n.height}))}''', text)
    first, last = rects[0], rects[-1]
    page.mouse.move(first['x'] + .2, first['y'] + first['height'] / 2)
    page.mouse.down()
    page.mouse.move(last['x'] + last['width'] - .2, last['y'] + last['height'] / 2, steps=15)
    page.mouse.up()
    expect(page.locator('#shiyi-extension-root .selection-capsule')).to_be_visible()


try:
    with tempfile.TemporaryDirectory(prefix='dianyi-selection-capsule-') as folder, sync_playwright() as p:
        binary = next((Path.home() / 'Library/Caches/ms-playwright').glob('chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'))
        extension = ROOT / 'releases' / ('shiyi-' + VERSION)
        ctx = p.chromium.launch_persistent_context(folder, executable_path=str(binary), headless=True, ignore_default_args=['--disable-extensions'], args=['--disable-extensions-except=' + str(extension), '--load-extension=' + str(extension)], viewport={'width': 1100, 'height': 850}, device_scale_factor=2)
        try:
            worker = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker')
            ext = worker.url.split('/')[2]
            ui = ctx.new_page()
            ui.goto('chrome-extension://' + ext + '/options.html#translation')
            expect(ui.get_by_label('每批翻译块数', exact=True)).to_be_visible()

            def message(kind, **extra):
                reply = ui.evaluate('data=>chrome.runtime.sendMessage(data)', {'type': 'SHIYI/' + kind, **extra})
                assert reply['ok'], reply
                return reply['data']

            prefs = message('UI_STATE')['prefs']
            message('SAVE_PROFILE', profile={'provider': 'custom', 'name': 'Local capsule fixture', 'endpoint': origin + '/v1/chat/completions', 'model': 'capsule-fixture', 'auth': 'none', 'timeoutSeconds': 5, 'rememberKey': False})
            page = ctx.new_page()
            page.on('pageerror', lambda error: report['errors'].append(str(error)))
            page.goto(origin + '/article')
            root = page.locator('#shiyi-extension-root')
            select(page, '#short', 'Curiosity')
            main = root.locator('.selection-main')
            expect(main).to_have_text('中文')
            expect(main).to_have_attribute('aria-label', '翻译为中文')
            capsule = root.locator('.selection-capsule')
            assert capsule.inner_text() == '中文'
            dimensions = capsule.evaluate('n=>({width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height,radius:parseFloat(getComputedStyle(n).borderRadius)})')
            assert dimensions['width'] <= 150 and dimensions['height'] <= 36 and dimensions['radius'] >= 100, dimensions
            capsule.screenshot(path=str(OUT / 'selection-capsule.png'))
            page.screenshot(path=str(OUT / 'selection-capsule-in-page.png'))
            passed('Capsule shows only the selected language, with no translation/collection prefix, in a smaller fully rounded shell', **dimensions)

            def choose(label, expected):
                root.get_by_role('button', name='选择目标语言', exact=True).click()
                expect(root.get_by_role('listbox', name='目标语言', exact=True)).to_be_visible()
                assert root.get_by_role('option').count() == 7
                root.get_by_role('option', name=label, exact=True).click()
                expect(main).to_have_text(expected)
                expect(main).to_be_enabled()

            choose('英语', '英语')
            assert not calls and message('UI_STATE')['prefs'] == {**prefs, 'targetLanguage': 'en'}
            assert page.evaluate('getSelection().toString()') == 'Curiosity'
            passed('Language switching persists only the target preference, preserves the selection and other settings, and sends zero model requests')
            main.click()
            expect(root.locator('.card .meaning')).to_have_text('a strong desire to learn')
            assert len(calls) == 1 and calls[-1]['targetLanguage'] == 'English'
            entry = message('LIBRARY')['entries'][0]
            assert entry['targetLanguage'] == 'en' and entry['text'] == 'Curiosity'
            passed('Clicking the language name sends its selected language to the real HTTP path and still saves the correct language entry')
            select(page, '#short', 'Curiosity')
            expect(main).to_have_text('英语')
            expect(main).to_have_attribute('aria-label', '查看英语释义')
            main.click()
            expect(root.locator('.card .meaning')).to_have_text('a strong desire to learn')
            assert len(calls) == 1
            passed('The next selection remembers the chosen language and opens its saved meaning without another model call')
            select(page, '#second', 'Intentional')
            for label, value, text in [('日语', 'ja', '日语'), ('韩语', 'ko', '韩语'), ('法语', 'fr', '法语'), ('德语', 'de', '德语'), ('西班牙语', 'es', '西班牙语'), ('简体中文', 'zh-CN', '中文')]:
                choose(label, text)
                assert message('UI_STATE')['prefs']['targetLanguage'] == value and len(calls) == 1
            passed('All seven target languages are selectable, synchronize with settings, and never start translation merely by changing selection')

            root.get_by_role('button', name='更多翻译选项', exact=True).click()
            root.get_by_label('附带相邻一句语境', exact=True).check()
            expect(root.get_by_label('附带相邻一句语境', exact=True)).to_be_enabled()
            assert message('UI_STATE')['prefs']['includeContext']
            page.keyboard.press('Escape')
            expect(capsule).to_be_visible()
            expect(root.locator('.selection-context-menu')).to_be_hidden()
            main.click()
            expect(root.locator('.card .meaning')).to_have_text('好奇心')
            assert calls[-1]['targetLanguage'] == '简体中文' and 'Intentional' in calls[-1]['context']
            passed('The compact More menu retains the real context preference and explicit opt-in sends the selected sentence context')

            select(page, '#short', 'Curiosity')
            before = len(calls)
            page.evaluate('''()=>{const s=document.getElementById('shiyi-extension-root').shadowRoot;s.querySelector('.selection-main').click();[...s.querySelectorAll('[role="option"]')].find(n=>n.textContent==='英语').click();const c=s.querySelector('input');c.checked=false;c.dispatchEvent(new Event('change',{bubbles:true}))}''')
            page.wait_for_timeout(150)
            assert len(calls) == before and message('UI_STATE')['prefs']['targetLanguage'] == 'zh-CN' and message('UI_STATE')['prefs']['includeContext']
            passed('Synthetic page-script clicks cannot translate, switch target language or change the context setting')
            root.get_by_role('button', name='关闭划词工具', exact=True).click()
            expect(capsule).to_have_count(0)
            passed('The capsule keeps an explicit close control')

            select(page, '#second', 'Intentional')
            main.focus()
            page.keyboard.press('Tab')
            page.keyboard.press('Shift+Tab')
            assert main.evaluate('n=>n.matches(":focus-visible")&&getComputedStyle(n).outlineStyle==="solid"&&getComputedStyle(n.parentElement).overflow==="visible"')
            root.get_by_role('button', name='选择目标语言', exact=True).click()
            page.keyboard.press('ArrowDown')
            page.keyboard.press('Enter')
            expect(main).to_have_text('英语')
            expect(main).to_be_enabled()
            assert len(calls) == before
            root.get_by_role('button', name='选择目标语言', exact=True).click()
            page.keyboard.press('Escape')
            expect(capsule).to_be_visible()
            expect(root.get_by_role('listbox')).to_be_hidden()
            page.keyboard.press('Escape')
            expect(capsule).to_have_count(0)
            passed('Keyboard arrows and Enter select a language; Escape closes the menu before closing the capsule')

            for width in [375, 768, 1440]:
                page.set_viewport_size({'width': width, 'height': 650})
                select(page, '#edge', 'resilience')
                root.get_by_role('button', name='选择目标语言', exact=True).click()
                assert root.get_by_role('listbox').evaluate('n=>{const r=n.getBoundingClientRect();return r.left>=11&&r.top>=11&&r.right<=innerWidth-11&&r.bottom<=innerHeight-11}')
                page.keyboard.press('Escape')
                root.get_by_role('button', name='更多翻译选项', exact=True).click()
                assert root.locator('.selection-context-menu').evaluate('n=>{const r=n.getBoundingClientRect();return r.left>=11&&r.top>=11&&r.right<=innerWidth-11&&r.bottom<=innerHeight-11}')
                page.keyboard.press('Escape')
                assert capsule.evaluate('n=>{const r=n.getBoundingClientRect();return r.left>=11&&r.right<=innerWidth-11}')
            passed('Capsule and both menus remain within the viewport beside bottom/right selections at 375–1440px')
            choose('西班牙语', '西班牙语')
            assert capsule.evaluate('n=>n.scrollWidth<=n.clientWidth&&n.getBoundingClientRect().width<190')
            choose('简体中文', '中文')
            passed('Long language names fit without truncating, wrapping or growing the capsule beyond 190px')
            page.reload()
            select(page, '#edge', 'resilience')
            expect(main).to_have_text('中文')
            root.get_by_role('button', name='更多翻译选项', exact=True).click()
            expect(root.get_by_label('附带相邻一句语境', exact=True)).to_be_checked()
            page.keyboard.press('Escape')
            passed('The selected language and existing context preference survive page refresh')

            count = message('UI_STATE')['count']
            select(page, '#long')
            expect(main).to_have_text('中文')
            expect(main).to_have_attribute('aria-label', '按段翻译为中文')
            assert root.get_by_role('button', name='更多翻译选项', exact=True).count() == 0
            main.click()
            expect(page.locator('#long + [data-shiyi-block-translation]')).to_be_visible(timeout=10000)
            assert message('UI_STATE')['count'] == count
            passed('Long selections use the same language-only capsule and preserve paragraph translation without vocabulary entries')
            assert not report['errors'], report['errors']
            passed('No uncaught content-script errors')
            report['result'] = 'pass'
            report['http_requests'] = len(calls)
            report['capsule_dimensions'] = dimensions
        finally:
            ctx.close()
except Exception as error:
    report['result'] = 'fail'
    report['failure'] = str(error)
    raise
finally:
    server.shutdown()
    server.server_close()
    (OUT / 'selection-capsule-e2e.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'result': report['result'], 'checks': len(report['checks']), 'failure': report.get('failure')}, ensure_ascii=False), flush=True)
