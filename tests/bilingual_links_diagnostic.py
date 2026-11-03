"""Reproduce the loss of translated links in the shipped, unmodified ZIP.

Analysis only: this script intentionally fails while translated paragraph links
are missing. It runs in an isolated temporary browser with a local model fixture.
"""
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from playwright.sync_api import sync_playwright, expect
import hashlib, json, tempfile, time, zipfile

ROOT = Path(__file__).resolve().parents[1]
VERSION = json.loads((ROOT / 'package.json').read_text())['version']
ARCHIVE = ROOT / 'releases' / ('dianyi-chrome-edge-' + VERSION + '.zip')
OUT = ROOT / 'verification'
HTML = '''<!doctype html><html lang="en"><meta charset="utf-8"><title>双语链接复现</title><style>
body{background:#fafbf8;color:#253e34;font:18px/1.9 system-ui;margin:44px}main{max-width:800px;background:#fff;padding:30px;border:1px solid #dfe7dc;border-radius:12px}a{color:#0069d9;text-decoration:underline}p{margin:12px 0}
</style><main><p id="source">Full docs live at <a id="docs" href="/docs" target="_blank" rel="noopener noreferrer">impeccable.style/docs</a>, or read <a id="guide" href="/guide">the guide</a>.</p></main><script>window.originalLinks=[...document.querySelectorAll('a')];originalLinks.forEach(a=>a.addEventListener('click',event=>{event.preventDefault();window.linkClicks=(window.linkClicks||0)+1}));</script></html>'''
TRANSLATIONS = {'Full docs live at ': '完整文档见 ', 'impeccable.style/docs': 'impeccable.style/docs', ', or read ': '，或阅读 ', 'the guide': '指南', '.': '。'}
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
        data = json.loads(json.loads(self.rfile.read(int(self.headers['Content-Length'])))['messages'][-1]['content'])
        calls.append(data)
        def output(parts):
            return {'parts': [{'id': part['id'], 'text': TRANSLATIONS.get(part['text'], part['text'])} for part in reversed(parts)]}
        value = {'blocks': [{'id': block['id'], **output(block['parts'])} for block in reversed(data['blocks'])]} if data.get('task') == 'blocks' else output(data['parts'])
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps({'choices': [{'message': {'content': json.dumps(value, ensure_ascii=False)}}]}).encode())


server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
Thread(target=server.serve_forever, daemon=True).start()
origin = 'http://127.0.0.1:' + str(server.server_port)
report = {'version': VERSION, 'scope': 'Unmodified release ZIP, isolated Chromium, local deterministic translation with intentionally reversed fragment IDs; no external keys.', 'zip_sha256': hashlib.sha256(ARCHIVE.read_bytes()).hexdigest(), 'measurements': {}, 'result': 'running'}
try:
    with tempfile.TemporaryDirectory(prefix='dianyi-link-analysis-') as folder, sync_playwright() as p:
        temp = Path(folder)
        extension = temp / 'extension'
        with zipfile.ZipFile(ARCHIVE) as archive:
            archive.extractall(extension)
        binary = next((Path.home() / 'Library/Caches/ms-playwright').glob('chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'))
        ctx = p.chromium.launch_persistent_context(str(temp / 'profile'), executable_path=str(binary), headless=True, ignore_default_args=['--disable-extensions'], args=['--disable-extensions-except=' + str(extension), '--load-extension=' + str(extension)], viewport={'width': 1100, 'height': 650})
        try:
            worker = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker')
            ui = ctx.new_page()
            ui.goto('chrome-extension://' + worker.url.split('/')[2] + '/options.html#translation')
            expect(ui.get_by_label('每批翻译块数', exact=True)).to_be_visible()
            def message(kind, **payload):
                reply = ui.evaluate('data=>chrome.runtime.sendMessage(data)', {'type': 'SHIYI/' + kind, **payload})
                assert reply['ok'], reply
                return reply['data']
            message('SAVE_PROFILE', profile={'provider': 'custom', 'name': 'Local link analysis', 'endpoint': origin + '/v1', 'model': 'link-analysis', 'auth': 'none', 'timeoutSeconds': 5, 'rememberKey': False})
            page = ctx.new_page()
            page.goto(origin + '/article')
            tab = ui.evaluate('async url=>(await chrome.tabs.query({})).find(t=>t.url===url).id', page.url)
            def command(action, mode=None):
                return message('PAGE_COMMAND', tabId=tab, action=action, **({'mode': mode} if mode else {}))
            command('translate', 'bilingual')
            deadline = time.monotonic() + 15
            while time.monotonic() < deadline:
                state = message('UI_STATE', tabId=tab)['tab']['page']
                if state and state['phase'] == 'complete' and not state['running']:
                    break
                page.wait_for_timeout(40)
            else:
                raise AssertionError(state)
            translated = page.locator('#source + [data-shiyi-block-translation]')
            expect(translated).to_contain_text('impeccable.style/docs')
            expect(translated).to_contain_text('指南')
            report['measurements']['bilingual'] = page.evaluate('''()=>{const original=document.getElementById('source'),translated=original.nextElementSibling;return {sourceLinks:original.querySelectorAll('a[href]').length,translatedLinks:translated.querySelectorAll('a[href]').length,translatedHTML:translated.innerHTML,originalNodeIdentity:originalLinks.every(a=>a.isConnected&&document.getElementById(a.id)===a),originalHrefs:originalLinks.map(a=>a.getAttribute('href'))}}''')
            page.locator('#guide').click()
            assert page.evaluate('linkClicks') == 1
            before = len(calls)
            command('mode', 'translation')
            expect(page.locator('#guide')).to_have_text('指南')
            page.locator('#guide').click()
            report['measurements']['translationOnly'] = page.evaluate('''()=>({links:document.querySelectorAll('#source a[href]').length,originalNodeIdentity:originalLinks.every(a=>a.isConnected&&document.getElementById(a.id)===a),hrefs:originalLinks.map(a=>a.getAttribute('href')),customClickListenerCalls:linkClicks})''')
            assert report['measurements']['translationOnly']['links'] == 2
            assert report['measurements']['translationOnly']['originalNodeIdentity']
            assert page.evaluate('linkClicks') == 2
            command('mode', 'bilingual')
            assert len(calls) == before
            expect(translated).to_be_visible()
            report['measurements']['bilingualAfterModeSwitch'] = {'translatedLinks': translated.locator('a[href]').count(), 'additionalModelRequests': len(calls) - before}
            page.screenshot(path=str(OUT / 'bilingual-link-analysis.png'))
            report['requestParts'] = calls[0].get('parts') or calls[0]['blocks'][0]['parts']
            report['modelRequests'] = len(calls)
            report['result'] = 'pass' if report['measurements']['bilingual']['translatedLinks'] == 2 else 'reproduced'
            print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)
        finally:
            ctx.close()
finally:
    server.shutdown()
    server.server_close()
    (OUT / ('bilingual-link-analysis-' + VERSION + '.json')).write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
assert report['result'] == 'pass', 'Reproduced: bilingual translation retains link text but creates no clickable anchors; translation-only preserves both original anchors and their event listeners.'
