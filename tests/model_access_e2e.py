"""Structured model errors through the unmodified MV3 UI and real local HTTP.

The upstream bodies imitate the two verified Qwen error shapes. No real key,
provider endpoint or user's browser profile is used by this regression test.
"""
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from playwright.sync_api import sync_playwright, expect
import json, shutil, tempfile, time

ROOT = Path(__file__).resolve().parents[1]
VERSION = json.loads((ROOT/'package.json').read_text())['version']
OUT = ROOT/'verification'
report = {'version': VERSION, 'checks': [], 'errors': [], 'result': 'running', 'scope': 'Isolated real MV3; local HTTP failures/success; no real credentials.'}
calls = []
mode = {'value': 'workspace'}
KEY = 'fake-local-credential-not-for-export'
REQUEST_ID = '11111111-2222-3333-4444-555555555555'
FREE_MESSAGE = 'Free quota exhausted. To continue accessing the model on a paid basis, please add funds or disable the "use free tier only" mode in the management console.'

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def do_GET(self):
        self.send_response(200); self.send_header('Content-Type', 'text/html;charset=utf-8'); self.end_headers()
        self.wfile.write(('<!doctype html><meta charset="utf-8"><title>Reading</title><main>'+''.join('<p>Readable sentence number '+str(i)+' for translation.</p>' for i in range(24))+'</main>').encode())
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        calls.append({'path': self.path, 'body': body, 'authorized': self.headers.get('Authorization') == 'Bearer '+KEY})
        if mode['value'] == 'success':
            status = 200; data = {'choices': [{'message': {'content': '好奇心'}}]}
        elif mode['value'] == 'workspace':
            status = 403; data = {'error': {'type': 'insufficient_quota', 'code': None, 'message': FREE_MESSAGE}, 'request_id': REQUEST_ID}
        elif mode['value'] == 'public':
            status = 403; data = {'error': {'code': 'AllocationQuota.FreeTierOnly', 'message': FREE_MESSAGE}, 'request_id': REQUEST_ID}
        else:
            status = 403; data = {'error': {'code': KEY, 'type': '<img src=x onerror=alert(1)>', 'message': KEY+' private upstream message'}, 'request_id': KEY}
        self.send_response(status); self.send_header('Content-Type', 'application/json'); self.end_headers()
        self.wfile.write(json.dumps(data).encode())

def passed(name):
    report['checks'].append({'name': name}); print('PASS:', name, flush=True)

server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
Thread(target=server.serve_forever, daemon=True).start()
origin = 'http://127.0.0.1:'+str(server.server_port)
try:
    with tempfile.TemporaryDirectory(prefix='dianyi-model-access-') as folder, sync_playwright() as playwright:
        folder = Path(folder); extension = folder/'extension'
        shutil.copytree(ROOT/'releases'/('dianyi-'+VERSION), extension)
        binary = next((Path.home()/'Library/Caches/ms-playwright').glob('chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'))
        context = playwright.chromium.launch_persistent_context(str(folder/'profile'), executable_path=str(binary), headless=True, ignore_default_args=['--disable-extensions'], args=['--disable-extensions-except='+str(extension), '--load-extension='+str(extension)], viewport={'width':1000,'height':900})
        try:
            worker = context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
            ui = context.new_page(); ui.on('pageerror', lambda error: report['errors'].append(str(error)))
            ui.goto('chrome-extension://'+worker.url.split('/')[2]+'/options.html#model')
            ui.get_by_role('button', name='自定义服务', exact=True).click()
            ui.locator('#model-endpoint').fill(origin+'/compatible-mode/v1')
            ui.locator('#model-id').fill('qwen-mt-flash')
            ui.locator('#model-key').fill(KEY)
            def message(kind, **payload):
                result = ui.evaluate('data=>chrome.runtime.sendMessage(data)', {'type':'SHIYI/'+kind, **payload})
                assert result['ok'], result
                return result['data']
            def test_connection():
                ui.get_by_role('button', name='仅测试连接', exact=False).click()
                expect(ui.locator('#model-controls')).to_be_enabled()
                return ui.locator('#connection-result')
            result = test_connection()
            expect(result).to_contain_text('HTTP 403')
            expect(result).to_contain_text('insufficient_quota')
            expect(result).to_contain_text(REQUEST_ID)
            assert len(calls) == 1 and calls[0]['authorized']
            assert calls[0]['path'] == '/compatible-mode/v1/chat/completions'
            assert calls[0]['body']['messages'] == [{'role':'user','content':'curiosity'}]
            assert calls[0]['body']['translation_options']['target_lang'] == 'Chinese'
            assert KEY not in json.dumps(calls[0]['body'])
            passed('Pasted Base URL normalizes once; native MT uses Bearer, raw user text and target language; 403 retains its type and request ID through UI')
            before = len(calls); ui.wait_for_timeout(250)
            assert len(calls) == before and not message('UI_STATE')['profile']['hasKey']
            passed('A refused connection neither saves its credential nor retries automatically')
            mode['value'] = 'public'; result = test_connection()
            expect(result).to_contain_text('AllocationQuota.FreeTierOnly')
            expect(result).to_contain_text(REQUEST_ID)
            for width in [375, 1000]:
                ui.set_viewport_size({'width':width,'height':900})
                assert ui.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
            passed('The alternate public error shape remains distinct and long error identifiers fit 375px')
            mode['value'] = 'unsafe'; result = test_connection()
            expect(result).to_contain_text('HTTP 403')
            assert KEY not in result.inner_text() and 'private upstream' not in result.inner_text()
            assert result.locator('img,script').count() == 0
            passed('Credential-shaped fields and raw server text cannot enter the visible error or create markup')
            mode['value'] = 'success'; result = test_connection()
            expect(result).to_contain_text('好奇心')
            before = len(calls); ui.get_by_role('button', name='连接并保存', exact=True).click()
            expect(ui.locator('#connection-result')).to_contain_text('已连接并保存')
            assert len(calls) == before and message('UI_STATE')['profile']['hasKey']
            passed('Successful retest still connects and saves without a duplicate model request')
            mode['value'] = 'workspace'; page = context.new_page(); page.on('pageerror', lambda error: report['errors'].append(str(error)))
            page.goto(origin+'/reading'); expect(page.locator('#shiyi-extension-root')).to_be_attached()
            tab = ui.evaluate('async url=>(await chrome.tabs.query({})).find(t=>t.url===url).id', page.url)
            before = len(calls); message('PAGE_COMMAND', tabId=tab, action='translate', mode='bilingual')
            deadline = time.monotonic()+10
            while time.monotonic() < deadline:
                state = message('UI_STATE', tabId=tab)['tab']['page']
                if state and state['phase'] == 'paused' and not state['running']: break
                ui.wait_for_timeout(40)
            assert state['phase'] == 'paused' and state['errorCode'] == 'HTTP_403', state
            assert 1 <= len(calls)-before <= 2
            expect(page.locator('[data-shiyi-block-translation]')).to_have_count(0)
            ui.wait_for_timeout(300); after = len(calls); ui.wait_for_timeout(200); assert len(calls) == after
            assert not report['errors'], report['errors']
            passed('Quota denial pauses full-page work within two in-flight calls, preserves source and never starts fallback request storms')
            report['result'] = 'pass'
        finally: context.close()
except Exception as error:
    report['result'] = 'fail'; report['failure'] = str(error)
finally:
    server.shutdown(); server.server_close()
    (OUT/('model-access-'+VERSION+'.json')).write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
    print(json.dumps({'result':report['result'],'checks':len(report['checks']),'failure':report.get('failure')}), flush=True)
if report['result'] != 'pass': raise SystemExit(1)
